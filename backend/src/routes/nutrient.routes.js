// src/routes/nutrient.routes.js
// 양액 관리 API — 시나리오 CRUD + 농장 설정 + 경보 이력 + 센서 보정 + 누적 카운터 + 운영 상태
//
// 엔드포인트 패턴: /api/nutrient/:farmId/...
// 인증: authenticate + enforceTenant (app.js 에서 적용)

import express from "express";
import { prisma } from "../db.js";
import logger from "../utils/logger.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────────────────────────────

const DEFAULT_ALERT_THRESHOLDS = {
  // 정상 경계 (밖이면 warning)
  ecUpper: 4.0, ecLower: 0.2,
  phUpper: 8.0, phLower: 4.5,
  // critical 경계 (밖이면 즉시 정지). 이전: phCritical 단일 (의미 모호 — 6.5 미달은 흔함).
  // 분리: phLowerCritical/phUpperCritical, ec 도 동일하게 분리.
  ecLowerCritical: 0.1, ecUpperCritical: 5.0,
  phLowerCritical: 3.0, phUpperCritical: 9.5,
  // 정밀도·다량공급·최소일사량 (운영 안정성)
  ecHysteresis: 0.1, phHysteresis: 0.1,
  ecDeviation: 0.5, phDeviation: 0.5,
  minSolarWm2: 50,
  // 하위 호환 (기존 ecCritical/phCritical 참조 코드용 — deprecated, 새 코드는 사용 X)
  ecCritical: 0.1, phCritical: 3.0,
};

const DEFAULT_HARDWARE = {
  modbusUnit: 3, ecSensorAddr: 100, phSensorAddr: 101,
  flowSensorAddr: 102, pumpResponse: 50, dosingPulseUnit: 500,
  // 교반기·산알칼리·온도·유량단위
  mixerOnSec: 30, mixerOffMin: 50,
  acidAlkaliMode: 'both',
  rawTempTarget: 18, outsideTempTarget: 22,
  flowUnit: 'L',
  // 32CH 통합 릴레이 채널 매핑 (환경 0~7 + 양액 8~30)
  relayModule: 'Waveshare 32CH',
  mainPumpCh: 14, agitatorCh: 15, rawSolenoidCh: 30, spareCh: 31,
  valves: Array.from({ length: 14 }, (_, i) => ({ id: i + 1, name: `V${i + 1}`, ch: 16 + i })),
};

async function getOrCreateConfig(farmId) {
  let cfg = await prisma.nutrientConfig.findUnique({ where: { farmId } });
  if (!cfg) {
    cfg = await prisma.nutrientConfig.create({
      data: {
        farmId,
        tanks: [],
        valveCount: 0,
        alerts: DEFAULT_ALERT_THRESHOLDS,
        hardware: DEFAULT_HARDWARE,
      },
    });
  }
  return cfg;
}

async function getOrCreateState(farmId) {
  let st = await prisma.nutrientState.findUnique({ where: { farmId } });
  if (!st) {
    st = await prisma.nutrientState.create({ data: { farmId } });
  }
  return st;
}

async function getOrCreateCounter(farmId) {
  let c = await prisma.nutrientCounter.findUnique({ where: { farmId } });
  if (!c) {
    c = await prisma.nutrientCounter.create({ data: { farmId } });
  }
  return c;
}

// ─────────────────────────────────────────────────────────────────
// 1. 시나리오 CRUD
// ─────────────────────────────────────────────────────────────────

