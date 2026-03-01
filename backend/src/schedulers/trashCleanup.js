// src/schedulers/trashCleanup.js
// 농장 휴지통 자동 정리 스케줄러 (30일 초과 영구 삭제)

import cron from "node-cron";
import { prisma } from "../db.js";
import logger from "../utils/logger.js";

const TRASH_RETENTION_DAYS = 30;

async function cleanupTrash() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - TRASH_RETENTION_DAYS);

    const deleted = await prisma.farm.deleteMany({
      where: {
        deletedAt: { not: null, lt: cutoff },
      },
    });

    if (deleted.count > 0) {
      logger.info(`휴지통 자동 정리: ${deleted.count}개 농장 영구 삭제`);
    }
  } catch (error) {
    logger.error("휴지통 정리 실패:", error);
  }
}

export function startTrashCleanupScheduler() {
  // 매일 새벽 3시 실행
  cron.schedule("0 3 * * *", () => {
    logger.info("휴지통 자동 정리 스케줄러 실행");
    cleanupTrash();
  });
  logger.info("휴지통 자동 정리 스케줄러 등록 (매일 03:00, 30일 초과 삭제)");
}
