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

      // 3. 조건 평가
      const conditionResults = rule.conditions.map((cond) => {
        if (cond.type === "sensor") {
          const sensorValue = sensorData[cond.sensorId];
          if (sensorValue === undefined || sensorValue === null) return false;
          return evaluateOperator(sensorValue, cond.operator, cond.value);
        }
        if (cond.type === "time") {
          return evaluateTimeCondition(cond);
        }
        return false;
      });

      // 4. AND/OR 로직
      let triggered = false;
      if (rule.conditionLogic === "AND") {
        triggered = conditionResults.every((r) => r === true);
      } else {
        triggered = conditionResults.some((r) => r === true);
      }

      // 5. 조건 충족 → 동작 추가
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
            reason: buildReasonText(rule, sensorData),
          });
        }

        // 6. 마지막 실행 시각 업데이트
        rule.lastTriggeredAt = new Date();
        rule.triggerCount = (rule.triggerCount || 0) + 1;
        await rule.save();

        logger.info(
          `🤖 자동화 실행: ${rule.name} → ${rule.actions.map((a) => `${a.deviceId} ${a.command}`).join(", ")}`
        );
      }
    }

    res.json({
      success: true,
      data: {
        evaluatedRules: rules.length,
        actions: actionsToExecute,
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

    if (!Array.isArray(rules) || rules.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "rules 배열 필수" });
    }

    const results = { created: 0, updated: 0, skipped: 0 };

    for (const rule of rules) {
      const existing = await AutomationRule.findById(rule.id);

      if (existing) {
        // updatedAt 비교 — RPi 쪽이 최신이면 업데이트
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
        // 새 규칙 생성 (RPi에서 생성된 ID 유지)
        await AutomationRule.create({
          id: rule.id,
          farmId: rule.farmId || farmId,
          houseId: rule.houseId,
          name: rule.name,
          description: rule.description || "",
          enabled: rule.enabled !== undefined ? rule.enabled : true,
          conditionLogic: rule.conditionLogic || "AND",
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

    logger.info(
      `🔄 규칙 동기화: 생성 ${results.created}, 업데이트 ${results.updated}, 스킵 ${results.skipped}`
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

  if (cond.time) {
    const [hour, minute] = cond.time.split(":").map(Number);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const targetMinutes = hour * 60 + minute;
    return Math.abs(nowMinutes - targetMinutes) <= 2;
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
        return `시간 ${cond.time}`;
      }
      return "";
    })
    .filter(Boolean);

  return `${rule.name}: ${parts.join(rule.conditionLogic === "AND" ? " AND " : " OR ")}`;
}

export default router;
