// src/routes/farms.routes.js
// Farm CRUD + API 키 관리 + 사용자 할당

import express from "express";
import crypto from "crypto";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma, pool } from "../db.js";
import { authorize } from "../middleware/auth.middleware.js";
import { SYSTEM_WIDE_ROLES } from "../models/User.js";
import Alert from "../models/Alert.js";
import logger from "../utils/logger.js";

// 문서 업로드 설정 (Feature: 문서/첨부파일)
const DOC_UPLOAD_DIR = process.env.UPLOAD_DIR ? `${process.env.UPLOAD_DIR}/farms` : "uploads/farms";
function sanitizeFarmId(fid) { return (fid || "default").replace(/[^a-zA-Z0-9_-]/g, "_"); }
const docStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const farmDir = path.join(DOC_UPLOAD_DIR, sanitizeFarmId(req.params.farmId));
    if (!fs.existsSync(farmDir)) fs.mkdirSync(farmDir, { recursive: true });
    cb(null, farmDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
  },
});
const docUpload = multer({
  storage: docStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip/;
    if (allowed.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error("지원되지 않는 파일 형식입니다"));
  },
});

const router = express.Router();

// BigInt → Number 변환 헬퍼 (JSON 직렬화 지원)
function toBigIntSafe(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) => typeof v === "bigint" ? Number(v) : v));
}

