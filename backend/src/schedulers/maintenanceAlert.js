// src/schedulers/maintenanceAlert.js
// 유지보수 계약 만료 알림 스케줄러

import cron from "node-cron";
import { prisma, pool } from "../db.js";
import Alert from "../models/Alert.js";
import logger from "../utils/logger.js";

// 기본 설정 (DB에 없을 때 사용)
const DEFAULT_MAINTENANCE_CONFIG = {
  enabled: true,
  alertDays: [30, 7, 0], // D-30, D-7, D-day
};

// 농장별 maintenanceConfig를 DB에서 로드
async function loadMaintenanceConfigs() {
  const configs = {};
  try {
    const result = await pool.query(
      "SELECT farm_id, settings FROM system_settings"
    );
    for (const row of result.rows) {
      if (row.settings?.maintenanceConfig) {
        configs[row.farm_id] = { ...DEFAULT_MAINTENANCE_CONFIG, ...row.settings.maintenanceConfig };
      }
    }
  } catch (e) {
    logger.warn("유지보수 알림 설정 로드 실패 (기본값 사용):", e.message);
  }
  return configs;
}

async function checkMaintenanceExpiry() {
  try {
    const maintenanceConfigs = await loadMaintenanceConfigs();

    const farms = await prisma.farm.findMany({
      where: { status: "active", maintenanceMonths: { gt: 0 } },
      select: {
        farmId: true,
        name: true,
        maintenanceMonths: true,
        maintenanceStartAt: true,
        createdAt: true,
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];

    for (const farm of farms) {
      const cfg = maintenanceConfigs[farm.farmId] || DEFAULT_MAINTENANCE_CONFIG;

      // 농장별 유지보수 알림 비활성화 체크
      if (cfg.enabled === false) continue;

      const alertDays = cfg.alertDays || DEFAULT_MAINTENANCE_CONFIG.alertDays;

      const startAt = farm.maintenanceStartAt || farm.createdAt;
      const expiresAt = new Date(startAt);
      expiresAt.setMonth(expiresAt.getMonth() + farm.maintenanceMonths);

      const daysLeft = Math.ceil((expiresAt - today) / (1000 * 60 * 60 * 24));

      // 설정된 알림일에만 알림
      if (!alertDays.includes(daysLeft)) continue;

      // 중복 체크: 오늘 같은 farmId로 MAINTENANCE_EXPIRY 알림이 있는지
      const existing = await Alert.find(
        { farmId: farm.farmId },
        { limit: 1 }
      );
      const alreadySent = existing.some(
        (a) =>
          a.alertType === "MAINTENANCE_EXPIRY" &&
          a.createdAt &&
          new Date(a.createdAt).toISOString().split("T")[0] === todayStr
      );
      if (alreadySent) continue;

      let severity, message;
      if (daysLeft <= 0) {
        severity = "CRITICAL";
        message = `${farm.name} 유지보수 계약이 만료되었습니다.`;
      } else if (daysLeft <= 7) {
        severity = "WARNING";
        message = `${farm.name} 유지보수 계약이 ${daysLeft}일 후 만료됩니다.`;
      } else {
        severity = "INFO";
        message = `${farm.name} 유지보수 계약이 ${daysLeft}일 후 만료됩니다.`;
      }

      await Alert.create({
        farmId: farm.farmId,
        houseId: null,
        alertType: "MAINTENANCE_EXPIRY",
        severity,
        message,
        metadata: {
          daysLeft,
          expiresAt: expiresAt.toISOString(),
          farmName: farm.name,
        },
      });

      logger.info(
        `유지보수 만료 알림 생성: ${farm.farmId} (${farm.name}) D-${daysLeft}`
      );
    }
  } catch (error) {
    logger.error("유지보수 만료 체크 실패:", error);
  }
}

export function startMaintenanceAlertScheduler() {
  // 매일 오전 9시 실행
  cron.schedule("0 9 * * *", () => {
    logger.info("유지보수 만료 알림 스케줄러 실행");
    checkMaintenanceExpiry();
  });

  // 서버 시작 시 1회 즉시 실행
  checkMaintenanceExpiry();

  logger.info("유지보수 만료 알림 스케줄러 등록 (매일 09:00)");
}
