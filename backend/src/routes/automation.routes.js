// src/routes/automation.routes.js
// 자동화 규칙 CRUD + 규칙 평가 API - PostgreSQL 버전
// API 요청/응답 형태 동일 유지

import express from "express";
import AutomationRule from "../models/AutomationRule.js";
import ControlLog from "../models/ControlLog.js";
import logger from "../utils/logger.js";
import { getStepStatusMapByFarm } from "../utils/stepStatusStore.js";

const router = express.Router();

// =========================================
// MQTT Sync 알림 (AWS API Gateway → Lambda → IoT Core)
// =========================================
const AWS_CONTROL_ENDPOINT = process.env.AWS_CONTROL_ENDPOINT;

async function notifyRpiSync(farmId) {
  if (!AWS_CONTROL_ENDPOINT) {
    logger.warn("AWS_CONTROL_ENDPOINT 미설정 - sync 알림 건너뜀");
    return;
  }
  try {
    const res = await fetch(AWS_CONTROL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "automation_sync",
        farm_id: farmId,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    logger.info(`📡 자동화 sync 알림 전송: ${farmId} → ${res.status}`);
  } catch (err) {
    logger.warn(`📡 sync 알림 실패 (무시): ${err.message}`);
  }
}

// =========================================
// 자동화 적용/중지 상태 관리
// (/:farmId/:ruleId 보다 먼저 매칭되도록 CRUD 위에 배치)
// =========================================

/**
 * GET /api/automation/:farmId/active
 * 자동화 적용 상태 조회 (houseId 쿼리 파라미터)
 */
router.get("/:farmId/active", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { houseId } = req.query;

    const { pool } = await import("../db.js");
    const result = await pool.query(
      `SELECT settings FROM system_settings WHERE farm_id = $1`,
      [farmId]
    );

    const settings = result.rows[0]?.settings || {};
    const automationState = settings.automationActive || {};
    const hKey = houseId || 'all';
    const active = !!automationState[hKey];
    const autoDevices = active ? (automationState[`${hKey}_devices`] || []) : [];

    res.json({ success: true, active, autoDevices });
  } catch (error) {
    logger.error("자동화 상태 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/automation/:farmId/active
 * 자동화 적용/중지 상태 변경
 */
router.put("/:farmId/active", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { houseId, active, autoDevices } = req.body;
    const hKey = houseId || 'all';

    // automationActive JSONB에 하우스별 상태 저장
    const patch = {
      automationActive: {
        [hKey]: !!active,
        [`${hKey}_devices`]: active ? (autoDevices || []) : [],
      },
    };

    const { pool } = await import("../db.js");
    await pool.query(
      `INSERT INTO system_settings (farm_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (farm_id) DO UPDATE
         SET settings = system_settings.settings || $2::jsonb,
             updated_at = NOW()`,
      [farmId, JSON.stringify(patch)]
    );

    logger.info(`🔄 자동화 ${active ? '적용' : '중지'}: ${farmId}/${hKey}`);
    res.json({ success: true, active });
    notifyRpiSync(farmId);

    // MQTT로 autoDevices 직접 발행 → RPi가 즉시 반영
    try {
      const mqttService = (await import("../services/mqttClient.js")).default;
      if (mqttService.isConnected()) {
        const topic = `smartfarm/${farmId}/automation/autoDevices`;
        mqttService.client.publish(topic, JSON.stringify({
          action: 'set_autoDevices',
          farmId, houseId: hKey,
          active: !!active,
          autoDevices: active ? (autoDevices || []) : [],
          timestamp: new Date().toISOString(),
        }), { qos: 1 });
        logger.info(`📤 MQTT autoDevices 발행: ${topic}`);
      }
    } catch (e) { logger.warn("MQTT autoDevices 발행 실패:", e.message); }
  } catch (error) {
    logger.error("자동화 상태 변경 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// CRUD
// =========================================

/**
 * GET /api/automation/:farmId
 * 전체 규칙 조회
 */
router.get("/:farmId", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { houseId, enabled } = req.query;

    const query = { farmId };
    if (houseId) query.houseId = houseId;
    if (enabled !== undefined) query.enabled = enabled === "true";

    const rules = await AutomationRule.find(query)
      .sort({ priority: 1, createdAt: -1 })
      .lean();

    res.json({ success: true, data: rules });
  } catch (error) {
    logger.error("규칙 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * actions 의 command + targetPosition 정합성 검증
 *   - command='open' + target<=0  → 모순 (open 인데 닫히는 방향)
 *   - command='close' + target>=100 → 모순 (close 인데 열리는 방향)
 * 이런 모순 rule 이 저장되면 NR ⑤ 가 "이미 목표 도달 → 스킵" 으로 자동화
 * 동작 안 함 (2026-06-04 측창 사고 패턴).
 */
function validateRuleActions(actions) {
  if (!Array.isArray(actions)) return null;
  for (const a of actions) {
    if (typeof a.targetPosition !== "number") continue;
    if (a.command === "open" && a.targetPosition <= 0) {
      return `${a.deviceId || "device"}: command='open' 인데 targetPosition=${a.targetPosition} — 모순 (open 은 target>=10 이어야)`;
    }
    if (a.command === "close" && a.targetPosition >= 100) {
      return `${a.deviceId || "device"}: command='close' 인데 targetPosition=${a.targetPosition} — 모순 (close 는 target<=90 이어야)`;
    }
  }
  return null;
}

/**
 * 같은 device + 같은 시간(specific) + 반대 command 충돌 검증
 *   예: 측창 close@20:10 (월~금) + 측창 open@20:10 (모든요일)
 *       → 20:10 동시 발동 → 모터 양방향 stall + RS-485 noise
 * 2026-06-04 측창 동시 발동 사고 패턴 (project-nr-stepped-coil-stuck 의 stuck 위험).
 */
async function validateNoConflict(farmId, newRule, excludeRuleId) {
  if (!newRule.enabled) return null;   // disabled 는 충돌 검증 skip
  const newConds = (newRule.conditions || []).filter((c) => c.type === "time" && c.timeMode === "specific");
  if (newConds.length === 0) return null;
  const newActions = (newRule.actions || []).filter(
    (a) => (a.command === "open" || a.command === "close") && a.deviceId
  );
  if (newActions.length === 0) return null;

  // 같은 farm + houseId 의 다른 enabled rule 들 조회
  const others = await AutomationRule.find({ farmId, houseId: newRule.houseId, enabled: true }).lean();
  for (const r of others) {
    if (excludeRuleId && (r._id === excludeRuleId || r.id === excludeRuleId)) continue;
    const rConds = (r.conditions || []).filter((c) => c.type === "time" && c.timeMode === "specific");
    if (rConds.length === 0) continue;
    const rActions = (r.actions || []).filter(
      (a) => (a.command === "open" || a.command === "close") && a.deviceId
    );

    for (const a1 of newActions) {
      for (const a2 of rActions) {
        if (a1.deviceId !== a2.deviceId) continue;
        // 반대 방향 check
        const opposite =
          (a1.command === "open" && a2.command === "close") ||
          (a1.command === "close" && a2.command === "open");
        if (!opposite) continue;
        // 시간 + 요일 겹침 check
        for (const c1 of newConds) {
          for (const c2 of rConds) {
            const overlapTimes = (c1.times || []).filter((t) => (c2.times || []).includes(t));
            if (overlapTimes.length === 0) continue;
            const overlapDays = (c1.days || [0, 1, 2, 3, 4, 5, 6]).filter((d) =>
              (c2.days || [0, 1, 2, 3, 4, 5, 6]).includes(d)
            );
            if (overlapDays.length === 0) continue;
            return `${a1.deviceId}: 기존 rule '${r.name}' 와 충돌 (시간=${overlapTimes.join(",")} 의 ${a1.command} ↔ ${a2.command})`;
          }
        }
      }
    }
  }
  return null;
}

/**
 * POST /api/automation/:farmId
 * 규칙 생성
 */
router.post("/:farmId", async (req, res) => {
  try {
    const { farmId } = req.params;
    // ★ 모순 rule 검증 (command + targetPosition 정합성)
    const validationErr = validateRuleActions(req.body.actions);
    if (validationErr) {
      return res.status(400).json({ success: false, error: `자동화 rule 모순: ${validationErr}` });
    }
    // ★ 충돌 rule 검증 (같은 device 의 같은 시간 반대 command)
    const conflictErr = await validateNoConflict(farmId, req.body, null);
    if (conflictErr) {
      return res.status(400).json({ success: false, error: `자동화 rule 충돌: ${conflictErr}` });
    }
    const rule = await AutomationRule.create({ ...req.body, farmId });

    logger.info(`✅ 자동화 규칙 생성: ${rule.name} (${rule.houseId})`);
    res.json({ success: true, data: rule.toJSON ? rule.toJSON() : rule });
    notifyRpiSync(farmId);
  } catch (error) {
    logger.error("규칙 생성 실패:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/automation/:farmId/:ruleId
 * 규칙 수정
 */
router.put("/:farmId/:ruleId", async (req, res) => {
  try {
    const { farmId, ruleId } = req.params;
    // ★ 모순 rule 검증 (command + targetPosition 정합성)
    if (req.body.actions) {
      const validationErr = validateRuleActions(req.body.actions);
      if (validationErr) {
        return res.status(400).json({ success: false, error: `자동화 rule 모순: ${validationErr}` });
      }
    }
    // ★ 충돌 rule 검증 (같은 device 의 같은 시간 반대 command)
    if (req.body.actions || req.body.conditions || req.body.enabled !== undefined) {
      const conflictErr = await validateNoConflict(farmId, req.body, ruleId);
      if (conflictErr) {
        return res.status(400).json({ success: false, error: `자동화 rule 충돌: ${conflictErr}` });
      }
    }
    const rule = await AutomationRule.findByIdAndUpdate(ruleId, req.body, {
      new: true,
      runValidators: true,
    });
    if (!rule)
      return res
        .status(404)
        .json({ success: false, error: "규칙을 찾을 수 없습니다" });

    logger.info(`✏️ 자동화 규칙 수정: ${rule.name}`);
    res.json({ success: true, data: rule.toJSON ? rule.toJSON() : rule });
    notifyRpiSync(req.params.farmId);
  } catch (error) {
    logger.error("규칙 수정 실패:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/automation/:farmId/:ruleId
 * 규칙 삭제
 */
router.delete("/:farmId/:ruleId", async (req, res) => {
  try {
    const { ruleId } = req.params;
    const rule = await AutomationRule.findByIdAndDelete(ruleId);
    if (!rule)
      return res
        .status(404)
        .json({ success: false, error: "규칙을 찾을 수 없습니다" });

    logger.info(`🗑️ 자동화 규칙 삭제: ${rule.name}`);
    res.json({ success: true });
    notifyRpiSync(req.params.farmId);
  } catch (error) {
    logger.error("규칙 삭제 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/automation/:farmId/:ruleId/toggle
 * 규칙 활성/비활성 토글
 */
router.patch("/:farmId/:ruleId/toggle", async (req, res) => {
  try {
    const { ruleId } = req.params;
    const rule = await AutomationRule.findById(ruleId);
    if (!rule)
      return res
        .status(404)
        .json({ success: false, error: "규칙을 찾을 수 없습니다" });

    rule.enabled = !rule.enabled;
    await rule.save();

    logger.info(
      `🔄 자동화 규칙 ${rule.enabled ? "활성화" : "비활성화"}: ${rule.name}`
    );
    res.json({ success: true, data: rule.toJSON ? rule.toJSON() : rule });
    notifyRpiSync(req.params.farmId);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// 장치 자동/수동 모드 동기화
// =========================================

/**
 * POST /api/automation/:farmId/device-modes
 * 프론트에서 자동 모드 장치 목록을 RPi에 전달
 */
router.post("/:farmId/device-modes", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { autoDevices = [], houseId } = req.body;
    const hKey = houseId || 'all';

    const patch = {
      automationActive: {
        [`${hKey}_devices`]: autoDevices,
      },
    };

    const { pool } = await import("../db.js");
    await pool.query(
      `INSERT INTO system_settings (farm_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (farm_id) DO UPDATE
         SET settings = system_settings.settings || $2::jsonb,
             updated_at = NOW()`,
      [farmId, JSON.stringify(patch)]
    );

    logger.info(`🔄 자동 모드 장치 동기화: ${autoDevices.join(', ') || '없음'}`);
    res.json({ success: true, autoDevices });
  } catch (error) {
    logger.error("장치 모드 동기화 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// 스케줄 조회 (정확한 다음 실행 시각 계산)
// =========================================

/**
 * GET /api/automation/:farmId/schedule
 * 각 규칙의 정확한 다음 실행 시각 반환
 */
router.get("/:farmId/schedule", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { houseId } = req.query;

    const query = { farmId, enabled: true };
    if (houseId) query.houseId = houseId;

    const rules = await AutomationRule.find(query).sort({ priority: 1 }).lean();
    const now = new Date();
    const schedule = [];

    // stepStatus — NR ⑤ 실시간 stepped 진행 상태 (deviceId 별)
    const stepStatusMap = getStepStatusMapByFarm(farmId);

    for (const rule of rules) {
      const timeConds = (rule.conditions || []).filter(c => c.type === "time");
      if (timeConds.length === 0) continue;

      const nextRunAt = calculateNextRunTime(timeConds, now);
      if (!nextRunAt) continue;

      // 쿨다운 체크: 다음 실행 시각이 쿨다운 내이면 그 다음으로
      let adjustedNext = nextRunAt;
      if (rule.lastTriggeredAt) {
        const cooldownEnd = new Date(new Date(rule.lastTriggeredAt).getTime() + (rule.cooldownSeconds || 300) * 1000);
        if (adjustedNext < cooldownEnd) {
          // 쿨다운 종료 이후 다음 실행 시각 계산
          adjustedNext = calculateNextRunTime(timeConds, cooldownEnd);
        }
      }

      if (adjustedNext) {
        // 이 rule 의 actions[0].deviceId 의 stepStatus 가 있고 command 일치하면 포함
        // (같은 device 의 close/open rule 분리 — NR ⑤ 충돌 방어로 동시 1개만 active)
        let stepStatus = null;
        const firstAction = (rule.actions || [])[0];
        if (firstAction && firstAction.deviceId) {
          const ss = stepStatusMap[firstAction.deviceId];
          if (ss && ss.command === firstAction.command) {
            stepStatus = ss;
          }
        }

        schedule.push({
          ruleId: rule._id,
          ruleName: rule.name,
          houseId: rule.houseId,
          nextRunAt: adjustedNext.toISOString(),
          lastTriggeredAt: rule.lastTriggeredAt || null,
          actions: rule.actions,
          stepStatus,
        });
      }
    }

    res.json({ success: true, data: schedule, serverTime: now.toISOString() });
  } catch (error) {
    logger.error("스케줄 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 시간 조건에서 다음 실행 시각(Date)을 정확히 계산
 */
function calculateNextRunTime(timeConds, fromDate) {
  const now = fromDate || new Date();
  const nowDay = now.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowSeconds = now.getSeconds();
  let bestTime = null;

  for (const cond of timeConds) {
    const days = (cond.days && cond.days.length > 0)
      ? cond.days.map(Number)
      : [0, 1, 2, 3, 4, 5, 6];

    // 모든 실행 시각(분) 수집
    const times = [];
    if (cond.timeMode === "specific") {
      for (const t of (cond.times || [])) {
        const [h, m] = t.split(":").map(Number);
        times.push(h * 60 + m);
      }
    } else if (cond.timeMode === "interval") {
      const [sh, sm] = (cond.startTime || "00:00").split(":").map(Number);
      const [eh, em] = (cond.endTime || "23:59").split(":").map(Number);
      const start = sh * 60 + sm;
      const end = eh * 60 + em;
      const interval = cond.intervalMinutes || 30;
      if (start <= end) {
        for (let t = start; t <= end; t += interval) {
          times.push(t);
        }
      } else {
        // 자정 넘기는 범위: 18:00~12:06 → 18:00~23:59 + 00:00~12:06
        for (let t = start; t < 1440; t += interval) {
          times.push(t);
        }
        const lastBefore = times[times.length - 1];
        let firstAfter = (lastBefore + interval) - 1440;
        if (firstAfter < 0) firstAfter = 0;
        for (let t = firstAfter; t <= end; t += interval) {
          times.push(t);
        }
      }
    } else if (cond.time) {
      const [h, m] = cond.time.split(":").map(Number);
      times.push(h * 60 + m);
    }

    if (times.length === 0) continue;
    times.sort((a, b) => a - b);

    // 오늘~7일 이내 가장 가까운 실행 시각 찾기
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const checkDay = (nowDay + dayOffset) % 7;
      if (!days.includes(checkDay)) continue;

      for (const t of times) {
        const targetMinutes = t;
        // 오늘이면 현재 시각 이후만
        if (dayOffset === 0 && (targetMinutes < nowMinutes || (targetMinutes === nowMinutes && nowSeconds > 0))) {
          continue;
        }
        // Date 객체 생성
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + dayOffset);
        targetDate.setHours(Math.floor(targetMinutes / 60), targetMinutes % 60, 0, 0);

        if (!bestTime || targetDate < bestTime) {
          bestTime = targetDate;
        }
        break; // 이 날의 최소 시각 찾았으면 다음 날로
      }
      if (bestTime) break;
    }
  }

  return bestTime;
}

// =========================================
// 규칙 평가 (Node-RED에서 호출)
// =========================================

/**
 * POST /api/automation/:farmId/evaluate
 */
router.post("/:farmId/evaluate", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { houseId, sensorData } = req.body;

    if (!houseId || !sensorData) {
      return res
        .status(400)
        .json({ success: false, error: "houseId, sensorData 필수" });
    }

    // 0. 자동화 적용 상태 확인 — 미적용이면 평가 스킵
    const { pool } = await import("../db.js");
    const activeResult = await pool.query(
      `SELECT settings FROM system_settings WHERE farm_id = $1`,
      [farmId]
    );
    const settings = activeResult.rows[0]?.settings || {};
    const automationState = settings.automationActive || {};
    const isActive = !!automationState[houseId] || !!automationState['all'];

    if (!isActive) {
      return res.json({
        success: true,
        data: { evaluatedRules: 0, actions: [], delayedActions: [], skipped: "automationActive=false" },
      });
    }

    // 1. 해당 하우스의 활성 규칙 조회
    const rules = await AutomationRule.find({
      farmId,
      houseId,
      enabled: true,
    }).sort({ priority: 1 });

    const actionsToExecute = [];

    for (const rule of rules) {
      // 2. 쿨다운 체크
      if (rule.lastTriggeredAt) {
        const elapsed =
          (Date.now() - new Date(rule.lastTriggeredAt).getTime()) / 1000;
        if (elapsed < rule.cooldownSeconds) {
          continue;
        }
      }

      // 3. 조건 평가 (그룹별 분리 + groupLogic)
      const sensorConds = rule.conditions.filter((c) => c.type === "sensor");
      const timeConds = rule.conditions.filter((c) => c.type === "time");

      let sensorResult = true;
      let timeResult = true;

      if (sensorConds.length > 0) {
        const sensorResults = sensorConds.map((cond) => {
          const sensorValue = sensorData[cond.sensorId];
          if (sensorValue === undefined || sensorValue === null) return false;
          return evaluateOperator(sensorValue, cond.operator, cond.value);
        });
        sensorResult =
          rule.conditionLogic === "OR"
            ? sensorResults.some(Boolean)
            : sensorResults.every(Boolean);
      }

      if (timeConds.length > 0) {
        const timeResults = timeConds.map((c) => evaluateTimeCondition(c));
        timeResult = timeResults.some(Boolean); // 시간 조건은 OR
      }

      // 4. groupLogic: 센서 그룹 ↔ 시간 그룹 간 AND/OR
      let triggered = false;
      const groupLogic = rule.groupLogic || "AND";

      if (sensorConds.length > 0 && timeConds.length > 0) {
        triggered =
          groupLogic === "OR"
            ? sensorResult || timeResult
            : sensorResult && timeResult;
      } else if (sensorConds.length > 0) {
        triggered = sensorResult;
      } else if (timeConds.length > 0) {
        triggered = timeResult;
      }

      // 5. 조건 충족 → 동작 추가 (duration 포함)
      if (triggered) {
        for (const action of rule.actions) {
          actionsToExecute.push({
            ruleId: (rule._id || rule.id).toString(),
            ruleName: rule.name,
            houseId: rule.houseId,
            deviceId: action.deviceId,
            deviceType: action.deviceType,
            deviceName: action.deviceName || action.deviceId,
            command: action.command,
            duration: action.duration || 0,
            reason: buildReasonText(rule, sensorData),
          });
        }

        // 6. 마지막 실행 시각 업데이트
        rule.lastTriggeredAt = new Date();
        rule.triggerCount = (rule.triggerCount || 0) + 1;
        await rule.save();

        const durInfo = rule.actions
          .map((a) => {
            const ds = a.duration
              ? ` (${Math.floor(a.duration / 60)}분${a.duration % 60}초)`
              : "";
            return `${a.deviceId} ${a.command}${ds}`;
          })
          .join(", ");
        logger.info(`🤖 자동화 실행: ${rule.name} → ${durInfo}`);
      }
    }

    // Duration 기반 역방향 명령 스케줄링
    const REVERSE_CMD = {
      open: "close",
      close: "open",
      on: "off",
      off: "on",
    };
    const delayedActions = [];

    for (const action of actionsToExecute) {
      if (action.duration > 0) {
        const reverseCmd = REVERSE_CMD[action.command];
        if (reverseCmd) {
          delayedActions.push({
            ...action,
            command: reverseCmd,
            delaySeconds: action.duration,
            source: "automation_duration",
          });
        }
      }
    }

    res.json({
      success: true,
      data: {
        evaluatedRules: rules.length,
        actions: actionsToExecute,
        delayedActions: delayedActions,
      },
    });
  } catch (error) {
    logger.error("규칙 평가 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// RPi → PC 규칙 동기화
// =========================================

/**
 * POST /api/automation/:farmId/sync
 * RPi에서 보내는 규칙을 PC DB에 upsert
 */
router.post("/:farmId/sync", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { rules } = req.body;

    if (!Array.isArray(rules)) {
      return res
        .status(400)
        .json({ success: false, error: "rules 배열 필수" });
    }

    const results = { created: 0, updated: 0, skipped: 0, deleted: 0 };

    // 안전장치: RPi에서 빈 배열이 오면 PC 규칙 전체 삭제 방지
    if (rules.length === 0) {
      logger.warn("⚠️ sync: RPi 규칙 빈 배열 - 전체 삭제 방지를 위해 건너뜀");
      return res.json({ success: true, data: { ...results, note: "empty rules - skip delete phase" } });
    }

    // RPi에서 보낸 규칙 ID 목록
    const rpiRuleIds = new Set(rules.map((r) => r.id).filter(Boolean));

    // 1) upsert: RPi 규칙을 PC에 반영
    for (const rule of rules) {
      if (!rule.id) continue;
      const existing = await AutomationRule.findById(rule.id);

      if (existing) {
        const existingTime = new Date(existing.updatedAt).getTime();
        const incomingTime = new Date(rule.updatedAt).getTime();

        if (incomingTime > existingTime) {
          await AutomationRule.findByIdAndUpdate(rule.id, {
            farmId: rule.farmId || farmId,
            houseId: rule.houseId,
            name: rule.name,
            description: rule.description,
            enabled: rule.enabled,
            conditionLogic: rule.conditionLogic,
            groupLogic: rule.groupLogic || "AND",
            conditions: rule.conditions,
            actions: rule.actions,
            cooldownSeconds: rule.cooldownSeconds,
            lastTriggeredAt: rule.lastTriggeredAt,
            triggerCount: rule.triggerCount,
            priority: rule.priority,
          });
          results.updated++;
        } else {
          results.skipped++;
        }
      } else {
        await AutomationRule.create({
          id: rule.id,
          farmId: rule.farmId || farmId,
          houseId: rule.houseId,
          name: rule.name,
          description: rule.description || "",
          enabled: rule.enabled !== undefined ? rule.enabled : false,
          conditionLogic: rule.conditionLogic || "AND",
          groupLogic: rule.groupLogic || "AND",
          conditions: rule.conditions || [],
          actions: rule.actions || [],
          cooldownSeconds: rule.cooldownSeconds || 300,
          priority: rule.priority || 10,
          lastTriggeredAt: rule.lastTriggeredAt || null,
          triggerCount: rule.triggerCount || 0,
        });
        results.created++;
      }
    }

    // 2) PC에만 있고 RPi에 없는 규칙 삭제 (RPi가 권한 기준)
    const pcRules = await AutomationRule.find({ farmId });
    for (const pcRule of pcRules) {
      const pcId = (pcRule._id || pcRule.id).toString();
      if (!rpiRuleIds.has(pcId)) {
        await AutomationRule.findByIdAndDelete(pcId);
        results.deleted++;
      }
    }

    logger.info(
      `🔄 규칙 동기화: 생성 ${results.created}, 업데이트 ${results.updated}, 스킵 ${results.skipped}, 삭제 ${results.deleted}`
    );
    res.json({ success: true, data: results });
  } catch (error) {
    logger.error("규칙 동기화 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// 헬퍼 함수
// =========================================

function evaluateOperator(sensorValue, operator, threshold) {
  switch (operator) {
    case ">":
      return sensorValue > threshold;
    case ">=":
      return sensorValue >= threshold;
    case "<":
      return sensorValue < threshold;
    case "<=":
      return sensorValue <= threshold;
    case "==":
      return Math.abs(sensorValue - threshold) < 0.1;
    default:
      return false;
  }
}

function evaluateTimeCondition(cond) {
  const now = new Date();
  const currentDay = now.getDay();

  if (cond.days && cond.days.length > 0 && !cond.days.includes(currentDay)) {
    return false;
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // 기존 호환: timeMode 없고 time 필드만 있으면 단일 시간 체크
  if (!cond.timeMode && cond.time) {
    const [hour, minute] = cond.time.split(":").map(Number);
    return Math.abs(nowMinutes - (hour * 60 + minute)) <= 2;
  }

  // 지정 시간 모드: times 배열의 각 시간 중 하나라도 매칭
  if (cond.timeMode === "specific") {
    return (cond.times || []).some((t) => {
      const [h, m] = t.split(":").map(Number);
      return Math.abs(nowMinutes - (h * 60 + m)) <= 2;
    });
  }

  // 반복 모드: startTime~endTime 범위 내에서 interval 간격 체크
  if (cond.timeMode === "interval") {
    const [sh, sm] = (cond.startTime || "00:00").split(":").map(Number);
    const [eh, em] = (cond.endTime || "23:59").split(":").map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    const interval = cond.intervalMinutes || 30;
    if (nowMinutes < start - 2 || nowMinutes > end + 2) return false;
    for (let t = start; t <= end; t += interval) {
      if (Math.abs(nowMinutes - t) <= 2) return true;
    }
    return false;
  }

  return false;
}

function buildReasonText(rule, sensorData) {
  const parts = rule.conditions
    .map((cond) => {
      if (cond.type === "sensor") {
        const val = sensorData[cond.sensorId];
        return `${cond.sensorName || cond.sensorId} ${val}${cond.operator}${cond.value}`;
      }
      if (cond.type === "time") {
        if (cond.timeMode === "interval") return `시간 ${cond.startTime}~${cond.endTime} ${cond.intervalMinutes}분간격`;
        if (cond.timeMode === "specific") return `시간 ${(cond.times || []).join(",")}`;
        return `시간 ${cond.time}`;
      }
      return "";
    })
    .filter(Boolean);

  return `${rule.name}: ${parts.join(rule.conditionLogic === "AND" ? " AND " : " OR ")}`;
}

export default router;
