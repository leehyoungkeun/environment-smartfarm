// src/schedulers/offlineAlert.js
// 농장 오프라인 감지 알림 스케줄러

import cron from "node-cron";
import { prisma, pool } from "../db.js";
import Alert from "../models/Alert.js";
import logger from "../utils/logger.js";
import { broadcastFarmStatus } from "../services/wsServer.js";

// 서킷 브레이커 계산 구간.
// 전 기간 미확인 개수를 세면, 아무도 확인하지 않는 한 브레이커가 영원히
// 열린 채 남아 감지 자체가 죽는다 (2026-08-26 점검에서 실제로 그랬다).
// 최근 구간만 세면 사고가 끝난 뒤 스스로 풀린다.
const UNACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// 기본 설정 (DB에 없을 때 사용)
const DEFAULT_OFFLINE_CONFIG = {
  enabled: true,
  offlineThresholdMin: 10,    // 10분 이상 미접속 → WARNING
  criticalThresholdMin: 60,   // 60분 이상 미접속 → CRITICAL
  cooldownMinutes: 60,        // 1시간 중복 방지
};

// 농장별 offlineConfig를 DB에서 로드
async function loadOfflineConfigs() {
  const configs = {};
  try {
    const result = await pool.query(
      "SELECT farm_id, settings FROM system_settings"
    );
    for (const row of result.rows) {
      if (row.settings?.offlineConfig) {
        configs[row.farm_id] = { ...DEFAULT_OFFLINE_CONFIG, ...row.settings.offlineConfig };
      }
    }
  } catch (e) {
    logger.warn("오프라인 알림 설정 로드 실패 (기본값 사용):", e.message);
  }
  return configs;
}

export async function checkOfflineFarms() {
  try {
    const offlineConfigs = await loadOfflineConfigs();

    const farms = await prisma.farm.findMany({
      // 모든 농장을 본다 — 장치 online/offline 표시는 상태와 무관하게 사실이어야 한다 (2026-08-29).
      // 전에는 active 만 돌아서 점검중 농장의 장치가 꺼진 뒤에도 영원히 "온라인" 으로 남았다(farm_0006).
      // 알림은 아래에서 active 농장에만 낸다.
      where: { lastSeenAt: { not: null } },
      select: { farmId: true, name: true, lastSeenAt: true, status: true },
    });

    const now = Date.now();

    for (const farm of farms) {
      const cfg = offlineConfigs[farm.farmId] || DEFAULT_OFFLINE_CONFIG;

      // 농장별 오프라인 알림 비활성화 체크
      if (cfg.enabled === false) continue;

      const diffMs = now - new Date(farm.lastSeenAt).getTime();
      const diffMin = Math.floor(diffMs / 60000);

      if (diffMin < cfg.offlineThresholdMin) continue;

      // devices.status → offline 변경 + WebSocket 브로드캐스트
      await pool.query(
        "UPDATE devices SET status = 'offline' WHERE farm_id = $1 AND status = 'online'",
        [farm.farmId]
      ).catch(() => {});
      broadcastFarmStatus(farm.farmId, null);

      // 여기부터는 알림 — 운영 중(active) 농장만. 점검중·중지 농장은 장치 상태만 갱신하고 끝.
      if (farm.status !== "active") continue;

      const cooldownMs = cfg.cooldownMinutes * 60 * 1000;

      // 중복 체크: 쿨다운 이내 FARM_OFFLINE 알림이 있으면 skip
      const recent = await Alert.find(
        { farmId: farm.farmId },
        { limit: 50 }
      );

      // 서킷 브레이커: 최근 24시간 내 미확인 FARM_OFFLINE 이 3개 이상이면 스킵
      const unackSince = now - UNACK_WINDOW_MS;
      const unackCount = recent.filter(
        (a) =>
          a.alertType === "FARM_OFFLINE" &&
          !a.acknowledged &&
          a.createdAt &&
          new Date(a.createdAt).getTime() >= unackSince
      ).length;
      if (unackCount >= 3) continue;

      const recentOffline = recent.find(
        (a) =>
          a.alertType === "FARM_OFFLINE" &&
          a.createdAt &&
          now - new Date(a.createdAt).getTime() < cooldownMs
      );
      if (recentOffline) continue;

      const severity = diffMin >= cfg.criticalThresholdMin ? "CRITICAL" : "WARNING";
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
