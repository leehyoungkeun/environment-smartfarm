// src/routes/config.routes.js
// Config API Routes - PostgreSQL 버전
// API 요청/응답 형태 동일 유지

import express from "express";
import Config from "../models/Config.js";
import { pool } from "../db.js";
import logger from "../utils/logger.js";
import mqttService from "../services/mqttClient.js";

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

    // RPi 즉시 알림
    if (farmId) {
      mqttService.publishConfigUpdate(farmId, {
        type: "house_created",
        houseId: config.houseId,
      });
    }

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

    // configVersion: 전체 max + 1 (RPi는 max로 변경 감지)
    const allHouses = await Config.find({ farmId: farmId || query.farmId });
    let maxVer = 0;
    for (const h of allHouses) {
      if ((h.configVersion || 0) > maxVer) maxVer = h.configVersion || 0;
    }
    updateData.configVersion = maxVer + 1;

    const config = await Config.findOneAndUpdate(query, updateData, {
      new: true,
      upsert: true,
    });

    logger.info("✅ 하우스 수정 성공:", config.houseId);

    // RPi 즉시 알림 — sensor/device 추가/수정/삭제 시 RPi houseConfig refresh 트리거
    if (farmId) {
      mqttService.publishConfigUpdate(farmId, {
        type: "house_changed",
        houseId,
        configVersion: updateData.configVersion,
      });
    }

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

    // RPi 즉시 알림
    if (farmId) {
      mqttService.publishConfigUpdate(farmId, {
        type: "house_deleted",
        houseId,
      });
    }

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

    // maxVersion 산출: 모든 기존 하우스 중 최대 configVersion
    const allExisting = await Config.find({ farmId });
    let maxVersion = 0;
    for (const e of allExisting) {
      if ((e.configVersion || 0) > maxVersion) maxVersion = e.configVersion || 0;
    }

    // 1) upsert: RPi 설정을 PC에 반영
    let hasUpdate = false;
    for (const cfg of configs) {
      if (!cfg.houseId) continue;
      const existing = allExisting.find(e => e.houseId === cfg.houseId);

      if (existing) {
        const existingTime = new Date(existing.updatedAt).getTime();
        const incomingTime = new Date(cfg.updatedAt).getTime();

        if (incomingTime > existingTime) {
          hasUpdate = true;
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
              configVersion: maxVersion + 1,
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
    // 안전장치: RPi 하우스가 PC보다 훨씬 적으면 삭제 스킵 (잘못된 동기화 방지)
    const pcHouses = await Config.find({ farmId });
    const deleteThreshold = Math.max(pcHouses.length * 0.5, 2);
    const toDelete = pcHouses.filter(pc => !rpiHouseIds.has(pc.houseId));
    if (toDelete.length > deleteThreshold) {
      logger.warn(`⚠️ 동기화 삭제 스킵: RPi ${configs.length}개 vs PC ${pcHouses.length}개, 삭제 대상 ${toDelete.length}개 > 임계값 ${deleteThreshold}`);
      results.deleteSkipped = toDelete.length;
    } else {
      for (const pc of toDelete) {
        try {
          await Config.deleteOne({ farmId, houseId: pc.houseId });
          results.deleted++;
        } catch (e) {
          logger.warn(`⚠️ 삭제 실패: ${pc.houseId} - ${e.message}`);
        }
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
      collectionConfig: { intervalSeconds: 60 },
      rpiSync: null,
    };
    const raw = result.rows[0]?.settings || {};
    const settings = {
      ...defaults,
      ...raw,
      alertConfig: { ...defaults.alertConfig, ...(raw.alertConfig || {}) },
      collectionConfig: { ...defaults.collectionConfig, ...(raw.collectionConfig || {}) },
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

    // settings 병합 — 반드시 **깊은** 병합이어야 한다.
    //
    // 아래 SQL 의 `system_settings.settings || $2` 는 jsonb 얕은 병합이라 최상위 키만 합치고,
    // 중첩된 `settings` 객체는 통째로 교체된다. 그래서 전광판 화면이 `{ settings: { display } }` 만
    // 보내면 같은 객체 안의 relayModules·sensorModules 가 사라졌다 (2026-08-29 확인 — 릴레이 모듈
    // 등록이 '어느 날 지워지는' 원인). 여기서 기존 값을 읽어 한 단계 안쪽을 합친 뒤 쓴다.
    // 배열(relayModules 등)은 키 단위로 교체된다 — 삭제는 프론트가 전체 배열을 보내는 방식 그대로.
    if (req.body.settings !== undefined && typeof req.body.settings === 'object' && req.body.settings !== null) {
      const cur = await pool.query(
        `SELECT settings->'settings' AS nested FROM system_settings WHERE farm_id = $1`,
        [farmId]
      );
      const existingNested = (cur.rows[0] && cur.rows[0].nested && typeof cur.rows[0].nested === 'object') ? cur.rows[0].nested : {};
      const merged = { ...existingNested, ...req.body.settings };
      settings.settings = merged;
      const cnt = (k) => (Array.isArray(merged[k]) ? merged[k].length : '-');
      logger.info(`system-settings 저장 (farmId=${farmId}) keys=${Object.keys(req.body.settings).join(',')} → relayModules=${cnt('relayModules')} sensorModules=${cnt('sensorModules')}`);
    }

    // collectionConfig 처리
    const { collectionConfig } = req.body;
    if (collectionConfig !== undefined) {
      if (collectionConfig.intervalSeconds !== undefined) {
        const v = parseInt(collectionConfig.intervalSeconds);
        if (isNaN(v) || v < 10 || v > 3600) {
          return res.status(400).json({ success: false, error: "intervalSeconds는 10~3600 범위여야 합니다." });
        }
        settings.collectionConfig = { intervalSeconds: v };
      }
    }

    await pool.query(
      `INSERT INTO system_settings (farm_id, settings, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (farm_id) DO UPDATE
         SET settings = system_settings.settings || $2,
             updated_at = NOW()`,
      [farmId, JSON.stringify(settings)]
    );

    // 부가장치 (display) 설정 → RPi 로 즉시 push (fire-and-forget)
    const displayCfg = req.body.settings?.display || req.body.display;
    if (displayCfg && typeof displayCfg === "object") {
      const rpiServerBase = getRpiBase(farmId).replace(":1880", ":3001");
      fetch(`${rpiServerBase}/local-config/display`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(displayCfg),
        timeout: 5000,
      }).catch((e) => logger.warn(`RPi display push 실패 (${farmId}): ${e.message}`));
    }

    // sensorModules 저장 시 → farms.houses.sensors.modbus 도 동기 갱신
    // (system_settings 와 houses.sensors 저장 위치 이원화 결함 방어)
    const submittedSensorModules = req.body.settings?.sensorModules;
    if (Array.isArray(submittedSensorModules)) {
      try {
        const modByType = {};
        for (const mod of submittedSensorModules) {
          if (mod?.sensorType) modByType[mod.sensorType] = mod;
        }
        const inferType = (sensorId) => {
          const id = String(sensorId || "").toLowerCase();
          if (id.startsWith("temp")) return { type: "temperature_humidity", registerIndex: 1 };
          if (id.startsWith("humid")) return { type: "temperature_humidity", registerIndex: 0 };
          if (id.startsWith("co2")) return { type: "co2", registerIndex: 0 };
          if (id.startsWith("soil_temp")) return { type: "soil", registerIndex: 0 };
          if (id.startsWith("soil_moist")) return { type: "soil", registerIndex: 1 };
          if (id.startsWith("ec")) return { type: "ec", registerIndex: 0 };
          if (id.startsWith("ph")) return { type: "ph", registerIndex: 0 };
          return null;
        };
        const houses = await Config.find({ farmId });
        let maxVer = 0;
        for (const h of houses) {
          if ((h.configVersion || 0) > maxVer) maxVer = h.configVersion || 0;
        }
        let syncedCount = 0;
        for (const house of houses) {
          let changed = false;
          const newSensors = (house.sensors || []).map((s) => {
            const inferred = inferType(s.sensorId);
            if (!inferred) return s;
            const mod = modByType[inferred.type];
            if (!mod) return s;
            const newModbus = {
              unitId: mod.unitId,
              fc: mod.fc || 3,
              address: mod.address || 0,
              quantity: mod.quantity || 1,
              registerIndex: inferred.registerIndex,
              divider: mod.divider || 1,
              signed: mod.signed || false,
            };
            if (JSON.stringify(s.modbus || {}) !== JSON.stringify(newModbus)) {
              changed = true;
              syncedCount++;
              return { ...s, modbus: newModbus };
            }
            return s;
          });
          if (changed) {
            await Config.findOneAndUpdate(
              { farmId, houseId: house.houseId },
              { sensors: newSensors, configVersion: maxVer + 1 }
            );
          }
        }
        if (syncedCount > 0) {
          logger.info(`✅ sensorModules → houses.sensors.modbus sync: ${syncedCount}개 (farmId=${farmId})`);
          mqttService.publishConfigUpdate(farmId, {
            type: "sensors_synced",
            configVersion: maxVer + 1,
          });
        }
      } catch (e) {
        logger.warn(`sensorModules sync 실패 (farmId=${farmId}): ${e.message}`);
      }
    }

    // 모듈 변경 감지 → RPi에 즉시 알림 (즉시 반영, 5분 검증으로 누락 보정)
    const submittedSettings = req.body.settings;
    if (
      submittedSettings &&
      typeof submittedSettings === "object" &&
      (submittedSettings.relayModules !== undefined ||
        submittedSettings.sensorModules !== undefined)
    ) {
      mqttService.publishConfigUpdate(farmId, {
        type: "modules_changed",
        relayModuleCount: Array.isArray(submittedSettings.relayModules)
          ? submittedSettings.relayModules.length
          : undefined,
        sensorModuleCount: Array.isArray(submittedSettings.sensorModules)
          ? submittedSettings.sensorModules.length
          : undefined,
      });
    }

    // collectionConfig 저장 시 모든 하우스의 collection.intervalSeconds 전파
    if (settings.collectionConfig?.intervalSeconds) {
      const newInterval = settings.collectionConfig.intervalSeconds;
      const allHouses = await Config.find({ farmId });
      for (const h of allHouses) {
        const updatedCollection = { ...(h.collection || {}), intervalSeconds: newInterval };
        await Config.findOneAndUpdate(
          { farmId, houseId: h.houseId },
          { collection: updatedCollection }
        );
      }
      // configVersion 증가 (RPi가 변경 감지하도록)
      const allUpdated = await Config.find({ farmId });
      let maxVer = 0;
      for (const h of allUpdated) {
        if ((h.configVersion || 0) > maxVer) maxVer = h.configVersion || 0;
      }
      // 첫 번째 하우스의 configVersion만 max+1로 올려서 RPi 감지 트리거
      if (allUpdated.length > 0) {
        await Config.findOneAndUpdate(
          { farmId, houseId: allUpdated[0].houseId },
          { configVersion: maxVer + 1 }
        );
      }
      logger.info(`⚙️ 수집 주기 전파: ${farmId} - 모든 하우스 ${newInterval}초, configVersion=${maxVer + 1}`);
    }

    logger.info(`⚙️ 시스템 설정 저장: ${farmId} - ${JSON.stringify(settings)}`);
    res.json({ success: true, data: settings });
  } catch (error) {
    logger.error("❌ 시스템 설정 저장 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/config/:farmId/rpi-ack - RPi가 설정 적용 확인(ACK) 전송
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post("/:farmId/rpi-ack", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { configVersion, appliedAt, houses } = req.body;

    if (!configVersion) {
      return res.status(400).json({ success: false, error: "configVersion 필수" });
    }

    const ackData = {
      rpiSync: {
        configVersion,
        appliedAt: appliedAt || new Date().toISOString(),
        houses: houses || [],
        receivedAt: new Date().toISOString(),
      },
    };

    await pool.query(
      `INSERT INTO system_settings (farm_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (farm_id) DO UPDATE
         SET settings = system_settings.settings || $2::jsonb,
             updated_at = NOW()`,
      [farmId, JSON.stringify(ackData)]
    );

    logger.info(`✅ RPi ACK: farmId=${farmId} v${configVersion} houses=${(houses || []).map(h => h.houseId + ':' + h.intervalSeconds + 's').join(',')}`);
    res.json({ success: true, data: ackData.rpiSync });
  } catch (error) {
    logger.error("❌ RPi ACK 저장 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 동기화 상태/제어 프록시 (프론트 → 백엔드 → RPi)
// 멀티팜 지원: farmId → Tailscale MagicDNS hostname 자동 매핑
// farm_0001 → http://farm-0001:1880  (RPi 가 Tailscale 가입돼 있어야)
// IP 변경·재부팅·이사 무관 (Tailscale 이 자동 추적)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RPi 로컬 API 는 2026-08-29 부터 농장 키 또는 키오스크(localhost)만 받는다 (B1).
// 서버가 Tailscale 로 RPi 를 부를 때는 그 농장의 api_key 를 붙인다.
async function rpiHeaders(farmId, extra = {}) {
  const row = await pool.query("SELECT api_key FROM farms WHERE farm_id = $1", [farmId]).catch(() => ({ rows: [] }));
  const key = row.rows[0]?.api_key;
  return { ...extra, ...(key ? { "x-api-key": key } : {}) };
}

// 진단 에이전트(services/diagnosisAgent.js)도 쓰므로 export (2026-08-30)
export function getRpiBase(farmId) {
  // 환경변수 우선 (개발·테스트용 단일 RPi 강제 지정)
  if (process.env.RPI_URL) return process.env.RPI_URL;
  // farm_0001 → farm-0001 hostname (Tailscale MagicDNS)
  const hostname = String(farmId || "").replace(/^farm_/, "farm-");
  if (!hostname) throw new Error("farmId required");
  return `http://${hostname}:1880`;
}

// ━━━ KS X 3267 표준 노드 — RPi 데몬(ks3267d) 프록시 (2026-08-30, P3) ━━━
// 설정 UI(표준노드 탭)가 부른다. NR 의 /api/ks3267/:action 이 127.0.0.1:3002 데몬으로 넘긴다.
// 읽기 전용 액션만 허용 — 제어는 정규 제어 경로(execute_control)로만 (진단 UI 는 읽기 전용 원칙).
const KS3267_READ_ACTIONS = new Set(["discover", "scan", "nodes", "status", "frames", "events", "health"]);
router.get("/:farmId/ks3267/:action", async (req, res) => {
  const { farmId, action } = req.params;
  if (!KS3267_READ_ACTIONS.has(action)) {
    return res.status(400).json({ success: false, error: `허용되지 않는 액션: ${action}` });
  }
  try {
    const qs = new URLSearchParams(req.query).toString();
    const url = `${getRpiBase(farmId)}/api/ks3267/${action}${qs ? "?" + qs : ""}`;
    const r = await fetch(url, { headers: await rpiHeaders(farmId), signal: AbortSignal.timeout(8000) });
    const data = await r.json().catch(() => ({ ok: false, success: false, error: `RPi 응답 파싱 실패 (${r.status})` }));
    // ★ 502 로 내보내지 않는다 — Cloudflare 가 origin 502 를 자기 오류 페이지로 바꿔치기해(CORS 헤더 없음)
    //   브라우저엔 "Network Error" 로만 보인다 (2026-08-30 실측). RPi/데몬 부재는 애플리케이션 상태 → 200 + ok:false.
    if (!r.ok) data.upstreamStatus = r.status;
    res.json(data);
  } catch (error) {
    res.json({ ok: false, success: false, error: `RPi 연결 실패: ${error.message}` });
  }
});

router.get("/sync-status/:farmId", async (req, res) => {
  try {
    const rpiBase = getRpiBase(req.params.farmId);
    const response = await fetch(`${rpiBase}/api/sync/status`, { timeout: 5000, headers: await rpiHeaders(req.params.farmId) });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.warn(`RPi sync-status 조회 실패 (${req.params.farmId}):`, error.message);
    res.json({ success: false, error: "RPi 연결 실패" });
  }
});

router.post("/sync-action/:farmId", async (req, res) => {
  try {
    const { action } = req.body;
    if (!["start", "stop", "skip"].includes(action)) {
      return res.status(400).json({ success: false, error: "Invalid action" });
    }
    const rpiBase = getRpiBase(req.params.farmId);

    let url, method;
    if (action === "start") { url = `${rpiBase}/api/sync/start`; method = "POST"; }
    else if (action === "stop") { url = `${rpiBase}/api/sync/stop`; method = "POST"; }
    else { url = `${rpiBase}/api/sync/skip`; method = "POST"; }

    const response = await fetch(url, { method, headers: await rpiHeaders(req.params.farmId, { "Content-Type": "application/json" }), timeout: 10000 });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.warn(`RPi sync-action 실패 (${req.params.farmId}):`, error.message);
    // 502 금지 — Cloudflare 가 삼켜 브라우저엔 Network Error 로만 보인다 (707 과 동일 처리, 2026-08-30)
    res.json({ success: false, error: "RPi 연결 실패" });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 제어 이력 동기화 프록시 (2026-08-26 신설)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 위의 센서 동기화 프록시와 같은 구조다.
// 클라우드 모드에서는 브라우저가 RPi 에 직접 닿을 수 없으므로 백엔드가 중계한다
// (getRpiApiBase() 가 클라우드 모드에서 백엔드를 가리키기 때문).
router.get("/control-sync-status/:farmId", async (req, res) => {
  try {
    const rpiBase = getRpiBase(req.params.farmId);
    const response = await fetch(`${rpiBase}/api/sync/control/status`, { timeout: 5000, headers: await rpiHeaders(req.params.farmId) });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.warn(`RPi control-sync-status 조회 실패 (${req.params.farmId}):`, error.message);
    res.json({ success: false, error: "RPi 연결 실패" });
  }
});

router.post("/control-sync-action/:farmId", async (req, res) => {
  try {
    const { action } = req.body;
    if (!["start", "stop", "skip"].includes(action)) {
      return res.status(400).json({ success: false, error: "Invalid action" });
    }
    const rpiBase = getRpiBase(req.params.farmId);
    const response = await fetch(`${rpiBase}/api/sync/control/${action}`, {
      method: "POST",
      headers: await rpiHeaders(req.params.farmId, { "Content-Type": "application/json" }),
      timeout: 10000,
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.warn(`RPi control-sync-action 실패 (${req.params.farmId}):`, error.message);
    // 502 금지 — Cloudflare 삼킴 (2026-08-30)
    res.json({ success: false, error: "RPi 연결 실패" });
  }
});

export default router;
