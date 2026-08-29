// src/routes/internal.routes.js
// Node-RED 내부 통신용 엔드포인트 (기존 /internal/* 호환)
// f2~f7, f10 탭에서 호출

import express from "express";
import Alert from "../models/Alert.js";
import ControlLog from "../models/ControlLog.js";
import Config from "../models/Config.js";
import { pool, prisma } from "../db.js";
import logger from "../utils/logger.js";
import { setStepStatus, clearStepStatus } from "../utils/stepStatusStore.js";

const router = express.Router();

const DEFAULT_FARM_ID = process.env.FARM_ID || "farm_0001";
const DEFAULT_HOUSE_ID = process.env.HOUSE_ID || "house_0001";

// 서킷 브레이커가 미확인 알림을 세는 구간.
// 전 기간을 세면 영구 래치되어 감지가 죽는다 (스케줄러 3종과 동일한 이유).
const ALARM_UNACK_WINDOW_MS = 24 * 60 * 60 * 1000;

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
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Alertmanager webhook 수신
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2026-08-25 신설. 알림 경로를 채널과 분리하기 위한 단일 수신구.
//   Prometheus 규칙 → Alertmanager → 여기 → alerts 테이블 (+ 향후 카카오/이메일)
// 채널을 추가/교체할 때 Alertmanager 설정은 건드리지 않고 이 함수만 고치면 된다.
//
// 인증: authenticateApiKey 가 req.query.apiKey 도 받으므로
//       Alertmanager URL 에 ?apiKey=... 로 붙인다.
router.post("/alert-webhook", async (req, res) => {
  try {
    const alerts = Array.isArray(req.body?.alerts) ? req.body.alerts : [];
    if (alerts.length === 0) {
      return res.json({ success: true, received: 0 });
    }

    const { pool } = await import("../db.js");
    let saved = 0;

    for (const a of alerts) {
      const labels = a.labels || {};
      const ann = a.annotations || {};
      const alertName = labels.alertname || "UnknownAlert";
      const status = a.status || "firing";               // firing | resolved
      const severity = (labels.severity || "warning").toUpperCase();

      // farm_id / house_id 는 NOT NULL — 라벨에 없으면 시스템 알림으로 표기
      const farmId = labels.farm_id || labels.farm || "system";
      // 농장 단위 알림은 FARM 으로 통일한다 — 예전에는 "-" 를 썼는데
      // 화면이 하우스로 걸러 조회할 때 두 값이 갈려 있으면 놓치기 쉽다.
      const houseId = labels.house_id || "FARM";

      const message =
        (status === "resolved" ? "[해소] " : "") +
        (ann.summary || alertName) +
        (ann.description ? " — " + ann.description : "");

      await pool.query(
        `INSERT INTO alerts (farm_id, house_id, alert_type, severity, message, metadata, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
        [
          farmId,
          houseId,
          alertName,
          status === "resolved" ? "INFO" : severity,
          message.slice(0, 1000),
          JSON.stringify({
            source: "alertmanager",
            status,
            labels,
            annotations: ann,
            startsAt: a.startsAt || null,
            endsAt: a.endsAt || null,
          }),
        ]
      );
      saved++;

      const icon = status === "resolved" ? "✅" : severity === "CRITICAL" ? "🔴" : "🟡";
      logger.warn(`${icon} [알림] ${alertName} (${farmId}/${houseId}) — ${ann.summary || ""}`);

      // CRITICAL(발화)이고 실제 농장이면 L1 자동 진단 (읽기 전용, 비동기 — 2026-08-30).
      // farm_id 라벨이 없는 인프라 알림("system")은 농장 증거가 없어 제외.
      if (status !== "resolved" && severity === "CRITICAL" && farmId !== "system") {
        import("../services/diagnosisAgent.js")
          .then((m) => m.runDiagnosis({ farmId, alertType: alertName, severity, message }))
          .catch(() => {});
      }
    }

    // TODO: 카카오 알림톡 — 발신프로필 + 템플릿 심사 완료 후 여기에 추가.
    //       critical 만 즉시 발송, warning 은 요약 발송을 권장.

    res.json({ success: true, received: alerts.length, saved });
  } catch (error) {
    logger.error("Alertmanager webhook 처리 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

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

    // 서킷 브레이커: 최근 24시간 내 같은 유형의 미확인 알림이 3개 이상이면 차단
    //
    // ★ 시간 조건이 반드시 있어야 한다.
    //   전 기간 미확인을 세면, 아무도 확인 버튼을 누르지 않는 한 브레이커가
    //   영원히 열린 채 남아 감지 자체가 죽는다. 스케줄러 3종에서 실제로 그랬고
    //   (farm_0001 은 07-18 이후 오프라인 감지 정지), 이 라우트도 같은 구조였다.
    //   여기는 그동안 호출 경로가 404 라 알림이 쌓이지 않아 드러나지 않았을 뿐이다.
    //   2026-08-26 경로를 고치면서 함께 수정한다.
    const maxUnacknowledged = alarm.maxUnacknowledged || 3;
    const unackSince = Date.now() - ALARM_UNACK_WINDOW_MS;
    const unackAlerts = await Alert.find(
      { farmId, houseId: alarm.houseId || houseId },
      { limit: 50 }
    );
    const unackCount = unackAlerts.filter(
      (a) =>
        a.alertType === alertType &&
        (!alarm.sensorId || a.sensorId === alarm.sensorId) &&
        !a.acknowledged &&
        a.createdAt &&
        new Date(a.createdAt).getTime() >= unackSince
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

// POST /internal/daily-summary 는 2026-08-29 삭제했다.
// 쓰던 daily_summaries 테이블이 리포에도 운영 DB 에도 없어 호출되면 항상 500 이었고,
// 로그상 호출된 적도 없다 (호출자였던 NR f7 일일집계 탭은 삭제 예정 레거시).
// 일일 통계 조회(GET /internal/daily-summary)는 sensor_data 실시간 집계라 영향 없다.
// 필요해지면 그때 테이블 DDL 과 함께 다시 만든다.

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

    // 자동화 발동이면 rule 의 lastTriggeredAt + triggerCount 도 갱신
    // 시간 조건 단독 발동(④⑤)은 evaluate endpoint 안 거쳐 갱신 누락되던 케이스 보완
    //
    // ★ command 구분: ON-style(on/open/close)만 발동 카운트.
    //   NR ⑤ 가 Duration 종료 OFF 도 같은 sendControlLog 로 호출 → 그대로 갱신하면
    //   lastTriggeredAt 가 OFF 시점으로 잘못 갱신되어 frontend 카운트다운이
    //   동작 종료 후에도 "▶ 동작중" 으로 N초 더 표시되는 모순 발생.
    // ★ 거부/스킵 (success=false) 은 lastTriggered 갱신 안 함
    //   기록은 control_logs 에 저장 (success=false + reason) → 거부 사유 추적 가능
    const TRIGGER_COMMANDS = new Set(["on", "open", "close"]);
    if (ruleId && TRIGGER_COMMANDS.has(command) && success !== false) {
      await prisma.automationRule.update({
        where: { id: ruleId },
        data: {
          lastTriggeredAt: new Date(),
          triggerCount: { increment: 1 },
        },
      }).catch((err) => logger.warn(`lastTriggeredAt 갱신 실패 (ruleId=${ruleId}): ${err?.message}`));
    }

    res.json({ success: true, data: { id: log._id } });
  } catch (error) {
    logger.error("자동화 제어 이력 저장 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /internal/control-log/batch
 * RPi 로컬 SQLite 의 제어 이력 소급/재전송 (Node-RED 데이터 동기화 탭)
 *
 * 왜 필요한가 —
 *   NR 자동화는 제어 실행 시점에 POST /internal/control-log 로 실시간 전송하는데,
 *   그 호출이 실패하면(오프라인·서버 재시작 등) 기록이 RPi 로컬에만 남는다.
 *   2026-08-26 점검에서 로컬 10,106건 중 983건(18.4%)이 서버에 없는 것을 확인했다.
 *   로컬 control_logs 에는 전송 갈래가 아예 구현된 적이 없어 synced 가 100% 0 이었다.
 *
 * 멱등성 — 재시도해도 중복이 생기지 않아야 한다. 두 단계로 거른다.
 *   1) request_id 일치        → 이전에 이 엔드포인트가 이미 넣은 것
 *   2) 같은 (농장,장치,명령) 이 ±TOLERANCE_SEC 안에 존재 → 실시간 경로가 이미 기록한 것
 *   둘 다 아니면 삽입. idx_control_logs_farm_device 인덱스를 그대로 탄다.
 *
 * house_id — RPi 로컬 테이블에는 house_id 컬럼이 없다(다중하우스 전환 8/25 이전 기록).
 *   같은 기간 서버 기록 9,600건이 100% house_0001 이고, 현재 제어 장치가 있는
 *   하우스도 house_0001 뿐이라 그것으로 채운다. 추정을 숨기지 않으려고
 *   operator='rpi_backfill' 로 표시해 두므로, 판단이 바뀌면 한 번의 UPDATE 로 정정된다.
 *
 * payload: { farmId?, houseId?, logs: [{ localId, timestamp, deviceId, command, source }] }
 */
const BACKFILL_TOLERANCE_SEC = 15;
const BACKFILL_MAX_BATCH = 500;

router.post("/control-log/batch", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const logs = Array.isArray(req.body?.logs) ? req.body.logs : [];

    if (logs.length === 0) {
      return res.json({ success: true, received: 0, inserted: 0, skipped: 0, results: [] });
    }
    if (logs.length > BACKFILL_MAX_BATCH) {
      return res.status(413).json({
        success: false,
        error: `한 번에 ${BACKFILL_MAX_BATCH}건까지 — 받은 건수 ${logs.length}`,
      });
    }

    const results = [];
    let inserted = 0;
    let skipped = 0;

    for (const row of logs) {
      const localId = row?.localId;
      const deviceId = row?.deviceId;
      const command = row?.command;
      const ts = row?.timestamp;

      if (localId === undefined || localId === null || !deviceId || !command || !ts) {
        results.push({ localId: localId ?? null, status: "invalid" });
        continue;
      }

      const when = new Date(ts);
      if (Number.isNaN(when.getTime())) {
        results.push({ localId, status: "invalid" });
        continue;
      }

      const requestId = `rpi:${farmId}:${localId}`;

      // 1) 이 엔드포인트가 이미 넣었나 (재시도 안전)
      const byReq = await pool.query(
        "SELECT 1 FROM control_logs WHERE request_id = $1 LIMIT 1",
        [requestId]
      );
      if (byReq.rowCount > 0) {
        skipped++;
        results.push({ localId, status: "duplicate_request" });
        continue;
      }

      // 2) 실시간 경로가 이미 기록했나 (시각 오차 허용)
      //
      // ★ operator <> 'rpi_backfill' 조건이 반드시 있어야 한다.
      //   없으면 방금 이 배치가 넣은 행까지 조회에 걸려 소급분끼리 서로를 지운다.
      //   2026-08-26 첫 실행에서 실제로 그랬다 — 서버에 아무 기록도 없던
      //   구간(~03-24)에서조차 1,252건이 "중복"으로 폐기됐다. 측창을 열었다
      //   멈췄다 다시 여는 식의 수 초 간격 반복 조작이 통째로 사라지는 증상이었다.
      //   각 로컬 기록은 request_id 로 이미 고유하므로(1단계), 여기서는
      //   '실시간 경로가 남긴 행' 만 봐야 한다.
      const byWindow = await pool.query(
        `SELECT 1 FROM control_logs
          WHERE farm_id = $1 AND device_id = $2 AND command = $3
            AND (operator IS DISTINCT FROM 'rpi_backfill')
            AND timestamp BETWEEN $4::timestamptz - ($5 || ' seconds')::interval
                              AND $4::timestamptz + ($5 || ' seconds')::interval
          LIMIT 1`,
        [farmId, deviceId, command, when.toISOString(), String(BACKFILL_TOLERANCE_SEC)]
      );
      if (byWindow.rowCount > 0) {
        skipped++;
        results.push({ localId, status: "duplicate_realtime" });
        continue;
      }

      // source 가 'local' 이면 사람이 누른 것, 나머지(automation*)는 자동화
      const src = String(row.source || "");
      const isAuto = src.startsWith("automation");

      await pool.query(
        `INSERT INTO control_logs
           (timestamp, farm_id, house_id, device_id, device_type, device_name,
            command, success, request_id, operator, operator_name,
            is_automatic, automation_reason, created_at)
         VALUES ($1, $2, $3, $4, 'relay', $4, $5, true, $6, 'rpi_backfill', $7, $8, $9, NOW())`,
        [
          when.toISOString(),
          farmId,
          houseId,
          deviceId,
          command,
          requestId,
          isAuto ? "자동화(소급)" : "로컬 제어(소급)",
          isAuto,
          src ? `RPi 로컬 기록 소급 (source=${src})` : "RPi 로컬 기록 소급",
        ]
      );
      inserted++;
      results.push({ localId, status: "inserted" });
    }

    logger.info(
      `제어 이력 소급 수신 (${farmId}/${houseId}): ${logs.length}건 → 삽입 ${inserted} / 중복 ${skipped}`
    );

    res.json({
      success: true,
      received: logs.length,
      inserted,
      skipped,
      results,
    });
  } catch (error) {
    logger.error("제어 이력 배치 저장 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /internal/step-status
 * NR ⑤ stepped step 발사 / 완료 알림 (frontend NextRunCountdown 동기화용)
 *
 * payload:
 *   { farmId, deviceId, ruleId?, command, target, currentPos,
 *     stepStartedAt, stepDurSec, stepPauseSec, nextStepAt, phase: 'running'|'completed' }
 *
 * - phase='running': step 발사 직후 (모터 회전 중)
 * - phase='completed': stepped 종료 (목표 도달 + stop 발사)
 *
 * 메모리 store 만 사용 (DB 저장 X) — backend 재시작 시 휘발 OK.
 * frontend 가 schedule API 통해 조회.
 */
router.post("/step-status", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const { deviceId, phase, ...info } = req.body || {};
    if (!deviceId) {
      return res.status(400).json({ success: false, error: "deviceId 필수" });
    }
    if (phase === "completed") {
      clearStepStatus(farmId, deviceId);
    } else {
      setStepStatus(farmId, deviceId, { ...info, phase: phase || "running", houseId });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error("step-status 처리 실패:", error);
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
// mode != 'manual' 면 빈 배열 반환 (사용자가 모드 잠갔다는 의미 — 큐 유지하되 실행 X)
// 응답에 scenario 객체도 join (RPi 가 별도 fetch 불필요)
router.get("/nutrient/manual-jobs/pending", async (req, res) => {
  try {
    const farmId = requireFarmId(req, res); if (!farmId) return;
    const state = await prisma.nutrientState.findUnique({ where: { farmId } });
    if (state?.mode !== "manual") {
      return res.json({ success: true, data: [], reason: `mode=${state?.mode}` });
    }
    const rows = await prisma.nutrientManualJob.findMany({
      where: {
        farmId, status: "pending",
        OR: [{ scheduleAt: null }, { scheduleAt: { lte: new Date() } }],
      },
      orderBy: [{ scheduleAt: "asc" }, { createdAt: "asc" }],
    });
    // scenario 객체 join — 한 번에 fetch
    const scenarioIds = [...new Set(rows.map(r => r.scenarioId).filter(Boolean))];
    const scenarios = scenarioIds.length
      ? await prisma.nutrientScenario.findMany({ where: { id: { in: scenarioIds } } })
      : [];
    const map = Object.fromEntries(scenarios.map(s => [s.id, s]));
    const enriched = rows.map(r => ({ ...r, scenario: map[r.scenarioId] || null }));
    res.json({ success: true, data: enriched });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 단일 작업 상세 조회 — abort-watcher 가 5초 주기로 status 확인
router.get("/nutrient/manual-jobs/:id", async (req, res) => {
  try {
    const farmId = requireFarmId(req, res); if (!farmId) return;
    const { id } = req.params;
    const row = await prisma.nutrientManualJob.findUnique({ where: { id } });
    if (!row || row.farmId !== farmId) {
      return res.status(404).json({ success: false, error: "작업 없음" });
    }
    res.json({ success: true, data: row });
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
