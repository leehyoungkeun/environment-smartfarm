// src/routes/audit-logs.js
// 감사 로그 조회 API

import express from "express";
import { prisma } from "../db.js";
import logger from "../utils/logger.js";

const router = express.Router();

/**
 * GET /api/audit-logs/:farmId
 * 감사 로그 조회 (페이지네이션)
 */
router.get("/:farmId", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { action, targetType, limit = 50, page = 1 } = req.query;

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const where = { farmId };
    if (action) where.action = action;
    if (targetType) where.targetType = targetType;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error("감사 로그 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/audit-logs/:farmId/stats
 * 감사 로그 통계
 */
router.get("/:farmId/stats", async (req, res) => {
  try {
    const { farmId } = req.params;

    const [total, byAction, byTarget] = await Promise.all([
      prisma.auditLog.count({ where: { farmId } }),
      prisma.auditLog.groupBy({
        by: ["action"],
        where: { farmId },
        _count: true,
        orderBy: { _count: { action: "desc" } },
        take: 10,
      }),
      prisma.auditLog.groupBy({
        by: ["targetType"],
        where: { farmId },
        _count: true,
        orderBy: { _count: { targetType: "desc" } },
        take: 10,
      }),
    ]);

    res.json({
      success: true,
      data: {
        total,
        byAction: byAction.map((r) => ({ action: r.action, count: r._count })),
        byTarget: byTarget.map((r) => ({ targetType: r.targetType, count: r._count })),
      },
    });
  } catch (error) {
    logger.error("감사 로그 통계 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
