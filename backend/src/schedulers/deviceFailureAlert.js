// src/schedulers/deviceFailureAlert.js
// 제어 연속 실패 패턴 기반 장비 고장 감지 스케줄러

import cron from "node-cron";
import { pool } from "../db.js";
import Alert from "../models/Alert.js";
import logger from "../utils/logger.js";

// 서킷 브레이커 계산 구간.
// 전 기간 미확인 개수를 세면, 아무도 확인하지 않는 한 브레이커가 영원히
// 열린 채 남아 감지 자체가 죽는다 (2026-08-26 점검에서 실제로 그랬다).
// 최근 구간만 세면 사고가 끝난 뒤 스스로 풀린다.
const UNACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// 기본 설정 (DB에 없을 때 사용)
const DEFAULT_DEVICE_FAILURE_CONFIG = {
  enabled: true,
  observationWindowMinutes: 30, // 최근 30분간
  controlFailureThreshold: 3, // 3회 이상 실패
  cooldownMinutes: 60, // 1시간 중복 방지
};

// 농장별 deviceFailureConfig를 DB에서 로드
async function loadDeviceFailureConfigs() {
  const configs = {};
  try {
    const result = await pool.query(
      "SELECT farm_id, settings FROM system_settings"
    );
    for (const row of result.rows) {
      if (row.settings?.deviceFailureConfig) {
        configs[row.farm_id] = {
          ...DEFAULT_DEVICE_FAILURE_CONFIG,
          ...row.settings.deviceFailureConfig,
        };
      }
    }
  } catch (e) {
    logger.warn("장비 고장 알림 설정 로드 실패 (기본값 사용):", e.message);
  }
  return configs;
}

export async function checkDeviceFailures() {
  try {
    const deviceFailureConfigs = await loadDeviceFailureConfigs();

    // 모든 active 농장 조회
    const farmResult = await pool.query(
      "SELECT DISTINCT farm_id FROM control_logs WHERE timestamp > NOW() - interval '2 hours'"
    );
    if (farmResult.rows.length === 0) return;

    const now = Date.now();

    for (const { farm_id: farmId } of farmResult.rows) {
      const cfg =
        deviceFailureConfigs[farmId] || DEFAULT_DEVICE_FAILURE_CONFIG;

      if (cfg.enabled === false) continue;

      const windowMin = cfg.observationWindowMinutes;
      const threshold = cfg.controlFailureThreshold;
      const cooldownMs = cfg.cooldownMinutes * 60 * 1000;

      // 최근 N분간 장치별 실패 횟수 집계
      const { rows: failedDevices } = await pool.query(
        `SELECT device_id, farm_id, house_id, device_name,
                COUNT(*)::int as fail_count,
                MAX(error) as last_error,
                MAX(timestamp) as last_failure
         FROM control_logs
         WHERE success = false
           AND farm_id = $1
           AND timestamp > NOW() - interval '${windowMin} minutes'
         GROUP BY device_id, farm_id, house_id, device_name
         HAVING COUNT(*) >= $2`,
        [farmId, threshold]
      );

      for (const device of failedDevices) {
        // 쿨다운 체크: 동일 farmId+deviceId에 DEVICE_FAILURE 알림이 최근에 있으면 skip
        const recent = await Alert.find(
          { farmId: device.farm_id, houseId: device.house_id },
          { limit: 50 }
        );

        // 서킷 브레이커: 최근 24시간 내 같은 장비의 미확인이 3개 이상이면 스킵
        const unackSince = Date.now() - UNACK_WINDOW_MS;
        const unackCount = recent.filter(
          (a) =>
            a.alertType === "DEVICE_FAILURE" &&
            a.sensorId === device.device_id &&
            !a.acknowledged &&
              a.createdAt &&
              new Date(a.createdAt).getTime() >= unackSince
        ).length;
        if (unackCount >= 3) continue;

        const alreadySent = recent.find(
          (a) =>
            a.alertType === "DEVICE_FAILURE" &&
            a.sensorId === device.device_id &&
            a.createdAt &&
            now - new Date(a.createdAt).getTime() < cooldownMs
        );
        if (alreadySent) continue;

        const severity = device.fail_count >= threshold * 2 ? "CRITICAL" : "WARNING";
        const deviceName = device.device_name || device.device_id;
        const message = `${deviceName} 장비 고장 의심 — ${windowMin}분간 ${device.fail_count}회 제어 실패`;

        await Alert.create({
          farmId: device.farm_id,
          houseId: device.house_id,
          sensorId: device.device_id,
          alertType: "DEVICE_FAILURE",
          severity,
          message,
          metadata: {
            deviceId: device.device_id,
            deviceName,
            failCount: device.fail_count,
            lastError: device.last_error,
            lastFailure: device.last_failure,
            observationWindowMinutes: windowMin,
          },
        });

        logger.info(
          `장비 고장 알림: ${device.farm_id}/${device.house_id} ${deviceName} ${device.fail_count}회 실패 [${severity}]`
        );
      }
    }
  } catch (error) {
    logger.error("장비 고장 체크 실패:", error);
  }
}

export function startDeviceFailureScheduler() {
  // 5분마다 실행
  cron.schedule("*/5 * * * *", () => {
    logger.info("장비 고장 감지 스케줄러 실행");
    checkDeviceFailures();
  });

  // 서버 시작 시 1회 즉시 실행
  checkDeviceFailures();

  logger.info("장비 고장 감지 알림 스케줄러 등록 (5분 간격)");
}
