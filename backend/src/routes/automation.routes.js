// src/routes/automation.routes.js
// 자동화 규칙 CRUD + 규칙 평가 API - PostgreSQL 버전
// API 요청/응답 형태 동일 유지

import express from "express";
import AutomationRule from "../models/AutomationRule.js";
import ControlLog from "../models/ControlLog.js";
import logger from "../utils/logger.js";

const router = express.Router();

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
 * POST /api/automation/:farmId
 * 규칙 생성
 */
router.post("/:farmId", async (req, res) => {
  try {
    const { farmId } = req.params;
    const rule = await AutomationRule.create({ ...req.body, farmId });

    logger.info(`✅ 자동화 규칙 생성: ${rule.name} (${rule.houseId})`);
    res.json({ success: true, data: rule.toJSON ? rule.toJSON() : rule });
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
    const { ruleId } = req.params;
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
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

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
          enabled: rule.enabled !== undefined ? rule.enabled : true,
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