// 목록
router.get("/:farmId/scenarios", async (req, res) => {
  try {
    const { farmId } = req.params;
    const rows = await prisma.nutrientScenario.findMany({
      where: { farmId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    logger.error("scenario list:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 생성
router.post("/:farmId/scenarios", async (req, res) => {
  try {
    const { farmId } = req.params;
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ success: false, error: "이름 필수" });

    const count = await prisma.nutrientScenario.count({ where: { farmId } });
    if (count >= 12) return res.status(400).json({ success: false, error: "시나리오는 최대 12개" });

    const row = await prisma.nutrientScenario.create({
      data: {
        farmId,
        name: b.name,
        enabled: b.enabled !== false,
        active: false,
        ecTarget: b.ecTarget ?? 2.0,
        phTarget: b.phTarget ?? 6.0,
        dosingRatio: b.dosingRatio ?? {},
        irrigationMode: b.irrigationMode ?? "timer",
        solarThreshold: b.solarThreshold ?? null,
        timerInterval: b.timerInterval ?? null,
        timerStart: b.timerStart ?? null,
        timerEnd: b.timerEnd ?? null,
        scheduleSlots: b.scheduleSlots ?? [],
        days: b.days ?? [],
        valves: b.valves ?? [],
        sortOrder: count,
        createdBy: req.user?.id || null,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    logger.error("scenario create:", e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// 수정
router.put("/:farmId/scenarios/:id", async (req, res) => {
  try {
    const { farmId, id } = req.params;
    const fields = [
      "name", "enabled", "ecTarget", "phTarget", "dosingRatio",
      "irrigationMode", "solarThreshold", "timerInterval", "timerStart", "timerEnd",
      "scheduleSlots", "days", "valves", "sortOrder",
    ];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = req.body[f];

    // enabled=false 면 active 도 자동 해제 — 비활성화된 시나리오가 active 로 남아 트리거 평가 모호해지는 race 방지
    if (data.enabled === false) data.active = false;

    const row = await prisma.nutrientScenario.update({
      where: { id },
      data,
    });
    if (row.farmId !== farmId) {
      return res.status(403).json({ success: false, error: "farmId 불일치" });
    }
    res.json({ success: true, data: row });
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ success: false, error: "시나리오 없음" });
    logger.error("scenario update:", e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// 삭제
router.delete("/:farmId/scenarios/:id", async (req, res) => {
  try {
    const { farmId, id } = req.params;
    const row = await prisma.nutrientScenario.findUnique({ where: { id } });
    if (!row || row.farmId !== farmId) {
      return res.status(404).json({ success: false, error: "시나리오 없음" });
    }
    if (row.active) {
      return res.status(400).json({ success: false, error: "활성 시나리오는 삭제 불가 — 다른 시나리오를 먼저 활성화하세요" });
    }
    await prisma.nutrientScenario.delete({ where: { id } });
    res.json({ success: true });
  } catch (e) {
    logger.error("scenario delete:", e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// 활성화 (이전 활성 자동 비활성화)
router.post("/:farmId/scenarios/:id/activate", async (req, res) => {
  try {
    const { farmId, id } = req.params;
    const target = await prisma.nutrientScenario.findUnique({ where: { id } });
    if (!target || target.farmId !== farmId) {
      return res.status(404).json({ success: false, error: "시나리오 없음" });
    }
    if (!target.enabled) {
      return res.status(400).json({ success: false, error: "비활성된 시나리오는 활성화할 수 없습니다" });
    }
    await prisma.$transaction([
      prisma.nutrientScenario.updateMany({ where: { farmId, active: true }, data: { active: false } }),
      prisma.nutrientScenario.update({ where: { id }, data: { active: true } }),
      prisma.nutrientState.upsert({
        where: { farmId },
        update: { activeScenarioId: id },
        create: { farmId, activeScenarioId: id },
      }),
    ]);
    res.json({ success: true });
  } catch (e) {
    logger.error("scenario activate:", e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 2. 농장 설정 (탱크/밸브수/경보/하드웨어)
// ─────────────────────────────────────────────────────────────────

router.get("/:farmId/config", async (req, res) => {
  try {
    const cfg = await getOrCreateConfig(req.params.farmId);
    res.json({ success: true, data: cfg });
  } catch (e) {
    logger.error("config get:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put("/:farmId/config", async (req, res) => {
  try {
    const { farmId } = req.params;
    await getOrCreateConfig(farmId); // ensure exists
    const fields = ["tanks", "valveCount", "alerts", "hardware"];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = req.body[f];
    data.updatedAt = new Date();

    const cfg = await prisma.nutrientConfig.update({ where: { farmId }, data });
    res.json({ success: true, data: cfg });
  } catch (e) {
    logger.error("config put:", e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 3. 운영 상태 + 모드 변경
// ─────────────────────────────────────────────────────────────────

router.get("/:farmId/state", async (req, res) => {
  try {
    const st = await getOrCreateState(req.params.farmId);
    res.json({ success: true, data: st });
  } catch (e) {
    logger.error("state get:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.put("/:farmId/state/mode", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { mode } = req.body;
    const allowed = ["auto", "manual", "paused", "emergency"];
    if (!allowed.includes(mode)) {
      return res.status(400).json({ success: false, error: `mode 는 ${allowed.join("|")} 중 하나` });
    }
    const st = await prisma.nutrientState.upsert({
      where: { farmId },
      update: { mode, updatedAt: new Date() },
      create: { farmId, mode },
    });
    res.json({ success: true, data: st });
  } catch (e) {
    logger.error("state mode:", e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// telemetry 업로드는 /internal/nutrient/state/telemetry (apiKey) 만 허용.
// 농장주 JWT 로 EC/pH/사이클 임의 주입 차단 — 가짜값으로 안전 인터락 트리거 방지.
// 이전: PUT /:farmId/state/telemetry 가 JWT 만 통과하면 쓰기 가능 → 보안 위험으로 제거 (2026-05-21).

// ─────────────────────────────────────────────────────────────────
// 4. 경보 이력
// ─────────────────────────────────────────────────────────────────

router.get("/:farmId/alerts", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { severity, resolved, limit = 50 } = req.query;
    const where = { farmId };
    if (severity) where.severity = severity;
    if (resolved !== undefined) where.resolved = resolved === "true";
    const rows = await prisma.nutrientAlert.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: Math.min(parseInt(limit) || 50, 200),
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    logger.error("alerts list:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/:farmId/alerts", async (req, res) => {
  try {
    const { farmId } = req.params;
    const b = req.body || {};
    if (!b.alertType || !b.message) {
      return res.status(400).json({ success: false, error: "alertType, message 필수" });
    }
    const row = await prisma.nutrientAlert.create({
      data: {
        farmId,
        alertType: b.alertType,
        severity: b.severity || "warning",
        value: b.value ?? null,
        threshold: b.threshold ?? null,
        message: b.message,
        action: b.action ?? null,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.put("/:farmId/alerts/:id/resolve", async (req, res) => {
  try {
    const { farmId, id } = req.params;
    const { action } = req.body || {};
    const existing = await prisma.nutrientAlert.findUnique({ where: { id } });
    if (!existing || existing.farmId !== farmId) {
      return res.status(404).json({ success: false, error: "경보 없음" });
    }
    const row = await prisma.nutrientAlert.update({
      where: { id },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: req.user?.id || null,
        action: action ?? existing.action,
      },
    });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 5. 센서 보정 이력
// ─────────────────────────────────────────────────────────────────

router.get("/:farmId/calibrations", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { sensorType, limit = 20 } = req.query;
    const where = { farmId };
    if (sensorType) where.sensorType = sensorType;
    const rows = await prisma.nutrientCalibration.findMany({
      where,
      orderBy: { calibratedAt: "desc" },
      take: Math.min(parseInt(limit) || 20, 100),
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/:farmId/calibrations", async (req, res) => {
  try {
    const { farmId } = req.params;
    const b = req.body || {};
    if (!b.sensorType || !["ec", "ph"].includes(b.sensorType)) {
      return res.status(400).json({ success: false, error: "sensorType 은 ec|ph" });
    }
    const row = await prisma.nutrientCalibration.create({
      data: {
        farmId,
        sensorType: b.sensorType,
        standardValue: b.standardValue ?? null,
        measuredValue: b.measuredValue ?? null,
        offset: b.offset ?? null,
        slope: b.slope ?? null,
        points: b.points ?? [],
        performedBy: req.user?.id || null,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 6. 누적 카운터
// ─────────────────────────────────────────────────────────────────

router.get("/:farmId/counters", async (req, res) => {
  try {
    const c = await getOrCreateCounter(req.params.farmId);
    res.json({ success: true, data: c });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 증가 (RPi 가 누적값 보고) — body: {doseL, irrigationL, cycles, runtimeMin}
router.post("/:farmId/counters/increment", async (req, res) => {
  try {
    const { farmId } = req.params;
    const b = req.body || {};
    await getOrCreateCounter(farmId);
    const c = await prisma.nutrientCounter.update({
      where: { farmId },
      data: {
        totalDoseL:       { increment: b.doseL || 0 },
        totalIrrigationL: { increment: b.irrigationL || 0 },
        totalCycles:      { increment: b.cycles || 0 },
        pumpRuntimeMin:   { increment: b.runtimeMin || 0 },
        updatedAt:        new Date(),
      },
    });
    res.json({ success: true, data: c });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// 초기화 (특정 카운터 또는 전체) — body: {target: 'dose'|'irrigation'|'cycles'|'runtime'|'all'}
router.post("/:farmId/counters/reset", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { target } = req.body || {};
    const allowed = ["dose", "irrigation", "cycles", "runtime", "all"];
    if (!allowed.includes(target)) {
      return res.status(400).json({ success: false, error: `target 은 ${allowed.join("|")}` });
    }
    await getOrCreateCounter(farmId);
    const data = { lastResetAt: new Date(), updatedAt: new Date() };
    if (target === "dose" || target === "all") data.totalDoseL = 0;
    if (target === "irrigation" || target === "all") data.totalIrrigationL = 0;
    if (target === "cycles" || target === "all") data.totalCycles = 0;
    if (target === "runtime" || target === "all") data.pumpRuntimeMin = 0;
    const c = await prisma.nutrientCounter.update({ where: { farmId }, data });
    res.json({ success: true, data: c });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// 필터 교체 기록
router.post("/:farmId/counters/filter-change", async (req, res) => {
  try {
    const { farmId } = req.params;
    await getOrCreateCounter(farmId);
    const c = await prisma.nutrientCounter.update({
      where: { farmId },
      data: { filterChangeAt: new Date(), updatedAt: new Date() },
    });
    res.json({ success: true, data: c });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 7. 수동 1회 공급 작업 (manual mode 의 ad-hoc 큐)
// ─────────────────────────────────────────────────────────────────

const MANUAL_STATUSES = ["pending", "running", "completed", "aborted", "cancelled"];

// 작업 생성 — 즉시 (scheduleAt null) 또는 24시간 이내 예약
router.post("/:farmId/cycle/manual-trigger", async (req, res) => {
  try {
    const { farmId } = req.params;
    const b = req.body || {};
    if (!Array.isArray(b.valves) || b.valves.length === 0) {
      return res.status(400).json({ success: false, error: "valves 1개 이상 필수" });
    }
    let scheduleAt = null;
    if (b.scheduleAt) {
      scheduleAt = new Date(b.scheduleAt);
      if (isNaN(scheduleAt.getTime())) {
        return res.status(400).json({ success: false, error: "scheduleAt 형식 오류" });
      }
      const diff = scheduleAt.getTime() - Date.now();
      if (diff > 24 * 60 * 60 * 1000) {
        return res.status(400).json({ success: false, error: "예약은 24시간 이내만 가능" });
      }
      if (diff < -60 * 1000) {
        return res.status(400).json({ success: false, error: "scheduleAt 은 미래여야" });
      }
    }
    const row = await prisma.nutrientManualJob.create({
      data: {
        farmId,
        scenarioId: b.scenarioId || null,
        scenarioName: b.scenarioName || null,
        programNum: b.programNum ?? null,
        valves: b.valves,
        volumeML: b.volumeML ?? null,
        scheduleAt,
        status: "pending",
        createdBy: req.user?.id || null,
      },
    });

    // 즉시 실행 (예약 X) 일 때만 MQTT push — RPi NR 가 polling 대기 없이 즉시 dispatch
    if (!scheduleAt) {
      try {
        const mqttService = (await import("../services/mqttClient.js")).default;
        if (mqttService.isConnected?.()) {
          mqttService.publishNutrientManualTrigger(farmId, row.id);
        }
      } catch (e) {
        logger.warn("manual-trigger MQTT publish 실패 (polling fallback):", e.message);
      }
    }

    res.status(201).json({ success: true, data: row });
  } catch (e) {
    logger.error("manual-trigger:", e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// 목록 조회 (status 필터, 최근 createdAt 순)
router.get("/:farmId/cycle/manual-jobs", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { status, limit = 50 } = req.query;
    const where = { farmId };
    if (status) {
      const list = String(status).split(",").filter(s => MANUAL_STATUSES.includes(s));
      if (list.length) where.status = { in: list };
    }
    const rows = await prisma.nutrientManualJob.findMany({
      where,
      orderBy: [{ scheduleAt: "asc" }, { createdAt: "desc" }],
      take: Math.min(parseInt(limit) || 50, 200),
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    logger.error("manual-jobs list:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 예약 작업 취소 (pending 만)
router.delete("/:farmId/cycle/manual-jobs/:id", async (req, res) => {
  try {
    const { farmId, id } = req.params;
    const existing = await prisma.nutrientManualJob.findUnique({ where: { id } });
    if (!existing || existing.farmId !== farmId) {
      return res.status(404).json({ success: false, error: "작업 없음" });
    }
    if (existing.status !== "pending") {
      return res.status(400).json({ success: false, error: `${existing.status} 상태는 취소 불가` });
    }
    const row = await prisma.nutrientManualJob.update({
      where: { id },
      data: { status: "cancelled", cancelledAt: new Date() },
    });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// 진행 중 작업 중단 (running → aborted)
router.post("/:farmId/cycle/abort", async (req, res) => {
  try {
    const { farmId } = req.params;
    const running = await prisma.nutrientManualJob.findFirst({
      where: { farmId, status: "running" },
    });
    if (!running) return res.status(404).json({ success: false, error: "진행 중 작업 없음" });
    const row = await prisma.nutrientManualJob.update({
      where: { id: running.id },
      data: { status: "aborted", endedAt: new Date() },
    });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;
