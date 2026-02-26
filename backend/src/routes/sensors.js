// src/routes/sensors.js
// 센서 데이터 수집 API - PostgreSQL/TimescaleDB 버전
// API 요청/응답 형태 동일 유지

import express from "express";
import Config from "../models/Config.js";
import SensorData from "../models/SensorData.js";
import Alert from "../models/Alert.js";
import { pool } from "../db.js";
import logger from "../utils/logger.js";

const router = express.Router();

/**
 * POST /api/sensors/collect
 * 동적 센서 데이터 수집
 */
router.post("/collect", async (req, res, next) => {
  try {
    const { farmId, houseId, data, deviceInfo } = req.body;

    if (!farmId || !houseId || !data) {
      return res.status(400).json({
        success: false,
        error: "farmId, houseId, and data are required",
      });
    }

    // 1. 하우스 설정 조회
    const config = await Config.findOne({ farmId, houseId });

    if (!config) {
      return res.status(404).json({
        success: false,
        error: "House configuration not found",
      });
    }

    if (!config.enabled) {
      return res.status(403).json({
        success: false,
        error: "House is disabled",
      });
    }

    // 2. 데이터 검증
    const validationErrors = SensorData.validateAgainstConfig(data, config);

    const metadata = {
      configVersion: config.configVersion,
      collectionMethod: "http",
      deviceInfo: deviceInfo || {},
      quality: validationErrors.length > 0 ? "warning" : "good",
    };

    if (validationErrors.length > 0) {
      metadata.errors = validationErrors;
      logger.warn(
        `Data validation warnings: ${farmId}/${houseId}`,
        validationErrors
      );
    }

    // 3. 저장 (TimescaleDB)
    const timestamp = new Date();
    const sensorData = await SensorData.create({
      farmId,
      houseId,
      timestamp,
      data,
      metadata,
    });

    // 4. 알림 체크 (비동기, 실패 시 카운터 기록)
    checkAndCreateAlerts(farmId, houseId, data, config).catch((err) => {
      alertFailureCount++;
      lastAlertFailure = new Date();
      logger.error("Alert check failed:", err);
    });

    logger.info(
      `Sensor data collected: ${farmId}/${houseId} - ${Object.keys(data).length} sensors`
    );

    res.status(201).json({
      success: true,
      message: "Sensor data collected successfully",
      data: {
        farmId,
        houseId,
        timestamp,
        configVersion: metadata.configVersion,
        sensorCount: Object.keys(data).length,
        warnings:
          validationErrors.length > 0 ? validationErrors : undefined,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sensors/batch
 * 배치 수집
 */
router.post("/batch", async (req, res, next) => {
  try {
    const { farmId, houseId, dataArray } = req.body;

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      return res.status(400).json({
        success: false,
        error: "dataArray must be a non-empty array",
      });
    }

    const config = await Config.findOne({ farmId, houseId });
    if (!config) {
      return res.status(404).json({
        success: false,
        error: "House configuration not found",
      });
    }

    const sensorDataDocs = dataArray.map((item) => ({
      farmId,
      houseId,
      timestamp: new Date(item.timestamp || Date.now()),
      data: item.data,
      metadata: {
        configVersion: config.configVersion,
        collectionMethod: "http",
        deviceInfo: item.deviceInfo || {},
        quality: "good",
      },
    }));

    const result = await SensorData.bulkInsert(sensorDataDocs);

    logger.info(
      `Batch data collected: ${farmId}/${houseId} - ${result.length} records`
    );

    res.status(201).json({
      success: true,
      message: "Batch data collected successfully",
      data: {
        farmId,
        houseId,
        totalRecords: dataArray.length,
        inserted: result.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sensors/offline-summary
 * 오프라인 기간 요약 데이터 수신 (RPi 재연결 시)
 * 전체 데이터 대신 센서별 min/avg/max만 전송
 */
router.post("/offline-summary", async (req, res, next) => {
  try {
    const { farmId, houseId, periodStart, periodEnd, sensors } = req.body;

    if (!farmId || !houseId || !sensors) {
      return res.status(400).json({
        success: false,
        error: "farmId, houseId, sensors are required",
      });
    }

    // 요약 데이터를 sensor_data에 1건으로 저장
    const summaryData = {};
    for (const [sensorId, stats] of Object.entries(sensors)) {
      summaryData[sensorId] = stats.avg;
    }

    await pool.query(
      `INSERT INTO sensor_data (farm_id, house_id, timestamp, data, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        farmId,
        houseId,
        new Date(periodEnd || Date.now()),
        JSON.stringify(summaryData),
        JSON.stringify({
          type: "offline_summary",
          periodStart,
          periodEnd,
          sensors,
          collectionMethod: "offline_sync",
        }),
      ]
    );

    logger.info(
      `Offline summary received: ${farmId}/${houseId} (${periodStart} ~ ${periodEnd}, ${Object.keys(sensors).length} sensors)`
    );

    res.status(201).json({
      success: true,
      message: "Offline summary stored",
      data: { farmId, houseId, periodStart, periodEnd, sensorCount: Object.keys(sensors).length },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sensors/latest/:farmId/:houseId
 * 최신 센서 데이터 조회
 */
router.get("/latest/:farmId/:houseId", async (req, res, next) => {
  try {
    const { farmId, houseId } = req.params;

    const latest = await SensorData.getLatest(farmId, houseId);

    if (!latest) {
      return res.status(404).json({
        success: false,
        error: "No sensor data found",
      });
    }

    res.json({
      success: true,
      data: latest,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sensors/data/:farmId/:houseId
 * 센서 데이터 조회 (AnalyticsDashboard 호환용)
 */
router.get("/data/:farmId/:houseId", async (req, res, next) => {
  try {
    const { farmId, houseId } = req.params;
    const { startDate, endDate, limit = 1000 } = req.query;
    const limitNum = Math.min(Math.max(parseInt(limit) || 1000, 1), 5000);

    const query = { farmId, houseId };

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const data = await SensorData.find(query, {
      sort: { timestamp: -1 },
      limit: limitNum,
    });

    res.json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sensors/:farmId/:houseId/latest
 */
router.get("/:farmId/:houseId/latest", async (req, res, next) => {
  try {
    const { farmId, houseId } = req.params;

    const latest = await SensorData.getLatest(farmId, houseId);

    if (!latest) {
      return res.status(404).json({
        success: false,
        error: "No sensor data found",
      });
    }

    res.json({
      success: true,
      data: latest,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sensors/:farmId/:houseId/history
 */
router.get("/:farmId/:houseId/history", async (req, res, next) => {
  try {
    const { farmId, houseId } = req.params;
    const { startDate, endDate, limit } = req.query;

    const history = await SensorData.getTimeRange(
      farmId,
      houseId,
      startDate,
      endDate,
      limit ? parseInt(limit) : undefined
    );

    res.json({
      success: true,
      count: history.length,
      data: history,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sensors/:farmId/:houseId/count
 * 데이터 건수만 반환 (전체 row를 가져오지 않아 빠름)
 */
router.get("/:farmId/:houseId/count", async (req, res, next) => {
  try {
    const { farmId, houseId } = req.params;
    const { startDate, endDate } = req.query;

    const count = await SensorData.getCount(
      farmId,
      houseId,
      startDate,
      endDate
    );

    res.json({
      success: true,
      count,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/sensors/:farmId/:houseId/stats/:sensorId
 */
router.get("/:farmId/:houseId/stats/:sensorId", async (req, res, next) => {
  try {
    const { farmId, houseId, sensorId } = req.params;
    const { startDate, endDate, interval = "hour" } = req.query;

    const stats = await SensorData.getAggregated(
      farmId,
      houseId,
      sensorId,
      startDate,
      endDate,
      interval
    );

    res.json({
      success: true,
      sensorId,
      interval,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * 센서 데이터 기반 알림 체크 및 생성
 * 동일 센서/알림유형에 대해 10분 쿨다운 적용하여 중복 알림 방지
 */
const ALERT_COOLDOWN_MS = 10 * 60 * 1000; // 10분
const ALERT_COOLDOWN_MAX_ENTRIES = 500; // 최대 엔트리 수

// TTL 기반 쿨다운 맵 — 주기적 정리로 메모리 누수 방지
const alertCooldowns = new Map();

function cleanupCooldowns() {
  const now = Date.now();
  let deleted = 0;
  for (const [key, timestamp] of alertCooldowns) {
    if (now - timestamp > ALERT_COOLDOWN_MS) {
      alertCooldowns.delete(key);
      deleted++;
    }
  }
  // 정리 후에도 너무 크면 오래된 것부터 삭제
  if (alertCooldowns.size > ALERT_COOLDOWN_MAX_ENTRIES) {
    const entries = [...alertCooldowns.entries()].sort((a, b) => a[1] - b[1]);
    const toDelete = entries.slice(0, entries.length - ALERT_COOLDOWN_MAX_ENTRIES);
    toDelete.forEach(([key]) => alertCooldowns.delete(key));
  }
  if (deleted > 0) {
    logger.info(`[Alert] Cooldown cleanup: ${deleted} expired entries removed, ${alertCooldowns.size} remaining`);
  }
}

// 5분마다 만료된 쿨다운 정리
setInterval(cleanupCooldowns, 5 * 60 * 1000);

// 알림 실패 추적 (health 엔드포인트에서 조회)
let alertFailureCount = 0;
let lastAlertFailure = null;

export function getAlertHealth() {
  return { failureCount: alertFailureCount, lastFailure: lastAlertFailure, cooldownMapSize: alertCooldowns.size };
}

async function checkAndCreateAlerts(farmId, houseId, data, config) {
  try {
    const sensors = Array.isArray(config.sensors) ? config.sensors : [];

    for (const sensor of sensors) {
      const value = data[sensor.sensorId];

      if (value === undefined || value === null) continue;
      if (sensor.type !== "number") continue;

      let alertType = null;
      let message = null;
      let severity = "WARNING";
      let threshold = null;

      if (sensor.max !== null && sensor.max !== undefined && value > sensor.max) {
        alertType = "HIGH";
        threshold = sensor.max;
        severity = value > sensor.max * 1.2 ? "CRITICAL" : "WARNING";
        message = `${sensor.name}이(가) 높습니다! (${value}${sensor.unit} > ${sensor.max}${sensor.unit})`;
      } else if (
        sensor.min !== null &&
        sensor.min !== undefined &&
        value < sensor.min
      ) {
        alertType = "LOW";
        threshold = sensor.min;
        severity = value < sensor.min * 0.8 ? "CRITICAL" : "WARNING";
        message = `${sensor.name}이(가) 낮습니다! (${value}${sensor.unit} < ${sensor.min}${sensor.unit})`;
      }

      if (alertType) {
        // 쿨다운 체크 — 동일 센서에 대해 10분 내 중복 알림 방지
        const cooldownKey = `${farmId}:${houseId}:${sensor.sensorId}:${alertType}`;
        const lastAlertTime = alertCooldowns.get(cooldownKey);
        if (lastAlertTime && Date.now() - lastAlertTime < ALERT_COOLDOWN_MS) {
          continue;
        }

        await Alert.create({
          farmId,
          houseId,
          sensorId: sensor.sensorId,
          alertType,
          severity,
          message,
          value,
          threshold,
          metadata: {
            sensorName: sensor.name,
            unit: sensor.unit,
            houseName: config.houseName,
          },
        });

        alertCooldowns.set(cooldownKey, Date.now());

        logger.warn(
          `Alert created: ${alertType} for ${sensor.name} (${value}${sensor.unit})`
        );
      }
    }
  } catch (error) {
    logger.error("Failed to check alerts:", error);
  }
}

export default router;
