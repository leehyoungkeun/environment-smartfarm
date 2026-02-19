// src/routes/control-logs.js
// 제어 이력 저장 및 조회 API - PostgreSQL/TimescaleDB 버전
// API 요청/응답 형태 동일 유지

import express from "express";
import ControlLog from "../models/ControlLog.js";
import logger from "../utils/logger.js";

const router = express.Router();

/**
 * POST /api/control-logs
 * 제어 이력 저장
 */
router.post("/", async (req, res) => {
  try {
    const {
      farmId,
      houseId,
      controlHouseId,
      deviceId,
      deviceType,
      deviceName,
      command,
      success,
      error,
      requestId,
      operator,
      operatorName,
      lambdaResponse,
      isAutomatic,
      automationRuleId,
      automationReason,
    } = req.body;

    if (!farmId || !houseId || !deviceId || !command) {
      return res.status(400).json({
        success: false,
        error: "farmId, houseId, deviceId, command는 필수입니다.",
      });
    }

    const log = await ControlLog.create({
      farmId,
      houseId,
      controlHouseId: controlHouseId || houseId,
      deviceId,
      deviceType: deviceType || "unknown",
      deviceName: deviceName || deviceId,
      command,
      success: success !== false,
      error: error || null,
      requestId,
      operator: operator || "web_dashboard",
      operatorName: operatorName || null,
      lambdaResponse: lambdaResponse || null,
      isAutomatic: isAutomatic || false,
      automationRuleId: automationRuleId || null,
      automationReason: automationReason || null,
    });

    logger.info(
      `📝 제어 이력 저장: ${houseId}/${deviceId} ${command} (${success !== false ? "성공" : "실패"})`
    );

    res.json({
      success: true,
      data: log,
    });
  } catch (error) {
    logger.error("❌ 제어 이력 저장 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/control-logs/:farmId
 * 농장 전체 제어 이력 조회
 */
router.get("/:farmId", async (req, res) => {
  try {
    const { farmId } = req.params;
    const {
      houseId,
      deviceId,
      deviceType,
      limit = 50,
      page = 1,
      startDate,
      endDate,
    } = req.query;

    const query = { farmId };
    if (houseId) query.houseId = houseId;
    if (deviceId) query.deviceId = deviceId;
    if (deviceType) query.deviceType = deviceType;

    // 날짜 필터
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      ControlLog.find(query, { sort: { createdAt: -1 }, skip, limit: limitNum }),
      ControlLog.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error("❌ 제어 이력 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/control-logs/:farmId/stats
 * 제어 통계 (대시보드용)
 */
router.get("/:farmId/stats", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { houseId, period = "today" } = req.query;

    // 기간 계산
    const now = new Date();
    let startDate;
    switch (period) {
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default: // today
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
    }

    // PostgreSQL 직접 쿼리 (MongoDB aggregate 대체)
    const [summary, byDevice, byHour] = await Promise.all([
      ControlLog.getStats(farmId, startDate, houseId),
      ControlLog.getStatsByDevice(farmId, startDate, houseId),
      ControlLog.getStatsByHour(farmId, startDate, houseId),
    ]);

    res.json({
      success: true,
      data: {
        period,
        summary,
        byDevice,
        byHour,
      },
    });
  } catch (error) {
    logger.error("❌ 제어 통계 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/control-logs/:farmId
 * 이력 삭제 (관리자용)
 */
router.delete("/:farmId", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { before } = req.query;

    if (!before) {
      return res
        .status(400)
        .json({ success: false, error: "before 파라미터가 필요합니다." });
    }

    const result = await ControlLog.deleteMany({
      farmId,
      createdAt: { $lt: new Date(before) },
    });

    logger.info(
      `🗑️ 제어 이력 삭제: ${result.deletedCount}건 (${before} 이전)`
    );

    res.json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    logger.error("❌ 제어 이력 삭제 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
