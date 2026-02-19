// src/routes/config.routes.js
// Config API Routes - PostgreSQL 버전
// API 요청/응답 형태 동일 유지

import express from "express";
import Config from "../models/Config.js";
import logger from "../utils/logger.js";

const router = express.Router();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/config/farm/:farmId - 농장의 모든 하우스 목록 조회
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/farm/:farmId", async (req, res) => {
  try {
    logger.info("📥 하우스 목록 조회:", req.params.farmId);

    const houses = await Config.find({ farmId: req.params.farmId });

    logger.info(`✅ ${houses.length}개 하우스 조회 성공`);
    res.json({ success: true, data: houses });
  } catch (error) {
    logger.error("❌ 하우스 목록 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/config/:id
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const { farmId } = req.query;

  // farmId 쿼리가 있으면 → 개별 하우스 조회 (id = houseId)
  if (farmId) {
    try {
      logger.info("📥 개별 하우스 조회:", farmId, id);

      const house = await Config.findOne({ farmId, houseId: id });

      if (!house) {
        return res.status(404).json({
          success: false,
          error: "House not found",
        });
      }

      logger.info("✅ 하우스 조회 성공:", house.houseId);
      return res.json({ success: true, data: house });
    } catch (error) {
      logger.error("❌ 하우스 조회 실패:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // farmId 쿼리가 없으면 → 농장 전체 설정 조회 (id = farmId)
  try {
    logger.info("📥 농장 Config 조회:", id);

    const houses = await Config.find({ farmId: id });

    const configData = {
      farmId: id,
      farmName: "스마트팜",
      houses: houses.map((h) => ({
        houseId: h.houseId,
        name: h.houseName,
        houseName: h.houseName,
        sensors: h.sensors || [],
        collection: h.collection || {},
        enabled: h.enabled !== false,
        devices: h.devices || [],
        deviceCount: h.devices?.length || h.deviceCount || 0,
      })),
    };

    logger.info(`✅ 농장 Config 조회 성공: ${houses.length}개 하우스`);
    res.json({ success: true, data: configData });
  } catch (error) {
    logger.error("❌ 농장 Config 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/config - 새 하우스 생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post("/", async (req, res) => {
  try {
    const { farmId, houseId, houseName, collection, sensors } = req.body;
    logger.info("🆕 하우스 생성 요청:", farmId, houseId);

    // 중복 체크
    const existing = await Config.findOne({ farmId, houseId });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: "이미 존재하는 하우스 ID입니다.",
      });
    }

    const config = await Config.create({
      farmId,
      houseId,
      houseName: houseName || `${houseId} 하우스`,
      collection: collection || {
        intervalSeconds: 60,
        method: "http",
        retryAttempts: 3,
      },
      sensors: sensors || [],
      enabled: true,
    });

    logger.info("✅ 하우스 생성 성공:", config.houseId);
    res.status(201).json({ success: true, data: config });
  } catch (error) {
    logger.error("❌ 하우스 생성 실패:", error);
    // Prisma unique constraint violation
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        error: "이미 존재하는 하우스 ID입니다.",
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUT /api/config/:houseId - 하우스 설정 수정
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.put("/:houseId", async (req, res) => {
  try {
    const { houseId } = req.params;
    const farmId = req.query.farmId || req.body.farmId;
    logger.info("📝 하우스 수정 요청:", farmId, houseId);

    const query = { houseId };
    if (farmId) {
      query.farmId = farmId;
    }

    // 허용된 필드만 추출 (Mass Assignment 방지)
    const allowedFields = ["houseName", "sensors", "collection", "devices", "deviceCount", "enabled"];
    const updateData = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }
    if (farmId) updateData.farmId = farmId;
    updateData.houseId = houseId;

    const config = await Config.findOneAndUpdate(query, updateData, {
      new: true,
      upsert: true,
    });

    logger.info("✅ 하우스 수정 성공:", config.houseId);
    res.json({ success: true, data: config });
  } catch (error) {
    logger.error("❌ 하우스 수정 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE /api/config/:houseId - 하우스 삭제
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete("/:houseId", async (req, res) => {
  try {
    const { houseId } = req.params;
    const farmId = req.query.farmId;
    logger.info("🗑️ 하우스 삭제 요청:", farmId, houseId);

    const query = { houseId };
    if (farmId) {
      query.farmId = farmId;
    }

    const result = await Config.deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: "House not found",
      });
    }

    logger.info("✅ 하우스 삭제 성공:", houseId);
    res.json({ success: true, message: "House deleted" });
  } catch (error) {
    logger.error("❌ 하우스 삭제 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
