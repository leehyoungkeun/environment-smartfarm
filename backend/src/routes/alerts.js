// src/routes/alerts.js
// 알림 조회 API - PostgreSQL 버전

import express from "express";
import Alert from "../models/Alert.js";
import logger from "../utils/logger.js";

const router = express.Router();

/**
 * GET /api/alerts/:farmId
 * 농장 알림 목록
 */
router.get("/:farmId", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { houseId, acknowledged, limit = 50, page = 1 } = req.query;

    const query = { farmId };
    if (houseId) query.houseId = houseId;
    if (acknowledged !== undefined) query.acknowledged = acknowledged === "true";

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const [alerts, total] = await Promise.all([
      Alert.find(query, { limit: limitNum, skip }),
      Alert.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: alerts,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error("알림 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/alerts/:farmId/acknowledge-all
 * 농장 알림 전체 확인 처리
 */
router.put("/:farmId/acknowledge-all", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { houseId } = req.query;

    const updated = await Alert.acknowledgeAll(farmId, houseId || null);

    res.json({
      success: true,
      data: updated,
      message: `${updated.length}개 알림이 확인 처리되었습니다.`,
    });
  } catch (error) {
    logger.error("알림 전체 확인 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/alerts/:alertId/acknowledge
 * 개별 알림 확인 처리
 */
router.put("/:alertId/acknowledge", async (req, res) => {
  try {
    const { alertId } = req.params;

    const alert = await Alert.acknowledge(alertId);
    if (!alert) {
      return res.status(404).json({ success: false, error: "알림을 찾을 수 없습니다." });
    }

    res.json({ success: true, data: alert });
  } catch (error) {
    logger.error("알림 확인 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/alerts/:alertId
 * 알림 삭제
 */
router.delete("/:alertId", async (req, res) => {
  try {
    const { alertId } = req.params;

    const deleted = await Alert.deleteById(alertId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "알림을 찾을 수 없습니다." });
    }

    res.json({ success: true, data: deleted });
  } catch (error) {
    logger.error("알림 삭제 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
