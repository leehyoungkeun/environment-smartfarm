// src/routes/config.routes.js
// Config API Routes - PostgreSQL 버전
// API 요청/응답 형태 동일 유지

import express from "express";
import Config from "../models/Config.js";
import { pool } from "../db.js";
import logger from "../utils/logger.js";

const router = express.Router();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/config/node-red/:farmId/:houseId - Node-RED용 경량 설정 조회
// Node-RED가 주기적으로 폴링하여 수집 주기/센서 목록을 동기화
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/node-red/:farmId/:houseId", async (req, res) => {
  try {
    const { farmId, houseId } = req.params;
    const house = await Config.findOne({ farmId, houseId });

    if (!house) {
      return res.status(404).json({ success: false, error: "House not found" });
    }

    res.json({
      success: true,
      data: {
        farmId: house.farmId,
        houseId: house.houseId,
        intervalSeconds: house.collection?.intervalSeconds || 60,
        sensors: (house.sensors || [])
          .filter(s => s.enabled !== false)
          .map(s => ({
            sensorId: s.sensorId,
            name: s.name,
            unit: s.unit,
          })),
      },
    });
  } catch (error) {
    logger.error("❌ Node-RED 설정 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/config/farm/:farmId - 농장의 모든 하우스 목록 조회
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/farm/:farmId", async (req, res) => {
  try {
    const apiKey = req.headers["x-api-key"] || "(none)";
    logger.info(`📥 하우스 목록 조회: farmId=${req.params.farmId}, apiKey=${apiKey.substring(0, 10)}..., isDevice=${req.isDevice}, reqFarmId=${req.farmId}, ip=${req.ip}`);

    const houses = await Config.find({ farmId: req.params.farmId });

    logger.info(`✅ ${houses.length}개 하우스 조회 성공 (farmId=${req.params.farmId})`);
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
    const allowedFields = ["houseName", "sensors", "collection", "devices", "deviceCount", "enabled", "crops", "cropType", "cropVariety", "plantingDate"];
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/config/:farmId/sync - RPi → PC 설정 동기화
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post("/:farmId/sync", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { configs } = req.body;

    if (!Array.isArray(configs)) {
      return res.status(400).json({ success: false, error: "configs 배열 필수" });
    }

    const results = { created: 0, updated: 0, skipped: 0, deleted: 0 };

    // 안전장치: 빈 배열이면 전체 삭제 방지
    if (configs.length === 0) {
      logger.warn("⚠️ config sync: 빈 배열 - 전체 삭제 방지를 위해 건너뜀");
      return res.json({ success: true, data: { ...results, note: "empty configs - skip delete phase" } });
    }

    const rpiHouseIds = new Set(configs.map((c) => c.houseId).filter(Boolean));

    // 1) upsert: RPi 설정을 PC에 반영
    for (const cfg of configs) {
      if (!cfg.houseId) continue;
      const existing = await Config.findOne({ farmId, houseId: cfg.houseId });

      if (existing) {
        const existingTime = new Date(existing.updatedAt).getTime();
        const incomingTime = new Date(cfg.updatedAt).getTime();

        if (incomingTime > existingTime) {
          await Config.findOneAndUpdate(
            { farmId, houseId: cfg.houseId },
            {
              houseName: cfg.houseName,
              sensors: cfg.sensors || [],
              collection: cfg.collection || {},
              devices: cfg.devices || [],
              deviceCount: cfg.deviceCount || cfg.devices?.length || 0,
              enabled: cfg.enabled !== undefined ? cfg.enabled : true,
              crops: cfg.crops || [],
              cropType: cfg.cropType || "",
              cropVariety: cfg.cropVariety || "",
              plantingDate: cfg.plantingDate || "",
            },
            { new: true }
          );
          results.updated++;
        } else {
          results.skipped++;
        }
      } else {
        await Config.create({
          farmId,
          houseId: cfg.houseId,
          houseName: cfg.houseName || cfg.houseId,
          sensors: cfg.sensors || [],
          collection: cfg.collection || {},
          devices: cfg.devices || [],
          deviceCount: cfg.deviceCount || cfg.devices?.length || 0,
          enabled: cfg.enabled !== undefined ? cfg.enabled : true,
          crops: cfg.crops || [],
          cropType: cfg.cropType || "",
          cropVariety: cfg.cropVariety || "",
          plantingDate: cfg.plantingDate || "",
        });
        results.created++;
      }
    }

    // 2) PC에만 있고 RPi에 없는 하우스 삭제 (RPi가 권한 기준)
    const pcHouses = await Config.find({ farmId });
    for (const pc of pcHouses) {
      if (!rpiHouseIds.has(pc.houseId)) {
        await Config.deleteOne({ farmId, houseId: pc.houseId });
        results.deleted++;
      }
    }

    logger.info(
      `🔄 설정 동기화: 생성 ${results.created}, 업데이트 ${results.updated}, 스킵 ${results.skipped}, 삭제 ${results.deleted}`
    );
    res.json({ success: true, data: results });
  } catch (error) {
    logger.error("설정 동기화 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/config/system-settings/:farmId - 시스템 설정 조회
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/system-settings/:farmId", async (req, res) => {
  try {
    const { farmId } = req.params;
    const result = await pool.query(
      "SELECT settings FROM system_settings WHERE farm_id = $1",
      [farmId]
    );

    const defaults = {
      retentionDays: 60,
      alertConfig: { enabled: true, checkIntervalMinutes: 5, cooldownMinutes: 15, criticalRatio: 0.5 },
    };
    const raw = result.rows[0]?.settings || {};
    const settings = {
      ...defaults,
      ...raw,
      alertConfig: { ...defaults.alertConfig, ...(raw.alertConfig || {}) },
    };

    res.json({ success: true, data: settings });
  } catch (error) {
    logger.error("❌ 시스템 설정 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUT /api/config/system-settings/:farmId - 시스템 설정 저장
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.put("/system-settings/:farmId", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { retentionDays } = req.body;

    // 허용된 필드만 추출
    const settings = {};
    if (retentionDays !== undefined) {
      const days = parseInt(retentionDays);
      if (isNaN(days) || days < 7 || days > 365) {
        return res.status(400).json({
          success: false,
          error: "retentionDays는 7~365 범위여야 합니다.",
        });
      }
      settings.retentionDays = days;
    }

    // alertConfig 처리
    const { alertConfig } = req.body;
    if (alertConfig !== undefined) {
      const cfg = {};
      if (alertConfig.checkIntervalMinutes !== undefined) {
        const v = parseInt(alertConfig.checkIntervalMinutes);
        if (isNaN(v) || v < 1 || v > 60) return res.status(400).json({ success: false, error: "checkIntervalMinutes는 1~60 범위여야 합니다." });
        cfg.checkIntervalMinutes = v;
      }
      if (alertConfig.cooldownMinutes !== undefined) {
        const v = parseInt(alertConfig.cooldownMinutes);
        if (isNaN(v) || v < 1 || v > 120) return res.status(400).json({ success: false, error: "cooldownMinutes는 1~120 범위여야 합니다." });
        cfg.cooldownMinutes = v;
      }
      if (alertConfig.criticalRatio !== undefined) {
        const v = parseFloat(alertConfig.criticalRatio);
        if (isNaN(v) || v < 0.1 || v > 1.0) return res.status(400).json({ success: false, error: "criticalRatio는 0.1~1.0 범위여야 합니다." });
        cfg.criticalRatio = v;
      }
      if (alertConfig.enabled !== undefined) cfg.enabled = !!alertConfig.enabled;
      if (Object.keys(cfg).length > 0) settings.alertConfig = cfg;
    }

    await pool.query(
      `INSERT INTO system_settings (farm_id, settings, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (farm_id) DO UPDATE
         SET settings = system_settings.settings || $2,
             updated_at = NOW()`,
      [farmId, JSON.stringify(settings)]
    );

    logger.info(`⚙️ 시스템 설정 저장: ${farmId} - ${JSON.stringify(settings)}`);
    res.json({ success: true, data: settings });
  } catch (error) {
    logger.error("❌ 시스템 설정 저장 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
