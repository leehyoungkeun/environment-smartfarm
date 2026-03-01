// src/routes/internal.routes.js
// Node-RED 내부 통신용 엔드포인트 (기존 /internal/* 호환)
// f2~f7, f10 탭에서 호출

import express from "express";
import Alert from "../models/Alert.js";
import ControlLog from "../models/ControlLog.js";
import Config from "../models/Config.js";
import { pool } from "../db.js";
import logger from "../utils/logger.js";

const router = express.Router();

const DEFAULT_FARM_ID = process.env.FARM_ID || "farm_0001";
const DEFAULT_HOUSE_ID = process.env.HOUSE_ID || "house_001";

function resolveFarmHouse(req) {
  return {
    farmId: req.body?.farmId || req.query?.farmId || DEFAULT_FARM_ID,
    houseId: req.body?.houseId || req.query?.houseId || DEFAULT_HOUSE_ID,
  };
}

/**
 * POST /internal/status-update
 * 장비 상태 업데이트 (f2, f4, f6, f10)
 * Node-RED가 밸브/펌프/믹서 상태를 전송
 */
router.post("/status-update", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const status = req.body;
    logger.info("장비 상태 수신:", JSON.stringify(status).slice(0, 200));

    // control_logs 테이블에 상태 기록
    if (status.operating_state || status.valve_states) {
      await pool.query(
        `INSERT INTO control_logs (farm_id, house_id, device_id, device_type, command, success, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          farmId,
          houseId,
          "system",
          "status_update",
          JSON.stringify(status),
          true,
        ]
      );
    }

    res.json({ success: true, message: "상태 업데이트 완료" });
  } catch (error) {
    logger.error("상태 업데이트 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /internal/programs
 * 관수 프로그램 목록 (f3 관수 스케줄러)
 * automation 규칙 중 관수 관련 규칙을 반환
 */
router.get("/programs", async (req, res) => {
  try {
    const { farmId } = resolveFarmHouse(req);
    const { rows } = await pool.query(
      `SELECT * FROM automation_rules
       WHERE farm_id = $1 AND enabled = true
       ORDER BY created_at`,
      [farmId]
    );

    // Node-RED 관수 스케줄러 호환 형태로 변환
    const programs = rows.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      conditions: rule.conditions,
      actions: rule.actions,
      schedule: rule.time_conditions || {},
    }));

    res.json({ success: true, data: programs });
  } catch (error) {
    logger.error("프로그램 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /internal/config
 * 하우스 설정 (f5 경보 처리 - 임계값 조회)
 */
router.get("/config", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const config = await Config.findOne({ farmId, houseId });

    if (!config) {
      // 기본 임계값 반환
      return res.json({
        success: true,
        data: {
          alarm_ec_upper: 3.5,
          alarm_ec_lower: 0.3,
          alarm_ph_upper: 8.5,
          alarm_ph_lower: 4.5,
          alarm_temp_upper: 40,
          alarm_temp_lower: 5,
        },
      });
    }

    // config에서 알람 임계값 추출
    const thresholds = config.thresholds || config.alarmThresholds || {};
    res.json({
      success: true,
      data: {
        alarm_ec_upper: thresholds.ecUpper || 3.5,
        alarm_ec_lower: thresholds.ecLower || 0.3,
        alarm_ph_upper: thresholds.phUpper || 8.5,
        alarm_ph_lower: thresholds.phLower || 4.5,
        alarm_temp_upper: thresholds.tempUpper || 40,
        alarm_temp_lower: thresholds.tempLower || 5,
        ...thresholds,
      },
    });
  } catch (error) {
    logger.error("설정 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /internal/alarm
 * 경보 생성 (f5 경보 처리)
 */
router.post("/alarm", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const alarm = req.body;
    logger.warn("경보 수신:", alarm.alarm_type, alarm.message);

    const alert = await Alert.create({
      farmId,
      houseId,
      alertType: alarm.alarm_type,
      severity: "warning",
      message: alarm.message,
      value: alarm.alarm_value,
      threshold: alarm.threshold_value,
      acknowledged: false,
    });

    res.json({ success: true, data: alert });
  } catch (error) {
    logger.error("경보 생성 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /internal/daily-summary-data
 * 일일 집계용 센서 평균 데이터 (f7 일일집계)
 */
router.get("/daily-summary-data", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    // sensor_data 테이블: data JSONB에 센서값 저장 (sensor_id 컬럼 없음)
    const { rows } = await pool.query(
      `SELECT data
       FROM sensor_data
       WHERE farm_id = $1 AND house_id = $2
         AND timestamp >= $3::date AND timestamp < ($3::date + interval '1 day')`,
      [farmId, houseId, dateStr]
    );

    // JSONB data에서 센서별 통계 계산
    const sensorValues = {};
    rows.forEach((row) => {
      const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      for (const [sensorId, value] of Object.entries(data || {})) {
        const numVal = parseFloat(value);
        if (isNaN(numVal)) continue;
        if (!sensorValues[sensorId]) sensorValues[sensorId] = [];
        sensorValues[sensorId].push(numVal);
      }
    });

    const sensorAverages = {};
    for (const [sensorId, values] of Object.entries(sensorValues)) {
      const sum = values.reduce((a, b) => a + b, 0);
      sensorAverages[sensorId] = {
        avg: Math.round((sum / values.length) * 100) / 100,
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
      };
    }

    res.json({ success: true, data: { date: dateStr, sensor_averages: sensorAverages } });
  } catch (error) {
    logger.error("일일 집계 데이터 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /internal/daily-summary
 * 일일 집계 저장 (f7 일일집계)
 */
router.post("/daily-summary", async (req, res) => {
  try {
    const { farmId, houseId } = resolveFarmHouse(req);
    const summary = req.body;
    logger.info("일일 집계 수신:", summary.date);

    await pool.query(
      `INSERT INTO daily_summaries (farm_id, house_id, date, summary_data, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (farm_id, house_id, date) DO UPDATE SET summary_data = $4`,
      [farmId, houseId, summary.date, JSON.stringify(summary)]
    );

    res.json({ success: true, message: "일일 집계 저장 완료" });
  } catch (error) {
    logger.error("일일 집계 저장 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
