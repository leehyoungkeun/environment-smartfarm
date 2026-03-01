// src/schedulers/offlineAlert.js
// 농장 오프라인 감지 알림 스케줄러

import cron from "node-cron";
import { prisma } from "../db.js";
import Alert from "../models/Alert.js";
import logger from "../utils/logger.js";

const OFFLINE_THRESHOLD_MIN = 10; // 10분 이상 미접속 → WARNING
const CRITICAL_THRESHOLD_MIN = 60; // 60분 이상 미접속 → CRITICAL
const COOLDOWN_MS = 60 * 60 * 1000; // 1시간 중복 방지

async function checkOfflineFarms() {
  try {
    const farms = await prisma.farm.findMany({
      where: { status: "active", lastSeenAt: { not: null } },
      select: { farmId: true, name: true, lastSeenAt: true },
    });

    const now = Date.now();

    for (const farm of farms) {
      const diffMs = now - new Date(farm.lastSeenAt).getTime();
      const diffMin = Math.floor(diffMs / 60000);

      if (diffMin < OFFLINE_THRESHOLD_MIN) continue;

      // 중복 체크: 최근 1시간 이내 FARM_OFFLINE 알림이 있으면 skip
      const recent = await Alert.find(
        { farmId: farm.farmId },
        { limit: 1 }
      );
      const recentOffline = recent.find(
        (a) =>
          a.alertType === "FARM_OFFLINE" &&
          a.createdAt &&
          now - new Date(a.createdAt).getTime() < COOLDOWN_MS
      );
      if (recentOffline) continue;

      const severity = diffMin >= CRITICAL_THRESHOLD_MIN ? "CRITICAL" : "WARNING";
      const message =
        severity === "CRITICAL"
          ? `${farm.name} 농장이 ${diffMin}분째 오프라인입니다 (긴급).`
          : `${farm.name} 농장이 ${diffMin}분째 오프라인입니다.`;

      await Alert.create({
        farmId: farm.farmId,
        houseId: "FARM",
        alertType: "FARM_OFFLINE",
        severity,
        message,
        metadata: {
          diffMin,
          lastSeenAt: farm.lastSeenAt,
          farmName: farm.name,
        },
      });

      logger.info(
        `오프라인 알림 생성: ${farm.farmId} (${farm.name}) ${diffMin}분 미접속 [${severity}]`
      );
    }
  } catch (error) {
    logger.error("오프라인 감지 체크 실패:", error);
  }
}

export function startOfflineAlertScheduler() {
  // 5분마다 실행
  cron.schedule("*/5 * * * *", () => {
    logger.info("오프라인 감지 스케줄러 실행");
    checkOfflineFarms();
  });

  // 서버 시작 시 1회 즉시 실행
  checkOfflineFarms();

  logger.info("오프라인 감지 알림 스케줄러 등록 (5분 간격)");
}
