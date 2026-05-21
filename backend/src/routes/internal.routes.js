// src/routes/internal.routes.js
// Node-RED 내부 통신용 엔드포인트 (기존 /internal/* 호환)
// f2~f7, f10 탭에서 호출

import express from "express";
import Alert from "../models/Alert.js";
import ControlLog from "../models/ControlLog.js";
import Config from "../models/Config.js";
import { pool, prisma } from "../db.js";
import logger from "../utils/logger.js";

const router = express.Router();

const DEFAULT_FARM_ID = process.env.FARM_ID || "farm_0001";
const DEFAULT_HOUSE_ID = process.env.HOUSE_ID || "house_0001";

function resolveFarmHouse(req) {
  return {
    farmId: req.body?.farmId || req.query?.farmId || DEFAULT_FARM_ID,
    houseId: req.body?.houseId || req.query?.houseId || DEFAULT_HOUSE_ID,
  };
}

/**
 * POST /internal/status-update
 * 장비 상태 업데이트 (f2, f4, f6, f10)
 * Node-RED가 밸브/펌프/믹서 상태를 전송
 */
router.post("/status-update", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const status = req.body;
    logger.info("장비 상태 수신:", JSON.stringify(status).slice(0, 200));

    // control_logs 테이블에 상태 기록
    if (status.operating_state || status.valve_states) {
      await pool.query(
        `INSERT INTO control_logs (farm_id, house_id, device_id, device_type, command, success, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          farmId,
          houseId,
          "system",
          "status_update",
          JSON.stringify(status),
          true,
        ]
      );
    }

    res.json({ success: true, message: "상태 업데이트 완료" });
  } catch (error) {
    logger.error("상태 업데이트 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /internal/programs
 * 관수 프로그램 목록 (f3 관수 스케줄러)
 * automation 규칙 중 관수 관련 규칙을 반환
 */
router.get("/programs", async (req, res) => {
  try {
    const { farmId } = resolveFarmHouse(req);
    const { rows } = await pool.query(
      `SELECT * FROM automation_rules
       WHERE farm_id = $1 AND enabled = true
       ORDER BY created_at`,
      [farmId]
    );

    // Node-RED 관수 스케줄러 호환 형태로 변환
    const programs = rows.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      conditions: rule.conditions,
      actions: rule.actions,
      schedule: rule.time_conditions || {},
    }));

    res.json({ success: true, data: programs });
  } catch (error) {
    logger.error("프로그램 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /internal/config
 * 하우스 설정 (f5 경보 처리 - 임계값 조회)
 */
router.get("/config", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const config = await Config.findOne({ farmId, houseId });

    if (!config) {
      // 기본 임계값 반환
      return res.json({
        success: true,
        data: {
          alarm_ec_upper: 3.5,
          alarm_ec_lower: 0.3,
          alarm_ph_upper: 8.5,
          alarm_ph_lower: 4.5,
          alarm_temp_upper: 40,
          alarm_temp_lower: 5,
        },
      });
    }

    // config에서 알람 임계값 추출
    const thresholds = config.thresholds || config.alarmThresholds || {};
    res.json({
      success: true,
      data: {
        alarm_ec_upper: thresholds.ecUpper || 3.5,
        alarm_ec_lower: thresholds.ecLower || 0.3,
        alarm_ph_upper: thresholds.phUpper || 8.5,
        alarm_ph_lower: thresholds.phLower || 4.5,
        alarm_temp_upper: thresholds.tempUpper || 40,
        alarm_temp_lower: thresholds.tempLower || 5,
        ...thresholds,
      },
    });
  } catch (error) {
    logger.error("설정 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /internal/alarm
 * 경보 생성 (Node-RED → 백엔드)
 * 지원 필드: alarm_type, severity, message, alarm_value, threshold_value,
 *           sensorId, metadata, cooldownMinutes
 */
router.post("/alarm", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const alarm = req.body;
    const alertType = alarm.alarm_type || alarm.alertType;
    const severity = (alarm.severity || "WARNING").toUpperCase();

    logger.warn("경보 수신:", alertType, severity, alarm.message);

    // 서킷 브레이커: 같은 유형의 미확인 알림이 3개 이상이면 추가 생성 차단
    const maxUnacknowledged = alarm.maxUnacknowledged || 3;
    const unackAlerts = await Alert.find(
      { farmId, houseId: alarm.houseId || houseId },
      { limit: 50 }
    );
    const unackCount = unackAlerts.filter(
      (a) =>
        a.alertType === alertType &&
        (!alarm.sensorId || a.sensorId === alarm.sensorId) &&
        !a.acknowledged
    ).length;
    if (unackCount >= maxUnacknowledged) {
      return res.json({ success: true, skipped: true, reason: "circuit_breaker", unackCount });
    }

    // 쿨다운 중복 방지: cooldownMinutes가 있으면 최근 알림 체크
    if (alarm.cooldownMinutes && alarm.cooldownMinutes > 0) {
      const cooldownMs = alarm.cooldownMinutes * 60 * 1000;
      const now = Date.now();
      const duplicate = unackAlerts.find(
        (a) =>
          a.alertType === alertType &&
          (!alarm.sensorId || a.sensorId === alarm.sensorId) &&
          a.createdAt &&
          now - new Date(a.createdAt).getTime() < cooldownMs
      );
      if (duplicate) {
        return res.json({ success: true, skipped: true, reason: "cooldown" });
      }
    }

    const alert = await Alert.create({
      farmId,
      houseId: alarm.houseId || houseId,
      sensorId: alarm.sensorId || null,
      alertType,
      severity,
      message: alarm.message,
      value: alarm.alarm_value ?? alarm.value,
      threshold: alarm.threshold_value ?? alarm.threshold,
      metadata: alarm.metadata || {},
      acknowledged: false,
    });

    res.json({ success: true, data: alert });
  } catch (error) {
    logger.error("경보 생성 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /internal/daily-summary-data
 * 일일 집계용 센서 평균 데이터 (f7 일일집계)
 */
router.get("/daily-summary-data", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    // sensor_data 테이블: data JSONB에 센서값 저장 (sensor_id 컬럼 없음)
    const { rows } = await pool.query(
      `SELECT data
       FROM sensor_data
       WHERE farm_id = $1 AND house_id = $2
         AND timestamp >= $3::date AND timestamp < ($3::date + interval '1 day')`,
      [farmId, houseId, dateStr]
    );

    // JSONB data에서 센서별 통계 계산
    const sensorValues = {};
    rows.forEach((row) => {
      const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      for (const [sensorId, value] of Object.entries(data || {})) {
        const numVal = parseFloat(value);
        if (isNaN(numVal)) continue;
        if (!sensorValues[sensorId]) sensorValues[sensorId] = [];
        sensorValues[sensorId].push(numVal);
      }
    });

    const sensorAverages = {};
    for (const [sensorId, values] of Object.entries(sensorValues)) {
      const sum = values.reduce((a, b) => a + b, 0);
      sensorAverages[sensorId] = {
        avg: Math.round((sum / values.length) * 100) / 100,
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
      };
    }

    res.json({ success: true, data: { date: dateStr, sensor_averages: sensorAverages } });
  } catch (error) {
    logger.error("일일 집계 데이터 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /internal/daily-summary
 * 일일 집계 저장 (f7 일일집계)
 */
router.post("/daily-summary", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const summary = req.body;
    logger.info("일일 집계 수신:", summary.date);

    await pool.query(
      `INSERT INTO daily_summaries (farm_id, house_id, date, summary_data, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (farm_id, house_id, date) DO UPDATE SET summary_data = $4`,
      [farmId, houseId, summary.date, JSON.stringify(summary)]
    );

    res.json({ success: true, message: "일일 집계 저장 완료" });
  } catch (error) {
    logger.error("일일 집계 저장 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /internal/farm-event
 * RPi 시스템 이벤트 (USB_DISCONNECT, MODBUS_FAILURE, NODERED_RESTARTED 등)
 * RPi의 udev hook, Node-RED 워치독, 헬스체크 cron이 호출
 *
 * Body: { eventType, severity?, message?, payload?, cooldownMinutes? }
 * 같은 farmId+eventType 의 미확인 알림이 cooldown 내 있으면 중복 차단.
 */
router.post("/farm-event", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const {
      eventType,
      severity: rawSeverity,
      message,
      payload,
      cooldownMinutes,
    } = req.body || {};

    if (!eventType) {
      return res.status(400).json({ success: false, error: "eventType 필수" });
    }

    const SEV_DEFAULT = {
      USB_DISCONNECT: "WARNING",
      USB_RECONNECTED: "INFO",
      MODBUS_FAILURE: "CRITICAL",
      MODBUS_RECOVERED: "INFO",
      NODERED_RESTARTED: "INFO",
      NODERED_HANG: "CRITICAL",
    };
    const severity = (rawSeverity || SEV_DEFAULT[eventType] || "WARNING").toUpperCase();

    // 쿨다운 (기본 5분, INFO 류는 1분)
    const cooldownMs =
      ((cooldownMinutes ?? (severity === "INFO" ? 1 : 5)) * 60 * 1000);

    if (cooldownMs > 0) {
      const recent = await Alert.find({ farmId }, { limit: 30 });
      const dup = recent.find(
        (a) =>
          a.alertType === eventType &&
          a.createdAt &&
          Date.now() - new Date(a.createdAt).getTime() < cooldownMs
      );
      if (dup) {
        return res.json({ success: true, skipped: true, reason: "cooldown" });
      }
    }

    const defaultMessage = {
      USB_DISCONNECT: "USB-485 어댑터 분리 감지",
      USB_RECONNECTED: "USB-485 어댑터 재연결",
      MODBUS_FAILURE: "Modbus 통신 장애 (워치독 임계치 초과)",
      MODBUS_RECOVERED: "Modbus 통신 정상 복구",
      NODERED_RESTARTED: "Node-RED 자동 재시작 완료",
      NODERED_HANG: "Node-RED 헬스체크 실패 (hang)",
    };

    const alert = await Alert.create({
      farmId,
      houseId: req.body?.houseId || "FARM",
      alertType: eventType,
      severity,
      message: message || defaultMessage[eventType] || eventType,
      metadata: payload || {},
    });

    logger.warn(`[farm-event] ${farmId} ${eventType} [${severity}]`);
    res.json({ success: true, data: alert });
  } catch (error) {
    logger.error("farm-event 처리 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /internal/control-log
 * 자동화 제어 이력 저장 (Node-RED → 백엔드)
 * ④⑤ 스케줄 실행, ② 센서 규칙 평가에서 호출
 */
router.post("/control-log", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const {
      deviceId, deviceType, deviceName, command,
      success, ruleName, ruleId, reason,
    } = req.body;

    if (!deviceId || !command) {
      return res.status(400).json({ success: false, error: "deviceId, command 필수" });
    }

    const log = await ControlLog.create({
      farmId,
      houseId,
      deviceId,
      deviceType: deviceType || "relay",
      deviceName: deviceName || deviceId,
      command,
      success: success !== false,
      operator: "automation",
      operatorName: ruleName || "자동화",
      isAutomatic: true,
      automationRuleId: ruleId || null,
      automationReason: reason || null,
    });

    res.json({ success: true, data: { id: log._id } });
  } catch (error) {
    logger.error("자동화 제어 이력 저장 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 양액 관리 — RPi Node-RED 전용 (Phase 3)
// /internal/nutrient/* — authenticateApiKey 적용 (req.farmId 자동 설정)
// 사용자 UI 는 /api/nutrient/* (JWT) 별도 사용
//
// 보안: req.farmId 가 apiKey 와 1:1 매핑이어야 함.
// query string / body 의 farmId 는 무시 (이전 fallback 은 다농장 사칭 가능 → 제거).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function requireFarmId(req, res) {
  if (!req.farmId) {
    res.status(401).json({ success: false, error: "apiKey 의 farmId 매핑 누락" });
    return null;
  }
  return req.farmId;
}

// 설정 조회 (탱크/밸브/경보/하드웨어)
router.get("/nutrient/config", async (req, res) => {
  try {
    const farmId = requireFarmId(req, res); if (!farmId) return;
    let cfg = await prisma.nutrientConfig.findUnique({ where: { farmId } });
    if (!cfg) cfg = { farmId, tanks: [], valveCount: 0, alerts: {}, hardware: {} };
    res.json({ success: true, data: cfg });
  } catch (e) {
    logger.error("internal nutrient config:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// 시나리오 조회 (active 만 필요해도 전체 반환 — RPi 가 find(active) 처리)
router.get("/nutrient/scenarios", async (req, res) => {
  try {
    const farmId = requireFarmId(req, res); if (!farmId) return;
    const rows = await prisma.nutrientScenario.findMany({
      where: { farmId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 운영 상태 조회 (mode 등)
router.get("/nutrient/state", async (req, res) => {
  try {
    const farmId = requireFarmId(req, res); if (!farmId) return;
    let st = await prisma.nutrientState.findUnique({ where: { farmId } });
    if (!st) st = await prisma.nutrientState.create({ data: { farmId } });
    res.json({ success: true, data: st });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// telemetry 업로드 (EC/pH/currentCycle/solarAccumulated)
router.put("/nutrient/state/telemetry", async (req, res) => {
  try {
    const farmId = requireFarmId(req, res); if (!farmId) return;
    const b = req.body || {};
    const data = { updatedAt: new Date() };
    if (b.ecCurrent !== undefined) data.ecCurrent = b.ecCurrent;
    if (b.phCurrent !== undefined) data.phCurrent = b.phCurrent;
    if (b.solarAccumulated !== undefined) data.solarAccumulated = b.solarAccumulated;
    if (b.currentCycle !== undefined) data.currentCycle = b.currentCycle;
    const st = await prisma.nutrientState.upsert({
      where: { farmId }, update: data, create: { farmId, ...data },
    });
    res.json({ success: true, data: st });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// 경보 생성 (RPi 에서 한계 초과 발견 시)
router.post("/nutrient/alerts", async (req, res) => {
  try {
    const farmId = requireFarmId(req, res); if (!farmId) return;
    const b = req.body || {};
    if (!b.type && !b.alertType) {
      return res.status(400).json({ success: false, error: "alertType 필수" });
    }
    const row = await prisma.nutrientAlert.create({
      data: {
        farmId,
        alertType: b.alertType || b.type,
        severity: b.severity || "warning",
        value: b.value ?? null,
        threshold: b.threshold ?? null,
        message: b.message || b.alertType || b.type,
        action: b.action ?? null,
      },
    });
    res.status(201).json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// 누적 카운터 증가 (RPi 가 사이클 완료 시)
router.post("/nutrient/counters/increment", async (req, res) => {
  try {
    const farmId = requireFarmId(req, res); if (!farmId) return;
    const b = req.body || {};
    // ensure row
    let c = await prisma.nutrientCounter.findUnique({ where: { farmId } });
    if (!c) c = await prisma.nutrientCounter.create({ data: { farmId } });
    c = await prisma.nutrientCounter.update({
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

// 수동 작업 — pending + due (scheduleAt 도래 또는 null=즉시) 목록
// RPi 가 1분 주기로 poll
router.get("/nutrient/manual-jobs/pending", async (req, res) => {
  try {
    const farmId = requireFarmId(req, res); if (!farmId) return;
    const rows = await prisma.nutrientManualJob.findMany({
      where: {
        farmId, status: "pending",
        OR: [{ scheduleAt: null }, { scheduleAt: { lte: new Date() } }],
      },
      orderBy: [{ scheduleAt: "asc" }, { createdAt: "asc" }],
    });
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 작업 상태 업데이트 — RPi 가 running → completed/aborted 전환 시 호출
router.put("/nutrient/manual-jobs/:id/status", async (req, res) => {
  try {
    const farmId = requireFarmId(req, res); if (!farmId) return;
    const { id } = req.params;
    const { status } = req.body || {};
    const allowed = ["running", "completed", "aborted"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: `status 는 ${allowed.join("|")}` });
    }
    const existing = await prisma.nutrientManualJob.findUnique({ where: { id } });
    if (!existing || existing.farmId !== farmId) {
      return res.status(404).json({ success: false, error: "작업 없음" });
    }
    const data = { status };
    if (status === "running") data.startedAt = new Date();
    if (status === "completed" || status === "aborted") data.endedAt = new Date();
    const row = await prisma.nutrientManualJob.update({ where: { id }, data });
    res.json({ success: true, data: row });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;
