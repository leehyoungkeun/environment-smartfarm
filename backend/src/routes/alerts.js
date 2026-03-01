// src/routes/alerts.js
// 알림 조회 API - PostgreSQL 버전

import express from "express";
import Alert from "../models/Alert.js";
import logger from "../utils/logger.js";

const router = express.Router();

/**
 * GET /api/alerts/:farmId
 * 농장 알림 목록
 * ?includeDeleted=true 로 삭제된 알림 포함 조회 (농장모달 이력용)
 */
router.get("/:farmId", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { houseId, acknowledged, limit = 50, page = 1, includeDeleted } = req.query;

    const query = { farmId };
    if (houseId) query.houseId = houseId;
    if (acknowledged !== undefined) query.acknowledged = acknowledged === "true";

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;
    const inclDel = includeDeleted === "true";

    const [alerts, total] = await Promise.all([
      Alert.find(query, { limit: limitNum, skip, includeDeleted: inclDel }),
      Alert.countDocuments(query, { includeDeleted: inclDel }),
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
    const { source } = req.body || {};

    const updated = await Alert.acknowledgeAll(farmId, houseId || null, source || null);

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
    const { resolution, source } = req.body || {};

    const alert = await Alert.acknowledge(alertId, resolution || null, source || null);
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
 * PUT /api/alerts/:alertId/resolution
 * 알림 조치내역 저장/수정
 */
router.put("/:alertId/resolution", async (req, res) => {
  try {
    const { alertId } = req.params;
    const { resolution } = req.body || {};

    if (!resolution?.trim()) {
      return res.status(400).json({ success: false, error: "조치내역을 입력하세요." });
    }

    const alert = await Alert.updateResolution(alertId, resolution.trim());
    if (!alert) {
      return res.status(404).json({ success: false, error: "알림을 찾을 수 없습니다." });
    }

    res.json({ success: true, data: alert });
  } catch (error) {
    logger.error("조치내역 저장 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/alerts/:alertId
 * 알림 soft-delete (이력 보존)
 */
router.delete("/:alertId", async (req, res) => {
  try {
    const { alertId } = req.params;
    const { source } = req.query;

    const deleted = await Alert.deleteById(alertId, source || null);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "알림을 찾을 수 없습니다." });
    }

    res.json({ success: true, data: deleted });
  } catch (error) {
    logger.error("알림 삭제 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/alerts/:farmId/all
 * 농장 알림 전체 soft-delete
 */
router.delete("/:farmId/all", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { houseId, source } = req.query;

    const deleted = await Alert.deleteAllByFarm(farmId, houseId || null, source || null);

    res.json({
      success: true,
      data: deleted,
      message: `${deleted.length}개 알림이 삭제 처리되었습니다.`,
    });
  } catch (error) {
    logger.error("알림 전체 삭제 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
