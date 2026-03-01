// src/schedulers/sensorThresholdAlert.js
// 센서 임계값 초과 감지 알림 스케줄러

import cron from "node-cron";
import { prisma, pool } from "../db.js";
import Alert from "../models/Alert.js";
import logger from "../utils/logger.js";

const COOLDOWN_MS = 15 * 60 * 1000; // 동일 센서 15분 중복 방지

// sensorId에 키워드 없을 때 사용할 기본 임계값
const DEFAULT_THRESHOLDS = {
  temperature: { min: 5, max: 40 },
  humidity:    { min: 20, max: 95 },
  co2:         { min: 0, max: 3000 },
  ec:          { min: 0.3, max: 3.5 },
  ph:          { min: 4.5, max: 8.5 },
};

// sensorId에서 센서 타입 추론
const SENSOR_PATTERNS = [
  { pattern: /temp/i, type: "temperature" },
  { pattern: /humi/i, type: "humidity" },
  { pattern: /co2/i, type: "co2" },
  { pattern: /ec[_\d]|^ec$/i, type: "ec" },
  { pattern: /ph[_\d]|^ph$/i, type: "ph" },
];

function guessSensorType(sensorId) {
  for (const { pattern, type } of SENSOR_PATTERNS) {
    if (pattern.test(sensorId)) return type;
  }
  return null;
}

function getThresholds(sensorCfg, sensorId) {
  // 1) house_configs.sensors에 minValue/maxValue가 설정되어 있으면 우선
  if (sensorCfg?.minValue != null || sensorCfg?.maxValue != null) {
    return { min: sensorCfg.minValue ?? null, max: sensorCfg.maxValue ?? null };
  }
  // 2) sensorId에서 타입 추론 → 기본 임계값 적용
  const type = guessSensorType(sensorId);
  if (type && DEFAULT_THRESHOLDS[type]) {
    return DEFAULT_THRESHOLDS[type];
  }
  return null; // 임계값 판단 불가 → 스킵
}

function calcSeverity(value, min, max) {
  // range의 50% 이상 벗어나면 CRITICAL
  const range = (max ?? 0) - (min ?? 0);
  if (range <= 0) return "WARNING";
  if (max != null && value > max) {
    return (value - max) / range >= 0.5 ? "CRITICAL" : "WARNING";
  }
  if (min != null && value < min) {
    return (min - value) / range >= 0.5 ? "CRITICAL" : "WARNING";
  }
  return "WARNING";
}

async function checkSensorThresholds() {
  try {
    // 1) active 농장의 하우스 설정 조회
    const houses = await prisma.houseConfig.findMany({
      where: {
        enabled: true,
        farm: { status: "active" },
      },
      select: {
        farmId: true,
        houseId: true,
        houseName: true,
        sensors: true,
      },
    });

    if (houses.length === 0) return;

    const now = Date.now();
    let alertCount = 0;

    for (const house of houses) {
      // 2) 최신 센서 데이터 1건 조회
      const { rows } = await pool.query(
        `SELECT data, timestamp FROM sensor_data
         WHERE farm_id = $1 AND house_id = $2
         ORDER BY timestamp DESC LIMIT 1`,
        [house.farmId, house.houseId]
      );
      if (rows.length === 0) continue;

      const sensorData = rows[0].data;
      const dataTime = new Date(rows[0].timestamp);
      // 10분 이상 된 데이터는 스킵 (이미 수집이 안 되고 있는 상태)
      if (now - dataTime.getTime() > 10 * 60 * 1000) continue;

      const sensorsCfg = Array.isArray(house.sensors) ? house.sensors : [];

      // 3) 각 센서값 체크
      for (const [sensorId, rawValue] of Object.entries(sensorData)) {
        const value = Number(rawValue);
        if (isNaN(value)) continue;

        const sensorCfg = sensorsCfg.find(s => s.sensorId === sensorId);
        // alertEnabled가 명시적으로 false면 스킵
        if (sensorCfg?.alertEnabled === false) continue;

        const thresholds = getThresholds(sensorCfg, sensorId);
        if (!thresholds) continue;

        const { min, max } = thresholds;
        const outOfRange =
          (max != null && value > max) || (min != null && value < min);
        if (!outOfRange) continue;

        // 4) 중복 체크: 동일 farm+house+sensor에 최근 15분 이내 알림
        const recent = await Alert.find(
          { farmId: house.farmId, houseId: house.houseId },
          { limit: 10 }
        );
        const alreadySent = recent.find(
          (a) =>
            a.alertType === "SENSOR_THRESHOLD" &&
            a.sensorId === sensorId &&
            a.createdAt &&
            now - new Date(a.createdAt).getTime() < COOLDOWN_MS
        );
        if (alreadySent) continue;

        // 5) 알림 생성
        const severity = calcSeverity(value, min, max);
        const direction = max != null && value > max ? "상한" : "하한";
        const thresholdVal = max != null && value > max ? max : min;
        const sensorName = sensorCfg?.name || sensorId;
        const unit = sensorCfg?.unit || "";

        const message = `${house.houseName || house.houseId} ${sensorName} ${value}${unit} — ${direction}(${thresholdVal}${unit}) 초과`;

        await Alert.create({
          farmId: house.farmId,
          houseId: house.houseId,
          sensorId,
          alertType: "SENSOR_THRESHOLD",
          severity,
          message,
          value,
          threshold: thresholdVal,
          metadata: {
            houseName: house.houseName,
            sensorName,
            unit,
            direction,
            min,
            max,
          },
        });

        alertCount++;
        logger.info(
          `센서 알림: ${house.farmId}/${house.houseId} ${sensorName}=${value}${unit} [${severity}]`
        );
      }
    }

    if (alertCount > 0) {
      logger.info(`센서 임계값 체크 완료: ${alertCount}건 알림 생성`);
    }
  } catch (error) {
    logger.error("센서 임계값 체크 실패:", error);
  }
}

export function startSensorThresholdScheduler() {
  // 5분마다 실행
  cron.schedule("*/5 * * * *", () => {
    checkSensorThresholds();
  });

  // 서버 시작 시 1회 즉시 실행
  checkSensorThresholds();

  logger.info("센서 임계값 알림 스케줄러 등록 (5분 간격)");
}