// 감사 로그 기록 헬퍼
async function audit(req, action, targetType, targetId, details = {}) {
  try {
    await prisma.auditLog.create({
      data: {
        farmId: details.farmId || targetId || null,
        userId: req.user?.id || null,
        userName: req.user?.name || null,
        action, targetType, targetId: targetId || null,
        details,
      },
    });
  } catch (e) { logger.warn(`감사 로그 기록 실패: ${e.message}`); }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 사업 마스터 CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/business-projects", async (req, res) => {
  try {
    const projects = await prisma.businessProject.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { farms: true } } },
    });
    res.json({ success: true, data: projects });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/business-projects", authorize("manager"), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: "사업명은 필수입니다" });
    const project = await prisma.businessProject.create({
      data: { name: name.trim() },
    });
    res.json({ success: true, data: project });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ success: false, error: "이미 등록된 사업명입니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete("/business-projects/:id", authorize("manager"), async (req, res) => {
  try {
    const linked = await prisma.farm.count({ where: { businessProjectId: req.params.id } });
    if (linked > 0) return res.status(409).json({ success: false, error: `${linked}개 농장이 연결되어 있어 삭제할 수 없습니다` });
    await prisma.businessProject.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/farms/alert-summary — 농장 알림 요약 (대시보드 카드용)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/alert-summary", async (req, res) => {
  try {
    const farms = await prisma.farm.findMany({
      where: { status: "active" },
      select: { farmId: true, lastSeenAt: true, maintenanceMonths: true, maintenanceStartAt: true, createdAt: true },
    });

    const now = Date.now();
    const OFFLINE_THRESHOLD = 10 * 60 * 1000; // 10분

    // 오프라인 농장
    const offlineIds = new Set();
    for (const f of farms) {
      if (!f.lastSeenAt || now - new Date(f.lastSeenAt).getTime() > OFFLINE_THRESHOLD) {
        offlineIds.add(f.farmId);
      }
    }

    // 유지보수 만료 임박 (90일 이내)
    const maintExpiringIds = new Set();
    for (const f of farms) {
      if (!f.maintenanceMonths || f.maintenanceMonths <= 0) continue;
      const startAt = f.maintenanceStartAt || f.createdAt;
      if (!startAt) continue;
      const expiresAt = new Date(startAt);
      expiresAt.setMonth(expiresAt.getMonth() + f.maintenanceMonths);
      const daysLeft = Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 90) maintExpiringIds.add(f.farmId);
    }

    // 센서 이상: 최근 1시간 SENSOR_THRESHOLD 알림이 있는 고유 농장 수 (soft-delete 제외)
    const sensorAlertResult = await pool.query(
      `SELECT DISTINCT farm_id FROM alerts
       WHERE alert_type = 'SENSOR_THRESHOLD'
         AND timestamp > NOW() - INTERVAL '1 hour'
         AND acknowledged = FALSE
         AND (metadata->>'deleted' IS NULL OR metadata->>'deleted' != 'true')`
    );
    const sensorAlertIds = new Set(sensorAlertResult.rows.map(r => r.farm_id));

    // 최근 전체 미확인 알림 수 (soft-delete 제외)
    const recentResult = await pool.query(
      `SELECT COUNT(*)::int as count FROM alerts
       WHERE timestamp > NOW() - INTERVAL '24 hours'
         AND acknowledged = FALSE
         AND (metadata->>'deleted' IS NULL OR metadata->>'deleted' != 'true')`
    );
    const recentAlerts = recentResult.rows[0]?.count || 0;

    const total = farms.length;
    const offline = offlineIds.size;
    const sensorAlert = sensorAlertIds.size;
    const maintenanceExpiring = maintExpiringIds.size;
    // 겹치는 농장 제거하여 정상 수 계산
    const problemIds = new Set([...offlineIds, ...sensorAlertIds, ...maintExpiringIds]);
    const normal = total - problemIds.size;

    // 센서 이상 농장 ID 목록도 반환 (프론트 필터용)
    res.json({
      success: true,
      data: {
        total, offline, sensorAlert, maintenanceExpiring, normal, recentAlerts,
        offlineFarmIds: [...offlineIds],
        sensorAlertFarmIds: [...sensorAlertIds],
        maintExpiringFarmIds: [...maintExpiringIds],
      },
    });
  } catch (error) {
    logger.error("alert-summary 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/farms/alerts/recent — 전체 농장 최근 알림 피드
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/alerts/recent", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const severity = req.query.severity; // "CRITICAL,WARNING" 형태
    const acknowledged = req.query.acknowledged; // "true" | "false"

    let sql = `SELECT * FROM alerts WHERE 1=1`;
    const params = [];
    let idx = 1;

    // soft-delete 제외
    sql += ` AND (metadata->>'deleted' IS NULL OR metadata->>'deleted' != 'true')`;

    if (severity) {
      const levels = severity.split(",").map(s => s.trim().toUpperCase());
      sql += ` AND severity = ANY($${idx++}::text[])`;
      params.push(levels);
    }

    if (acknowledged === "true") {
      sql += ` AND acknowledged = TRUE`;
    } else if (acknowledged === "false") {
      sql += ` AND acknowledged = FALSE`;
    }

    sql += ` ORDER BY timestamp DESC LIMIT $${idx++}`;
    params.push(limit);

    const { rows } = await pool.query(sql, params);

    const data = rows.map(row => {
      const meta = row.metadata || {};
      return {
        _id: row.id,
        farmId: row.farm_id,
        houseId: row.house_id,
        sensorId: row.sensor_id,
        alertType: row.alert_type,
        severity: row.severity,
        message: row.message,
        value: row.value,
        threshold: row.threshold,
        metadata: meta,
        acknowledged: row.acknowledged,
        acknowledgedAt: row.acknowledged_at,
        acknowledgedBy: meta.acknowledgedBy || null,
        createdAt: row.timestamp,
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    logger.error("alerts/recent 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/farms/next-id — 다음 농장 ID 자동 생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/next-id", authorize("manager"), async (req, res) => {
  try {
    // farm_XXXX 패턴의 최대 번호 조회
    const farms = await prisma.farm.findMany({
      where: { farmId: { startsWith: "farm_" } },
      select: { farmId: true },
      orderBy: { farmId: "desc" },
    });

    let maxNum = 0;
    for (const f of farms) {
      const match = f.farmId.match(/^farm_(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }

    const nextId = `farm_${String(maxNum + 1).padStart(4, "0")}`;
    res.json({ success: true, data: { nextId } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/farms — 농장 목록
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/", async (req, res) => {
  try {
    const { search, status, page = 1, limit = 50, onlyDeleted, includeDeleted } = req.query;
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(parseInt(limit) || 50, 200);

    const where = {};
    // 휴지통 필터
    if (onlyDeleted === "true") { where.deletedAt = { not: null }; }
    else if (includeDeleted !== "true") { where.deletedAt = null; }
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { farmId: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
        { ownerName: { contains: search, mode: "insensitive" } },
      ];
    }

    // 시스템 전역 역할이 아닌 경우: 할당된 농장만
    if (!SYSTEM_WIDE_ROLES.includes(req.user.role)) {
      const userFarms = await prisma.userFarm.findMany({
        where: { userId: req.user.id },
        select: { farm: { select: { id: true } } },
      });
      where.id = { in: userFarms.map((uf) => uf.farm.id) };
    }

    const [farms, total] = await Promise.all([
      prisma.farm.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: { _count: { select: { userFarms: true } }, businessProject: true },
      }),
      prisma.farm.count({ where }),
    ]);

    // HouseConfig 카운트: N+1 쿼리 방지 — 단일 groupBy 쿼리로 조회
    const farmIds = farms.map(f => f.farmId);
    const houseCounts = await prisma.houseConfig.groupBy({
      by: ["farmId"],
      where: { farmId: { in: farmIds } },
      _count: { id: true },
    });
    const houseCountMap = Object.fromEntries(houseCounts.map(h => [h.farmId, h._count.id]));

    const farmData = farms.map((f) => {
      // 유지보수 만료일 계산 (0이면 유지보수 없음)
      const mMonths = f.maintenanceMonths ?? 0;
      let expiresAt = null;
      let daysLeft = null;
      if (mMonths > 0) {
        const mStartAt = new Date(f.maintenanceStartAt || f.createdAt);
        // setMonth 월말 오버플로우 방지: 원래 일자를 보존
        const origDay = mStartAt.getDate();
        expiresAt = new Date(mStartAt);
        expiresAt.setMonth(expiresAt.getMonth() + mMonths);
        // 월말 오버플로우 시 (예: 1/31 + 1개월 → 3/3) 해당 월의 마지막 날로 보정
        if (expiresAt.getDate() !== origDay) {
          expiresAt.setDate(0); // 이전 월의 마지막 날
        }
        daysLeft = Math.ceil((expiresAt - new Date()) / (1000 * 60 * 60 * 24));
      }

      return {
        id: f.id, farmId: f.farmId, name: f.name, location: f.location,
        ownerName: f.ownerName, ownerPhone: f.ownerPhone,
        managers: f.managers || [],
        tags: f.tags || [],
        systemType: f.systemType || null,
        farmType: f.farmType || null,
        farmArea: f.farmArea || null,
        registeredAt: f.registeredAt, maintenanceMonths: mMonths,
        maintenanceStartAt: f.maintenanceStartAt, maintenanceExpiresAt: expiresAt, maintenanceDaysLeft: daysLeft,
        status: f.status, deletedAt: f.deletedAt || null,
        businessProjectId: f.businessProjectId || null,
        businessProject: f.businessProject || null,
        businessType: f.businessType || null,
        totalCost: f.totalCost != null ? Number(f.totalCost) : null,
        subsidyAmount: f.subsidyAmount != null ? Number(f.subsidyAmount) : null,
        selfFunding: f.selfFunding != null ? Number(f.selfFunding) : null,
        apiKey: f.apiKey, lastSeenAt: f.lastSeenAt, memo: f.memo, createdAt: f.createdAt,
        houseCount: houseCountMap[f.farmId] || 0, userCount: f._count.userFarms,
      };
    });

    res.json({
      success: true,
      data: farmData,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 농장 관리자 권한 체크 헬퍼
// system admin 또는 해당 농장의 admin 역할 사용자
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function isFarmAdmin(userId, userRole, farmId) {
  // superadmin/manager는 모든 농장 관리 가능
  if (["superadmin", "manager"].includes(userRole)) return true;
  const uf = await prisma.userFarm.findFirst({
    where: { userId, farmId, role: "admin" },
  });
  return !!uf;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUT /api/farms/batch-status — 일괄 상태 변경
// (PUT /:farmId 보다 먼저 등록해야 라우트 충돌 방지)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.put("/batch-status", authorize("manager"), async (req, res) => {
  try {
    const { farmIds, status } = req.body;
    if (!Array.isArray(farmIds) || !status) return res.status(400).json({ success: false, error: "farmIds, status 필수" });

    const result = await prisma.farm.updateMany({
      where: { farmId: { in: farmIds } },
      data: { status },
    });

    await audit(req, "batch_status", "farm", null, { farmIds, status, count: result.count });
    logger.info(`일괄 상태 변경: ${farmIds.length}개 → ${status}`);
    res.json({ success: true, data: { count: result.count } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/farms — 농장 등록
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post("/", authorize("manager"), async (req, res) => {
  try {
    const { farmId, name, location, ownerName, ownerPhone, managers, systemType, farmType, farmArea, registeredAt, maintenanceMonths, maintenanceStartAt, memo, tags, representativeUserId, businessProjectId, businessType, totalCost, subsidyAmount, selfFunding } = req.body;
    if (!farmId || !name) return res.status(400).json({ success: false, error: "farmId, name 필수" });

    // 비용 필드 검증 (음수 방지 + 보조금 <= 총사업비)
    if (totalCost != null && totalCost !== '' && Number(totalCost) < 0) return res.status(400).json({ success: false, error: "총사업비는 0 이상이어야 합니다" });
    if (subsidyAmount != null && subsidyAmount !== '' && Number(subsidyAmount) < 0) return res.status(400).json({ success: false, error: "보조금은 0 이상이어야 합니다" });
    if (selfFunding != null && selfFunding !== '' && Number(selfFunding) < 0) return res.status(400).json({ success: false, error: "자부담은 0 이상이어야 합니다" });
    // 보조사업 금액 정합성 검증 (총사업비 = 보조금 + 자부담)
    if (businessType === 'subsidy') {
      const t = Number(totalCost) || 0, s = Number(subsidyAmount) || 0, f = Number(selfFunding) || 0;
      if (t > 0 && s + f > 0 && t !== s + f) return res.status(400).json({ success: false, error: `총사업비(${t.toLocaleString()}원) ≠ 보조금(${s.toLocaleString()}원) + 자부담(${f.toLocaleString()}원)` });
      if (s > t) return res.status(400).json({ success: false, error: "보조금이 총사업비를 초과할 수 없습니다" });
      if (f > t) return res.status(400).json({ success: false, error: "자부담이 총사업비를 초과할 수 없습니다" });
    }

    // managers에서 첫 번째 관리자를 ownerName/ownerPhone에도 저장 (호환성)
    const mgrs = Array.isArray(managers) ? managers : [];
    const primaryOwner = mgrs[0] || {};

    const apiKey = crypto.randomBytes(32).toString("hex");
    const farm = await prisma.farm.create({
      data: {
        farmId, name, location, memo, apiKey,
        systemType: systemType || null,
        farmType: farmType || null,
        farmArea: farmArea || null,
        managers: mgrs,
        tags: Array.isArray(tags) ? tags : [],
        ownerName: ownerName || primaryOwner.name || null,
        ownerPhone: ownerPhone || primaryOwner.phone || null,
        registeredAt: registeredAt ? new Date(registeredAt) : new Date(),
        maintenanceMonths: parseInt(maintenanceMonths) || 12,
        maintenanceStartAt: maintenanceStartAt ? new Date(maintenanceStartAt) : new Date(),
        businessProjectId: businessProjectId || null,
        businessType: businessType || null,
        totalCost: totalCost != null && totalCost !== '' ? BigInt(totalCost) : null,
        subsidyAmount: subsidyAmount != null && subsidyAmount !== '' ? BigInt(subsidyAmount) : null,
        selfFunding: selfFunding != null && selfFunding !== '' ? BigInt(selfFunding) : null,
      },
    });

    // 대표자 시스템 계정 자동 할당
    if (representativeUserId) {
      try {
        await prisma.userFarm.create({
          data: { userId: representativeUserId, farmId: farm.id, role: "admin" },
        });
        logger.info(`대표자 자동 할당: ${representativeUserId} → ${farmId}`);
      } catch (e) {
        // 이미 할당된 경우 무시
        if (e.code !== "P2002") logger.warn(`대표자 할당 실패: ${e.message}`);
      }
    }

    logger.info(`농장 등록: ${farmId} (${name})`);
    await audit(req, "create", "farm", farmId, { name });
    res.status(201).json({ success: true, data: toBigIntSafe({ ...farm, apiKey }) });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ success: false, error: "이미 존재하는 농장 ID입니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/farms/trash/count — 휴지통 카운트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/trash/count", authorize("manager"), async (req, res) => {
  try {
    const count = await prisma.farm.count({ where: { deletedAt: { not: null } } });
    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/farms/schedules/summary — 전체 농장 일정 요약 (오늘/이번주)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/schedules/summary", authorize("manager"), async (req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    // 향후 일주일 (오늘 제외, 내일~7일 후)
    const weekEnd = new Date(todayStart);
    weekEnd.setDate(weekEnd.getDate() + 8);

    // 향후 1개월 (일주일 이후 ~ 30일 후)
    const monthEnd = new Date(todayStart);
    monthEnd.setDate(monthEnd.getDate() + 31);

    // 활성 농장만
    const activeFarms = await prisma.farm.findMany({
      where: { deletedAt: null },
      select: { id: true, farmId: true, name: true },
    });
    const farmIds = activeFarms.map(f => f.id);
    const farmMap = Object.fromEntries(activeFarms.map(f => [f.id, f]));

    // 오늘 일정
    const todaySchedules = await prisma.farmSchedule.findMany({
      where: { farmId: { in: farmIds }, startDate: { gte: todayStart, lt: todayEnd } },
      orderBy: { startDate: "asc" },
    });

    // 일주일 이내 일정 (오늘 제외)
    const weekSchedules = await prisma.farmSchedule.findMany({
      where: {
        farmId: { in: farmIds },
        startDate: { gte: todayEnd, lt: weekEnd },
      },
      orderBy: { startDate: "asc" },
    });

    // 1개월 이내 일정 (오늘 제외, 일주일 포함 누적)
    const monthSchedules = await prisma.farmSchedule.findMany({
      where: {
        farmId: { in: farmIds },
        startDate: { gte: todayEnd, lt: monthEnd },
      },
      orderBy: { startDate: "asc" },
    });

    // 지연 일정 (오늘 이전 + 미완료)
    const overdueSchedules = await prisma.farmSchedule.findMany({
      where: {
        farmId: { in: farmIds },
        startDate: { lt: todayStart },
        completed: false,
      },
      orderBy: { startDate: "asc" },
    });

    const enrich = (s) => ({
      ...s,
      farmName: farmMap[s.farmId]?.name || "",
      farmCode: farmMap[s.farmId]?.farmId || "",
    });

    res.json({
      success: true,
      data: {
        todayCount: todaySchedules.length,
        weekCount: weekSchedules.length,
        monthCount: monthSchedules.length,
        overdueCount: overdueSchedules.length,
        todaySchedules: todaySchedules.map(enrich),
        weekSchedules: weekSchedules.map(enrich),
        monthSchedules: monthSchedules.map(enrich),
        overdueSchedules: overdueSchedules.map(enrich),
      },
    });
  } catch (error) {
    logger.error("일정 요약 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/farms/tags/all — 전체 태그 목록 (distinct)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/tags/all", async (req, res) => {
  try {
    const farms = await prisma.farm.findMany({ select: { tags: true } });
    const allTags = [...new Set(farms.flatMap(f => f.tags || []))].sort();
    res.json({ success: true, data: allTags });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/farms/:farmId — 농장 상세
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/:farmId", async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({
      where: { farmId: req.params.farmId },
      include: {
        userFarms: { include: { user: { select: { id: true, username: true, name: true, role: true } } } },
      },
    });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });

    // HouseConfig 별도 조회 (FK 관계 없음)
    const houses = await prisma.houseConfig.findMany({
      where: { farmId: farm.farmId },
      select: { id: true, houseId: true, houseName: true, enabled: true, sensors: true, devices: true },
    });

    const { userFarms: uf, ...farmRest } = farm;
    res.json({ success: true, data: toBigIntSafe({ ...farmRest, users: uf, houses }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUT /api/farms/:farmId — 농장 수정
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.put("/:farmId", authorize("manager"), async (req, res) => {
  try {
    const { name, location, ownerName, ownerPhone, managers, systemType, farmType, farmArea, registeredAt, maintenanceMonths, maintenanceStartAt, status, memo, tags, businessProjectId, businessType, totalCost, subsidyAmount, selfFunding } = req.body;

    // 비용 필드 검증 (음수 방지)
    if (totalCost !== undefined && totalCost != null && totalCost !== '' && Number(totalCost) < 0) return res.status(400).json({ success: false, error: "총사업비는 0 이상이어야 합니다" });
    if (subsidyAmount !== undefined && subsidyAmount != null && subsidyAmount !== '' && Number(subsidyAmount) < 0) return res.status(400).json({ success: false, error: "보조금은 0 이상이어야 합니다" });
    if (selfFunding !== undefined && selfFunding != null && selfFunding !== '' && Number(selfFunding) < 0) return res.status(400).json({ success: false, error: "자부담은 0 이상이어야 합니다" });
    // 보조사업 금액 정합성 검증
    if (businessType === 'subsidy' || (businessType === undefined && totalCost !== undefined)) {
      const t = Number(totalCost) || 0, s = Number(subsidyAmount) || 0, f = Number(selfFunding) || 0;
      if (t > 0 && s + f > 0 && t !== s + f) return res.status(400).json({ success: false, error: `총사업비(${t.toLocaleString()}원) ≠ 보조금(${s.toLocaleString()}원) + 자부담(${f.toLocaleString()}원)` });
      if (s > t) return res.status(400).json({ success: false, error: "보조금이 총사업비를 초과할 수 없습니다" });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (location !== undefined) updateData.location = location;
    if (status !== undefined) updateData.status = status;
    if (memo !== undefined) updateData.memo = memo;
    if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : [];
    if (systemType !== undefined) updateData.systemType = systemType || null;
    if (farmType !== undefined) updateData.farmType = farmType || null;
    if (farmArea !== undefined) updateData.farmArea = farmArea || null;
    if (registeredAt !== undefined) updateData.registeredAt = registeredAt ? new Date(registeredAt) : null;
    if (maintenanceMonths !== undefined) updateData.maintenanceMonths = parseInt(maintenanceMonths) || 12;
    if (maintenanceStartAt !== undefined) updateData.maintenanceStartAt = maintenanceStartAt ? new Date(maintenanceStartAt) : null;
    if (businessProjectId !== undefined) updateData.businessProjectId = businessProjectId || null;
    if (businessType !== undefined) updateData.businessType = businessType || null;
    if (totalCost !== undefined) updateData.totalCost = totalCost != null && totalCost !== '' ? BigInt(totalCost) : null;
    if (subsidyAmount !== undefined) updateData.subsidyAmount = subsidyAmount != null && subsidyAmount !== '' ? BigInt(subsidyAmount) : null;
    if (selfFunding !== undefined) updateData.selfFunding = selfFunding != null && selfFunding !== '' ? BigInt(selfFunding) : null;
    if (managers !== undefined) {
      updateData.managers = Array.isArray(managers) ? managers : [];
      // 첫 번째 관리자를 ownerName/ownerPhone에 동기화
      const primary = updateData.managers[0] || {};
      updateData.ownerName = primary.name || null;
      updateData.ownerPhone = primary.phone || null;
    } else {
      if (ownerName !== undefined) updateData.ownerName = ownerName;
      if (ownerPhone !== undefined) updateData.ownerPhone = ownerPhone;
    }

    // 변경 전 데이터 조회 (before/after 비교용)
    const before = await prisma.farm.findUnique({ where: { farmId: req.params.farmId } });
    const farm = await prisma.farm.update({ where: { farmId: req.params.farmId }, data: updateData });
    // 변경된 필드의 before/after 값 저장
    const changes = {};
    for (const key of Object.keys(updateData)) {
      const oldVal = before[key];
      const newVal = farm[key];
      const oldStr = oldVal instanceof Date ? oldVal.toISOString() : typeof oldVal === 'bigint' ? oldVal.toString() : JSON.stringify(oldVal);
      const newStr = newVal instanceof Date ? newVal.toISOString() : typeof newVal === 'bigint' ? newVal.toString() : JSON.stringify(newVal);
      if (oldStr !== newStr) changes[key] = { before: oldVal instanceof Date ? oldVal.toISOString() : typeof oldVal === 'bigint' ? oldVal.toString() : oldVal, after: newVal instanceof Date ? newVal.toISOString() : typeof newVal === 'bigint' ? newVal.toString() : newVal };
    }
    await audit(req, "update", "farm", req.params.farmId, { fields: Object.keys(updateData), changes });
    res.json({ success: true, data: toBigIntSafe(farm) });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE /api/farms/:farmId — 농장 삭제 (휴지통 이동)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete("/:farmId", authorize("manager"), async (req, res) => {
  try {
    await prisma.farm.update({
      where: { farmId: req.params.farmId },
      data: { deletedAt: new Date(), status: "deleted" },
    });
    logger.info(`농장 휴지통 이동: ${req.params.farmId}`);
    await audit(req, "soft_delete", "farm", req.params.farmId);
    res.json({ success: true });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/farms/:farmId/restore — 농장 복원
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post("/:farmId/restore", authorize("manager"), async (req, res) => {
  try {
    const farm = await prisma.farm.update({
      where: { farmId: req.params.farmId },
      data: { deletedAt: null, status: "active" },
    });
    logger.info(`농장 복원: ${req.params.farmId}`);
    await audit(req, "restore", "farm", req.params.farmId);
    res.json({ success: true, data: farm });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DELETE /api/farms/:farmId/permanent — 영구 삭제
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.delete("/:farmId/permanent", authorize("manager"), async (req, res) => {
  try {
    await prisma.farm.delete({ where: { farmId: req.params.farmId } });
    logger.info(`농장 영구 삭제: ${req.params.farmId}`);
    await audit(req, "permanent_delete", "farm", req.params.farmId);
    res.json({ success: true });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/farms/:farmId/regenerate-key — API 키 재생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post("/:farmId/regenerate-key", authorize("manager"), async (req, res) => {
  try {
    const newApiKey = crypto.randomBytes(32).toString("hex");
    const farm = await prisma.farm.update({
      where: { farmId: req.params.farmId },
      data: { apiKey: newApiKey },
    });
    logger.info(`API 키 재생성: ${req.params.farmId}`);
    res.json({ success: true, data: { farmId: farm.farmId, apiKey: newApiKey } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 사용자 할당 관리
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/farms/:farmId/users
router.get("/:farmId/users", async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });

    const userFarms = await prisma.userFarm.findMany({
      where: { farmId: farm.id },
      include: { user: { select: { id: true, username: true, name: true, role: true } } },
    });
    res.json({ success: true, data: userFarms });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/farms/:farmId/users — 사용자 할당 (시스템 admin 또는 농장 admin)
router.post("/:farmId/users", async (req, res) => {
  try {
    const { userId, role = "viewer" } = req.body;
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });

    // 권한 체크: 시스템 admin 또는 해당 농장 admin
    const allowed = await isFarmAdmin(req.user.id, req.user.role, farm.id);
    if (!allowed) return res.status(403).json({ success: false, error: "농장 관리 권한이 없습니다" });

    // role 기반 기본 권한 자동 설정
    const defaultPerms = {
      admin: { view: true, control: true, config: true, report: true, automation: true, journal: true },
      worker: { view: true, control: true, config: false, report: true, automation: false, journal: true },
      viewer: { view: true, control: false, config: false, report: true, automation: false, journal: false },
    };
    const userFarm = await prisma.userFarm.create({
      data: { userId, farmId: farm.id, role, permissions: defaultPerms[role] || defaultPerms.viewer },
    });
    res.status(201).json({ success: true, data: userFarm });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ success: false, error: "이미 할당된 사용자입니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/farms/:farmId/users/:userId — 사용자 해제 (시스템 admin 또는 농장 admin)
router.delete("/:farmId/users/:userId", async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });

    // 권한 체크
    const allowed = await isFarmAdmin(req.user.id, req.user.role, farm.id);
    if (!allowed) return res.status(403).json({ success: false, error: "농장 관리 권한이 없습니다" });

    await prisma.userFarm.delete({
      where: { userId_farmId: { userId: req.params.userId, farmId: farm.id } },
    });
    res.json({ success: true });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "할당 정보를 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/farms/batch — 엑셀 일괄 등록
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post("/batch", authorize("manager"), async (req, res) => {
  try {
    const { farms: farmsData } = req.body;
    if (!Array.isArray(farmsData) || farmsData.length === 0) return res.status(400).json({ success: false, error: "farms 배열 필수" });

    const results = { success: 0, failed: 0, errors: [] };

    for (const f of farmsData) {
      try {
        if (!f.farmId || !f.name) { results.failed++; results.errors.push(`${f.farmId || '?'}: farmId, name 필수`); continue; }
        const apiKey = crypto.randomBytes(32).toString("hex");
        await prisma.farm.create({
          data: {
            farmId: f.farmId, name: f.name, location: f.location || null,
            ownerName: f.ownerName || null, ownerPhone: f.ownerPhone || null,
            managers: f.managers || [],
            systemType: f.systemType || null, farmType: f.farmType || null,
            farmArea: f.farmArea || null, status: f.status || "active",
            apiKey, memo: f.memo || null,
            registeredAt: f.registeredAt ? new Date(f.registeredAt) : new Date(),
            maintenanceMonths: parseInt(f.maintenanceMonths) || 12,
            maintenanceStartAt: f.maintenanceStartAt ? new Date(f.maintenanceStartAt) : new Date(),
          },
        });
        results.success++;
      } catch (e) {
        results.failed++;
        results.errors.push(`${f.farmId || '?'}: ${e.code === "P2002" ? "이미 존재" : e.message}`);
      }
    }

    await audit(req, "batch_create", "farm", null, { total: farmsData.length, success: results.success, failed: results.failed });
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/farms/:farmId/stats — 농장 통계 (센서/알림/제어 현황)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/:farmId/stats", async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });

    const { pool } = await import("../db.js");

    // 알림 통계 (최근 30일)
    const alertStats = await pool.query(`
      SELECT severity, COUNT(*)::int as count
      FROM alerts WHERE farm_id = $1 AND timestamp > NOW() - INTERVAL '30 days'
      GROUP BY severity
    `, [req.params.farmId]);

    const unackAlerts = await pool.query(`
      SELECT COUNT(*)::int as count
      FROM alerts WHERE farm_id = $1 AND acknowledged = FALSE AND alert_type != 'NORMAL'
    `, [req.params.farmId]);

    // 최근 센서 데이터 (각 하우스별 마지막)
    const latestSensors = await pool.query(`
      SELECT DISTINCT ON (house_id) house_id, data, timestamp
      FROM sensor_data WHERE farm_id = $1
      ORDER BY house_id, timestamp DESC
    `, [req.params.farmId]);

    // 제어 이력 (최근 7일)
    const controlStats = await pool.query(`
      SELECT COUNT(*)::int as count, COUNT(*) FILTER (WHERE success = true)::int as success_count
      FROM control_logs WHERE farm_id = $1 AND timestamp > NOW() - INTERVAL '7 days'
    `, [req.params.farmId]);

    // 하우스 수
    const houseCount = await prisma.houseConfig.count({ where: { farmId: req.params.farmId } });

    // 자동화 규칙 수
    const automationCount = await prisma.automationRule.count({ where: { farmId: req.params.farmId, enabled: true } });

    res.json({
      success: true,
      data: {
        houseCount,
        automationCount,
        alerts: {
          total30d: alertStats.rows.reduce((s, r) => s + r.count, 0),
          bySeverity: Object.fromEntries(alertStats.rows.map(r => [r.severity, r.count])),
          unacknowledged: unackAlerts.rows[0]?.count || 0,
        },
        sensors: {
          houses: latestSensors.rows.map(r => ({
            houseId: r.house_id,
            data: r.data,
            lastUpdate: r.timestamp,
          })),
        },
        controls: {
          total7d: controlStats.rows[0]?.count || 0,
          success7d: controlStats.rows[0]?.success_count || 0,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 감사 로그
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/farms/:farmId/audit — 농장별 감사 로그
router.get("/:farmId/audit", async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const pageNum = Math.max(parseInt(page) || 1, 1);

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { farmId: req.params.farmId },
        orderBy: { createdAt: "desc" },
        take: limitNum,
        skip: (pageNum - 1) * limitNum,
      }),
      prisma.auditLog.count({ where: { farmId: req.params.farmId } }),
    ]);

    res.json({ success: true, data: logs, pagination: { total, page: pageNum, limit: limitNum } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/farms/audit/all — 전체 감사 로그
router.get("/audit/all", authorize("manager"), async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const pageNum = Math.max(parseInt(page) || 1, 1);

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: limitNum,
        skip: (pageNum - 1) * limitNum,
      }),
      prisma.auditLog.count(),
    ]);

    res.json({ success: true, data: logs, pagination: { total, page: pageNum, limit: limitNum } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 유지보수 이력 관리
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/farms/:farmId/maintenance — 유지보수 이력 목록
router.get("/:farmId/maintenance", async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });

    const { type } = req.query;
    const where = { farmId: farm.id };
    if (type) where.type = type;

    const logs = await prisma.maintenanceLog.findMany({
      where,
      orderBy: { date: "desc" },
    });

    const totalCost = logs.reduce((sum, l) => sum + (l.cost || 0), 0);

    res.json({ success: true, data: logs, summary: { totalCost, count: logs.length } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/farms/:farmId/maintenance — 유지보수 이력 추가
router.post("/:farmId/maintenance", authorize("manager"), async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });

    const { date, type, title, description, cost, technician, status } = req.body;
    if (!date || !type || !title) return res.status(400).json({ success: false, error: "date, type, title 필수" });

    const log = await prisma.maintenanceLog.create({
      data: {
        farmId: farm.id,
        date: new Date(date),
        type,
        title,
        description: description || null,
        cost: cost ? parseInt(cost) : null,
        technician: technician || null,
        status: status || "completed",
      },
    });

    logger.info(`유지보수 이력 추가: ${req.params.farmId} - ${title}`);
    res.status(201).json({ success: true, data: log });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/farms/:farmId/maintenance/:logId — 유지보수 이력 수정
router.put("/:farmId/maintenance/:logId", authorize("manager"), async (req, res) => {
  try {
    const { date, type, title, description, cost, technician, status } = req.body;
    const updateData = {};
    if (date !== undefined) updateData.date = new Date(date);
    if (type !== undefined) updateData.type = type;
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description || null;
    if (cost !== undefined) updateData.cost = cost ? parseInt(cost) : null;
    if (technician !== undefined) updateData.technician = technician || null;
    if (status !== undefined) updateData.status = status;

    const log = await prisma.maintenanceLog.update({
      where: { id: req.params.logId },
      data: updateData,
    });

    res.json({ success: true, data: log });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "이력을 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/farms/:farmId/maintenance/:logId — 유지보수 이력 삭제
router.delete("/:farmId/maintenance/:logId", authorize("manager"), async (req, res) => {
  try {
    await prisma.maintenanceLog.delete({ where: { id: req.params.logId } });
    logger.info(`유지보수 이력 삭제: ${req.params.farmId} - ${req.params.logId}`);
    res.json({ success: true });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "이력을 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 접속 이력 (센서 데이터 기반)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/farms/:farmId/connection-history — 최근 N일간 접속(센서수집) 이력
router.get("/:farmId/connection-history", async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const daysNum = Math.min(parseInt(days) || 7, 30);
    const { pool } = await import("../db.js");

    // 일별 센서 데이터 카운트 + 하우스별 카운트
    const daily = await pool.query(`
      SELECT
        DATE(timestamp) as date,
        COUNT(*)::int as count,
        COUNT(DISTINCT house_id)::int as house_count,
        MIN(timestamp) as first_seen,
        MAX(timestamp) as last_seen
      FROM sensor_data
      WHERE farm_id = $1 AND timestamp > NOW() - INTERVAL '${daysNum} days'
      GROUP BY DATE(timestamp)
      ORDER BY date
    `, [req.params.farmId]);

    // 시간대별 분포 (최근 24시간)
    const hourly = await pool.query(`
      SELECT
        EXTRACT(HOUR FROM timestamp)::int as hour,
        COUNT(*)::int as count
      FROM sensor_data
      WHERE farm_id = $1 AND timestamp > NOW() - INTERVAL '24 hours'
      GROUP BY EXTRACT(HOUR FROM timestamp)
      ORDER BY hour
    `, [req.params.farmId]);

    res.json({
      success: true,
      data: {
        daily: daily.rows.map(r => ({
          date: r.date,
          count: r.count,
          houseCount: r.house_count,
          firstSeen: r.first_seen,
          lastSeen: r.last_seen,
        })),
        hourly: hourly.rows.map(r => ({
          hour: r.hour,
          count: r.count,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 사용자 권한/역할 관리
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// PUT /api/farms/:farmId/users/:userId/role
router.put("/:farmId/users/:userId/role", async (req, res) => {
  try {
    const { role } = req.body;
    if (!role) return res.status(400).json({ success: false, error: "role 필수" });
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    const allowed = await isFarmAdmin(req.user.id, req.user.role, farm.id);
    if (!allowed) return res.status(403).json({ success: false, error: "농장 관리 권한이 없습니다" });
    const updated = await prisma.userFarm.update({
      where: { userId_farmId: { userId: req.params.userId, farmId: farm.id } },
      data: { role },
    });
    await audit(req, "update_role", "user_farm", req.params.userId, { farmId: req.params.farmId, role });
    res.json({ success: true, data: updated });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "할당 정보를 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/farms/:farmId/users/:userId/permissions
router.put("/:farmId/users/:userId/permissions", async (req, res) => {
  try {
    const { permissions } = req.body;
    if (!permissions || typeof permissions !== "object") return res.status(400).json({ success: false, error: "permissions 객체 필수" });
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    const allowed = await isFarmAdmin(req.user.id, req.user.role, farm.id);
    if (!allowed) return res.status(403).json({ success: false, error: "농장 관리 권한이 없습니다" });
    const updated = await prisma.userFarm.update({
      where: { userId_farmId: { userId: req.params.userId, farmId: farm.id } },
      data: { permissions },
    });
    await audit(req, "update_permissions", "user_farm", req.params.userId, { farmId: req.params.farmId, permissions });
    res.json({ success: true, data: updated });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "할당 정보를 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 농장 일정 CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/farms/:farmId/schedules
router.get("/:farmId/schedules", async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId }, select: { id: true } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    const { from, to, type, completed, houseId } = req.query;
    const where = { farmId: farm.id };
    if (type) where.type = type;
    if (completed !== undefined) where.completed = completed === "true";
    if (houseId) where.houseId = houseId;
    if (from || to) {
      where.startDate = {};
      if (from) where.startDate.gte = new Date(from);
      if (to) where.startDate.lte = new Date(to);
    }
    const schedules = await prisma.farmSchedule.findMany({
      where, orderBy: [{ completed: "asc" }, { startDate: "asc" }],
    });
    const total = schedules.length;
    const completedCount = schedules.filter(s => s.completed).length;
    const now = new Date(); now.setHours(0,0,0,0);
    const upcoming = schedules.filter(s => !s.completed && new Date(s.startDate) >= now).length;
    const overdue = schedules.filter(s => !s.completed && new Date(s.startDate) < now).length;
    res.json({ success: true, data: schedules, summary: { total, completed: completedCount, upcoming, overdue } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/farms/:farmId/schedules
router.post("/:farmId/schedules", authorize("manager"), async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId }, select: { id: true } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    const { title, description, type, startDate, endDate, allDay, assignedTo, houseId, priority, color } = req.body;
    if (!title || !startDate) return res.status(400).json({ success: false, error: "title, startDate 필수" });
    const schedule = await prisma.farmSchedule.create({
      data: {
        farmId: farm.id, title, description: description || null,
        type: type || "general", startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null, allDay: allDay !== false,
        assignedTo: assignedTo || null, houseId: houseId || null,
        priority: priority || "normal", color: color || null,
        createdBy: req.user?.name || null,
      },
    });
    res.status(201).json({ success: true, data: schedule });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/farms/:farmId/schedules/:scheduleId
router.put("/:farmId/schedules/:scheduleId", authorize("manager"), async (req, res) => {
  try {
    const { title, description, type, startDate, endDate, allDay, assignedTo, houseId, priority, color } = req.body;
    const d = {};
    if (title !== undefined) d.title = title;
    if (description !== undefined) d.description = description || null;
    if (type !== undefined) d.type = type;
    if (startDate !== undefined) d.startDate = new Date(startDate);
    if (endDate !== undefined) d.endDate = endDate ? new Date(endDate) : null;
    if (allDay !== undefined) d.allDay = allDay;
    if (assignedTo !== undefined) d.assignedTo = assignedTo || null;
    if (houseId !== undefined) d.houseId = houseId || null;
    if (priority !== undefined) d.priority = priority;
    if (color !== undefined) d.color = color || null;
    const schedule = await prisma.farmSchedule.update({ where: { id: req.params.scheduleId }, data: d });
    res.json({ success: true, data: schedule });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "일정을 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/farms/:farmId/schedules/:scheduleId/toggle
router.patch("/:farmId/schedules/:scheduleId/toggle", async (req, res) => {
  try {
    const schedule = await prisma.farmSchedule.findUnique({ where: { id: req.params.scheduleId } });
    if (!schedule) return res.status(404).json({ success: false, error: "일정을 찾을 수 없습니다" });
    const updated = await prisma.farmSchedule.update({
      where: { id: req.params.scheduleId },
      data: { completed: !schedule.completed, completedAt: !schedule.completed ? new Date() : null },
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/farms/:farmId/schedules/:scheduleId
router.delete("/:farmId/schedules/:scheduleId", authorize("manager"), async (req, res) => {
  try {
    await prisma.farmSchedule.delete({ where: { id: req.params.scheduleId } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "일정을 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 농장 문서/첨부파일 관리
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/farms/:farmId/documents
router.get("/:farmId/documents", async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId }, select: { id: true } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    const { category } = req.query;
    const where = { farmId: farm.id };
    if (category) where.category = category;
    const documents = await prisma.farmDocument.findMany({ where, orderBy: { createdAt: "desc" } });
    const stats = {};
    documents.forEach(d => { stats[d.category] = (stats[d.category] || 0) + 1; });
    const totalSize = documents.reduce((sum, d) => sum + (d.fileSize || 0), 0);
    res.json({ success: true, data: documents, summary: { total: documents.length, totalSize, byCategory: stats } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/farms/:farmId/documents — 파일 업로드
router.post("/:farmId/documents", authorize("manager"), docUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "파일이 없습니다" });
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId }, select: { id: true } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    const { category = "other", description } = req.body;
    const doc = await prisma.farmDocument.create({
      data: {
        farmId: farm.id, fileName: req.file.filename,
        originalName: req.file.originalname, filePath: req.file.path.replace(/\\/g, "/"),
        fileSize: req.file.size, mimeType: req.file.mimetype,
        category, description: description || null,
        uploadedBy: req.user?.name || null, uploaderId: req.user?.id || null,
      },
    });
    logger.info(`문서 업로드: ${req.params.farmId} - ${req.file.originalname}`);
    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/farms/:farmId/documents/:docId/download
router.get("/:farmId/documents/:docId/download", async (req, res) => {
  try {
    const doc = await prisma.farmDocument.findUnique({ where: { id: req.params.docId } });
    if (!doc) return res.status(404).json({ success: false, error: "문서를 찾을 수 없습니다" });
    const filePath = path.resolve(doc.filePath);
    // 경로 탈출(path traversal) 공격 방지
    const baseDir = path.resolve(DOC_UPLOAD_DIR);
    if (!filePath.startsWith(baseDir)) return res.status(403).json({ success: false, error: "허용되지 않는 파일 경로입니다" });
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: "파일이 존재하지 않습니다" });
    res.download(filePath, doc.originalName);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/farms/:farmId/documents/:docId
router.delete("/:farmId/documents/:docId", authorize("manager"), async (req, res) => {
  try {
    const doc = await prisma.farmDocument.findUnique({ where: { id: req.params.docId } });
    if (!doc) return res.status(404).json({ success: false, error: "문서를 찾을 수 없습니다" });
    try {
      const filePath = path.resolve(doc.filePath);
      const baseDir = path.resolve(DOC_UPLOAD_DIR);
      if (filePath.startsWith(baseDir) && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) { logger.warn(`파일 삭제 실패: ${e.message}`); }
    await prisma.farmDocument.delete({ where: { id: req.params.docId } });
    logger.info(`문서 삭제: ${req.params.farmId} - ${doc.originalName}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 농장 설정 백업/복원
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/farms/:farmId/backup
router.get("/:farmId/backup", authorize("manager"), async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    const houses = await prisma.houseConfig.findMany({ where: { farmId: farm.farmId } });
    const automationRules = await prisma.automationRule.findMany({ where: { farmId: farm.farmId } });
    const backup = {
      _meta: { version: "1.0", farmId: farm.farmId, farmName: farm.name, exportedAt: new Date().toISOString(), exportedBy: req.user?.name || "system" },
      farm: { name: farm.name, location: farm.location, systemType: farm.systemType, farmType: farm.farmType, farmArea: farm.farmArea, managers: farm.managers, tags: farm.tags, maintenanceMonths: farm.maintenanceMonths },
      houses: houses.map(h => ({ houseId: h.houseId, houseName: h.houseName, sensors: h.sensors, collection: h.collection, crops: h.crops, cropType: h.cropType, cropVariety: h.cropVariety, plantingDate: h.plantingDate, devices: h.devices, deviceCount: h.deviceCount, enabled: h.enabled })),
      automationRules: automationRules.map(r => ({ name: r.name, houseId: r.houseId, description: r.description, enabled: r.enabled, conditionLogic: r.conditionLogic, groupLogic: r.groupLogic, conditions: r.conditions, actions: r.actions, cooldownSeconds: r.cooldownSeconds, priority: r.priority })),
    };
    await audit(req, "backup", "farm", req.params.farmId);
    const filename = `backup_${farm.farmId}_${new Date().toISOString().split("T")[0]}.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(backup);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/farms/:farmId/restore
router.post("/:farmId/restore-config", authorize("manager"), async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    const backup = req.body;
    if (!backup?._meta?.version) return res.status(400).json({ success: false, error: "유효한 백업 파일이 아닙니다" });
    const results = { farm: false, houses: 0, automationRules: 0, errors: [] };
    // 1. 농장 기본 정보 복원
    if (backup.farm) {
      try {
        await prisma.farm.update({
          where: { farmId: req.params.farmId },
          data: { name: backup.farm.name || farm.name, location: backup.farm.location ?? farm.location, systemType: backup.farm.systemType ?? farm.systemType, farmType: backup.farm.farmType ?? farm.farmType, farmArea: backup.farm.farmArea ?? farm.farmArea, managers: backup.farm.managers ?? farm.managers, tags: backup.farm.tags ?? farm.tags, maintenanceMonths: backup.farm.maintenanceMonths ?? farm.maintenanceMonths },
        });
        results.farm = true;
      } catch (e) { results.errors.push(`농장 정보 복원 실패: ${e.message}`); }
    }
    // 2. 하우스 설정 복원 (upsert)
    if (Array.isArray(backup.houses)) {
      for (const h of backup.houses) {
        try {
          await prisma.houseConfig.upsert({
            where: { farmId_houseId: { farmId: farm.farmId, houseId: h.houseId } },
            update: { houseName: h.houseName || "", sensors: h.sensors || [], collection: h.collection || {}, crops: h.crops || [], cropType: h.cropType || "", cropVariety: h.cropVariety || "", plantingDate: h.plantingDate || "", devices: h.devices || [], deviceCount: h.deviceCount || 0, enabled: h.enabled !== false },
            create: { farmId: farm.farmId, houseId: h.houseId, houseName: h.houseName || "", sensors: h.sensors || [], collection: h.collection || {}, crops: h.crops || [], cropType: h.cropType || "", cropVariety: h.cropVariety || "", plantingDate: h.plantingDate || "", devices: h.devices || [], deviceCount: h.deviceCount || 0, enabled: h.enabled !== false },
          });
          results.houses++;
        } catch (e) { results.errors.push(`하우스 ${h.houseId} 복원 실패: ${e.message}`); }
      }
    }
    // 3. 자동화 규칙 복원
    if (Array.isArray(backup.automationRules) && backup.automationRules.length > 0) {
      const { clearExisting } = req.query;
      if (clearExisting === "true") {
        await prisma.automationRule.deleteMany({ where: { farmId: farm.farmId } });
      }
      for (const rule of backup.automationRules) {
        try {
          await prisma.automationRule.create({
            data: { farmId: farm.farmId, houseId: rule.houseId, name: rule.name, description: rule.description || "", enabled: rule.enabled !== false, conditionLogic: rule.conditionLogic || "AND", groupLogic: rule.groupLogic || "AND", conditions: rule.conditions || [], actions: rule.actions || [], cooldownSeconds: rule.cooldownSeconds || 300, priority: rule.priority || 10 },
          });
          results.automationRules++;
        } catch (e) { results.errors.push(`자동화 규칙 복원 실패: ${e.message}`); }
      }
    }
    await audit(req, "restore_config", "farm", req.params.farmId, { source: backup._meta, results });
    logger.info(`농장 설정 복원: ${req.params.farmId} (하우스 ${results.houses}, 규칙 ${results.automationRules})`);
    res.json({ success: true, data: results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 농장 메모(노트) CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/farms/:farmId/notes
router.get("/:farmId/notes", async (req, res) => {
  try {
    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId }, select: { id: true } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });

    const notes = await prisma.farmNote.findMany({
      where: { farmId: farm.id },
      orderBy: { createdAt: "desc" },
    });
    res.json({ success: true, data: notes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/farms/:farmId/notes
router.post("/:farmId/notes", async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, error: "내용을 입력하세요" });

    const farm = await prisma.farm.findUnique({ where: { farmId: req.params.farmId }, select: { id: true } });
    if (!farm) return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });

    const note = await prisma.farmNote.create({
      data: {
        farmId: farm.id,
        content: content.trim(),
        author: req.user?.name || null,
        authorId: req.user?.id || null,
      },
    });
    res.status(201).json({ success: true, data: note });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/farms/:farmId/notes/:noteId
router.put("/:farmId/notes/:noteId", async (req, res) => {
  try {
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, error: "내용을 입력하세요" });

    // 작성자 또는 admin만 수정 가능
    const existing = await prisma.farmNote.findUnique({ where: { id: req.params.noteId } });
    if (!existing) return res.status(404).json({ success: false, error: "메모를 찾을 수 없습니다" });
    if (existing.authorId !== req.user?.id && !SYSTEM_WIDE_ROLES.includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: "본인이 작성한 메모만 수정할 수 있습니다" });
    }

    const note = await prisma.farmNote.update({
      where: { id: req.params.noteId },
      data: { content: content.trim() },
    });
    res.json({ success: true, data: note });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "메모를 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/farms/:farmId/notes/:noteId
router.delete("/:farmId/notes/:noteId", async (req, res) => {
  try {
    // 작성자 또는 admin만 삭제 가능
    const existing = await prisma.farmNote.findUnique({ where: { id: req.params.noteId } });
    if (!existing) return res.status(404).json({ success: false, error: "메모를 찾을 수 없습니다" });
    if (existing.authorId !== req.user?.id && !SYSTEM_WIDE_ROLES.includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: "본인이 작성한 메모만 삭제할 수 있습니다" });
    }

    await prisma.farmNote.delete({ where: { id: req.params.noteId } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ success: false, error: "메모를 찾을 수 없습니다" });
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
