// src/routes/journal.routes.js
// 영농일지 + 수확 기록 + 투입물 기록 API
// 사진 업로드 포함

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.middleware.js";
import logger from "../utils/logger.js";

const router = express.Router();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 사진 업로드 설정 (multer)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads/journal";

// 디렉토리 생성
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// farmId 경로 탐색 방지
function sanitizeFarmId(farmId) {
  return (farmId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const farmDir = path.join(UPLOAD_DIR, sanitizeFarmId(req.params.farmId));
    if (!fs.existsSync(farmDir)) {
      fs.mkdirSync(farmDir, { recursive: true });
    }
    cb(null, farmDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype.split("/")[1]);
    if (ext || mime) {
      cb(null, true);
    } else {
      cb(new Error("이미지 파일만 업로드 가능합니다 (jpg, png, gif, webp)"));
    }
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 사진 업로드 엔드포인트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * POST /api/journal/:farmId/photos
 * 사진 업로드 (최대 5장)
 */
router.post(
  "/:farmId/photos",
  authenticate,
  upload.array("photos", 5),
  (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: "파일이 없습니다" });
      }

      const photos = req.files.map((file) => ({
        filename: file.filename,
        path: `/${file.path.replace(/\\/g, "/")}`,
        size: file.size,
        mimetype: file.mimetype,
      }));

      logger.info(
        `📷 사진 업로드: ${photos.length}장 (${req.params.farmId})`
      );

      res.json({ success: true, data: photos });
    } catch (error) {
      logger.error("사진 업로드 실패:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 영농일지 CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/journal/:farmId/entries
 * 영농일지 목록 조회
 */
router.get("/:farmId/entries", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const {
      houseId,
      workType,
      startDate,
      endDate,
      tags, // CSV: "방제,수확" (전체 일치 = AND, 일부는 hasSome)
      tagsMode = "any", // any|all
      limit = 50,
      page = 1,
    } = req.query;

    const where = { farmId };
    if (houseId) where.houseId = houseId;
    if (workType) where.workType = workType;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }
    if (tags && typeof tags === "string") {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        where.tags = tagsMode === "all" ? { hasEvery: tagList } : { hasSome: tagList };
      }
    }

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const [entries, total] = await Promise.all([
      prisma.farmJournal.findMany({
        where,
        orderBy: { date: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.farmJournal.count({ where }),
    ]);

    res.json({
      success: true,
      data: entries.map(formatJournal),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    logger.error("영농일지 조회 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/journal/:farmId/entries/:id
 * 영농일지 상세 조회
 */
router.get("/:farmId/entries/:id", authenticate, async (req, res) => {
  try {
    const entry = await prisma.farmJournal.findUnique({
      where: { id: req.params.id },
    });
    if (!entry) {
      return res
        .status(404)
        .json({ success: false, error: "일지를 찾을 수 없습니다" });
    }
    res.json({ success: true, data: formatJournal(entry) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/journal/:farmId/entries
 * 영농일지 작성
 */
router.post("/:farmId/entries", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const {
      houseId,
      date,
      weather,
      tempMin,
      tempMax,
      humidity,
      workType,
      growthStage,
      content,
      pest,
      notes,
      tags,
      photos,
    } = req.body;

    if (!date || !workType || !content) {
      return res.status(400).json({
        success: false,
        error: "날짜, 작업유형, 작업내용은 필수입니다",
      });
    }

    // 태그 정규화: 배열 또는 CSV 문자열, 공백/중복 제거, max 20
    const normTags = (() => {
      const arr = Array.isArray(tags) ? tags : (typeof tags === "string" ? tags.split(",") : []);
      const cleaned = arr.map((t) => String(t).trim().replace(/^#/, "")).filter(Boolean);
      return Array.from(new Set(cleaned)).slice(0, 20);
    })();

    const entry = await prisma.farmJournal.create({
      data: {
        // schema 의 default(dbgenerated) 가 적용 안 된 운영 DB 대응 — 명시 생성으로 안전 확보
        id: randomUUID(),
        farmId,
        houseId: houseId || null,
        date: new Date(date),
        weather: weather || null,
        tempMin: tempMin ? parseFloat(tempMin) : null,
        tempMax: tempMax ? parseFloat(tempMax) : null,
        humidity: humidity ? parseFloat(humidity) : null,
        workType,
        growthStage: growthStage || null,
        content,
        pest: pest || null,
        notes: notes || null,
        tags: normTags,
        photos: photos || [],
        createdBy: req.user._id || req.user.id,
      },
    });

    logger.info(`📝 영농일지 작성: ${farmId} ${date} ${workType}`);
    res.status(201).json({ success: true, data: formatJournal(entry) });
  } catch (error) {
    logger.error("영농일지 작성 실패:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/journal/:farmId/entries/:id
 * 영농일지 수정
 */
router.put("/:farmId/entries/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const data = {};
    const fields = [
      "houseId",
      "date",
      "weather",
      "tempMin",
      "tempMax",
      "humidity",
      "workType",
      "growthStage",
      "content",
      "pest",
      "notes",
      "tags",
      "photos",
    ];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        if (f === "date") data[f] = new Date(req.body[f]);
        else if (["tempMin", "tempMax", "humidity"].includes(f))
          data[f] = req.body[f] ? parseFloat(req.body[f]) : null;
        else if (f === "tags") {
          const arr = Array.isArray(req.body[f]) ? req.body[f] : (typeof req.body[f] === "string" ? req.body[f].split(",") : []);
          data[f] = Array.from(new Set(arr.map((t) => String(t).trim().replace(/^#/, "")).filter(Boolean))).slice(0, 20);
        }
        else data[f] = req.body[f];
      }
    }

    const entry = await prisma.farmJournal.update({ where: { id }, data });
    logger.info(`✏️ 영농일지 수정: ${id}`);
    res.json({ success: true, data: formatJournal(entry) });
  } catch (error) {
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "일지를 찾을 수 없습니다" });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/journal/:farmId/entries/:id
 * 영농일지 삭제
 */
router.delete("/:farmId/entries/:id", authenticate, async (req, res) => {
  try {
    await prisma.farmJournal.delete({ where: { id: req.params.id } });
    logger.info(`🗑️ 영농일지 삭제: ${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "일지를 찾을 수 없습니다" });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 수확 기록 CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/journal/:farmId/harvests
 */
router.get("/:farmId/harvests", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const { houseId, startDate, endDate, limit = 50, page = 1 } = req.query;

    const where = { farmId };
    if (houseId) where.houseId = houseId;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const [records, total] = await Promise.all([
      prisma.harvestRecord.findMany({
        where,
        orderBy: { date: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.harvestRecord.count({ where }),
    ]);

    res.json({
      success: true,
      data: records.map(formatRecord),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/journal/:farmId/harvests
 */
router.post("/:farmId/harvests", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const {
      houseId,
      date,
      cropName,
      quantity,
      unit,
      grade,
      destination,
      unitPrice,
      notes,
      photos,
    } = req.body;

    if (!date || !cropName || !quantity) {
      return res.status(400).json({
        success: false,
        error: "날짜, 작물명, 수확량은 필수입니다",
      });
    }

    const qty = parseFloat(quantity);
    const price = unitPrice ? parseFloat(unitPrice) : null;
    const totalRevenue = price ? qty * price : null;

    const record = await prisma.harvestRecord.create({
      data: {
        farmId,
        houseId: houseId || null,
        date: new Date(date),
        cropName,
        quantity: qty,
        unit: unit || "kg",
        grade: grade || null,
        destination: destination || null,
        unitPrice: price,
        totalRevenue,
        notes: notes || null,
        photos: photos || [],
        createdBy: req.user._id || req.user.id,
      },
    });

    logger.info(`🌾 수확 기록: ${farmId} ${cropName} ${qty}${unit || "kg"}`);
    res.status(201).json({ success: true, data: formatRecord(record) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/journal/:farmId/harvests/:id
 */
router.put("/:farmId/harvests/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const data = {};
    const fields = [
      "houseId",
      "date",
      "cropName",
      "quantity",
      "unit",
      "grade",
      "destination",
      "unitPrice",
      "notes",
      "photos",
    ];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        if (f === "date") data[f] = new Date(req.body[f]);
        else if (["quantity", "unitPrice"].includes(f))
          data[f] = req.body[f] ? parseFloat(req.body[f]) : null;
        else data[f] = req.body[f];
      }
    }

    // 매출 자동 계산
    if (data.quantity !== undefined || data.unitPrice !== undefined) {
      const existing = await prisma.harvestRecord.findUnique({
        where: { id },
      });
      const qty = data.quantity ?? existing?.quantity ?? 0;
      const price = data.unitPrice ?? existing?.unitPrice;
      data.totalRevenue = price ? qty * price : null;
    }

    const record = await prisma.harvestRecord.update({ where: { id }, data });
    res.json({ success: true, data: formatRecord(record) });
  } catch (error) {
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "기록을 찾을 수 없습니다" });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/journal/:farmId/harvests/:id
 */
router.delete("/:farmId/harvests/:id", authenticate, async (req, res) => {
  try {
    await prisma.harvestRecord.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "기록을 찾을 수 없습니다" });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 투입물 기록 CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/journal/:farmId/inputs
 */
router.get("/:farmId/inputs", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const {
      houseId,
      inputType,
      startDate,
      endDate,
      limit = 50,
      page = 1,
    } = req.query;

    const where = { farmId };
    if (houseId) where.houseId = houseId;
    if (inputType) where.inputType = inputType;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const limitNum = Math.min(parseInt(limit) || 50, 200);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const [records, total] = await Promise.all([
      prisma.inputRecord.findMany({
        where,
        orderBy: { date: "desc" },
        skip,
        take: limitNum,
      }),
      prisma.inputRecord.count({ where }),
    ]);

    res.json({
      success: true,
      data: records.map(formatRecord),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/journal/:farmId/inputs
 */
router.post("/:farmId/inputs", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const {
      houseId,
      date,
      inputType,
      productName,
      manufacturer,
      quantity,
      unit,
      cost,
      targetArea,
      method,
      notes,
    } = req.body;

    if (!date || !inputType || !productName || !quantity || !unit) {
      return res.status(400).json({
        success: false,
        error: "날짜, 투입유형, 제품명, 사용량, 단위는 필수입니다",
      });
    }

    const record = await prisma.inputRecord.create({
      data: {
        farmId,
        houseId: houseId || null,
        date: new Date(date),
        inputType,
        productName,
        manufacturer: manufacturer || null,
        quantity: parseFloat(quantity),
        unit,
        cost: cost ? parseFloat(cost) : null,
        targetArea: targetArea ? parseFloat(targetArea) : null,
        method: method || null,
        notes: notes || null,
        createdBy: req.user._id || req.user.id,
      },
    });

    logger.info(
      `💊 투입물 기록: ${farmId} ${inputType} ${productName} ${quantity}${unit}`
    );
    res.status(201).json({ success: true, data: formatRecord(record) });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/journal/:farmId/inputs/:id
 */
router.put("/:farmId/inputs/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const data = {};
    const fields = [
      "houseId",
      "date",
      "inputType",
      "productName",
      "manufacturer",
      "quantity",
      "unit",
      "cost",
      "targetArea",
      "method",
      "notes",
    ];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        if (f === "date") data[f] = new Date(req.body[f]);
        else if (["quantity", "cost", "targetArea"].includes(f))
          data[f] = req.body[f] ? parseFloat(req.body[f]) : null;
        else data[f] = req.body[f];
      }
    }

    const record = await prisma.inputRecord.update({ where: { id }, data });
    res.json({ success: true, data: formatRecord(record) });
  } catch (error) {
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "기록을 찾을 수 없습니다" });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/journal/:farmId/inputs/:id
 */
router.delete("/:farmId/inputs/:id", authenticate, async (req, res) => {
  try {
    await prisma.inputRecord.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === "P2025") {
      return res
        .status(404)
        .json({ success: false, error: "기록을 찾을 수 없습니다" });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 통계 / 요약
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/journal/:farmId/summary
 * 영농일지 통계 요약
 */
router.get("/:farmId/summary", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const where = { farmId };
    if (Object.keys(dateFilter).length > 0) where.date = dateFilter;

    const [
      journalCount,
      harvestRecords,
      inputRecords,
      workTypeStats,
    ] = await Promise.all([
      prisma.farmJournal.count({ where }),
      prisma.harvestRecord.findMany({
        where,
        select: { quantity: true, totalRevenue: true },
      }),
      prisma.inputRecord.findMany({
        where,
        select: { cost: true, inputType: true },
      }),
      prisma.farmJournal.groupBy({
        by: ["workType"],
        where,
        _count: { id: true },
      }),
    ]);

    const totalHarvest = harvestRecords.reduce(
      (sum, r) => sum + (r.quantity || 0),
      0
    );
    const totalRevenue = harvestRecords.reduce(
      (sum, r) => sum + (r.totalRevenue || 0),
      0
    );
    const totalInputCost = inputRecords.reduce(
      (sum, r) => sum + (r.cost || 0),
      0
    );

    const inputByType = {};
    for (const r of inputRecords) {
      if (!inputByType[r.inputType]) inputByType[r.inputType] = 0;
      inputByType[r.inputType] += r.cost || 0;
    }

    res.json({
      success: true,
      data: {
        journalCount,
        harvestCount: harvestRecords.length,
        inputCount: inputRecords.length,
        totalHarvest: Math.round(totalHarvest * 10) / 10,
        totalRevenue: Math.round(totalRevenue),
        totalInputCost: Math.round(totalInputCost),
        profit: Math.round(totalRevenue - totalInputCost),
        workTypeStats: workTypeStats.map((s) => ({
          workType: s.workType,
          count: s._count.id,
        })),
        inputByType,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 포맷 헬퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatJournal(entry) {
  if (!entry) return null;
  const { id, ...rest } = entry;
  return { _id: id, ...rest };
}

function formatRecord(record) {
  if (!record) return null;
  const { id, ...rest } = record;
  return { _id: id, ...rest };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 영농일지 템플릿 (P0-4) — 자주 쓰는 작업 1 클릭 생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 목록
router.get("/:farmId/templates", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const list = await prisma.journalTemplate.findMany({
      where: { farmId },
      orderBy: [{ sortOrder: "asc" }, { useCount: "desc" }, { createdAt: "desc" }],
    });
    res.json({ success: true, data: list.map(formatJournal) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 생성
router.post("/:farmId/templates", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const { name, emoji, payload, sortOrder } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: "name 은 필수입니다" });
    const t = await prisma.journalTemplate.create({
      data: {
        farmId,
        name: name.trim(),
        emoji: emoji?.trim() || null,
        payload: payload || {},
        sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
        createdBy: req.user._id || req.user.id,
      },
    });
    res.json({ success: true, data: formatJournal(t) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// 수정
router.put("/:farmId/templates/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const data = {};
    if (req.body.name !== undefined) data.name = String(req.body.name).trim();
    if (req.body.emoji !== undefined) data.emoji = req.body.emoji?.trim() || null;
    if (req.body.payload !== undefined) data.payload = req.body.payload;
    if (req.body.sortOrder !== undefined) data.sortOrder = Number(req.body.sortOrder) || 0;
    const t = await prisma.journalTemplate.update({ where: { id }, data });
    res.json({ success: true, data: formatJournal(t) });
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ success: false, error: "템플릿을 찾을 수 없습니다" });
    res.status(400).json({ success: false, error: e.message });
  }
});

// 삭제
router.delete("/:farmId/templates/:id", authenticate, async (req, res) => {
  try {
    await prisma.journalTemplate.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ success: false, error: "템플릿을 찾을 수 없습니다" });
    res.status(400).json({ success: false, error: e.message });
  }
});

// 사용 카운트 증가 (템플릿 적용 시 호출)
router.post("/:farmId/templates/:id/use", authenticate, async (req, res) => {
  try {
    const t = await prisma.journalTemplate.update({
      where: { id: req.params.id },
      data: { useCount: { increment: 1 } },
    });
    res.json({ success: true, data: formatJournal(t) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 자동 채움 — 일지 작성 시 환경값 자동 주입
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 농민이 날짜·하우스만 선택하면 그 시점 sensor/control 데이터 기반으로
// 온도/습도/CO2 + 자동 제어 이력 자동 첨부.
// 빈 필드만 채우는 것은 프론트가 결정. 여기서는 raw 집계만 반환.
//
// 쿼리: ?date=YYYY-MM-DD&houseId=...&from=HH:MM&to=HH:MM
//   - date 필수, houseId 선택 (없으면 농장 전체 평균)
//   - from/to 선택 (default: 06:00 ~ 22:00 — 농작업 시간대)
router.get("/:farmId/auto-fill", authenticate, async (req, res) => {
  const { farmId } = req.params;
  const { date, houseId, from = "06:00", to = "22:00" } = req.query;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: "date 는 YYYY-MM-DD 형식이어야 합니다" });
  }

  // KST 기준으로 그 날의 from/to 시각 → UTC 변환
  // 농가는 한국이므로 +09:00 고정. 변경 가능성 낮음.
  const dayStartKst = new Date(`${date}T${from}:00+09:00`);
  const dayEndKst = new Date(`${date}T${to}:00+09:00`);
  if (Number.isNaN(dayStartKst.getTime()) || Number.isNaN(dayEndKst.getTime())) {
    return res.status(400).json({ success: false, error: "from/to 시각 형식 오류 (HH:MM)" });
  }

  try {
    const sensorWhere = { farmId, timestamp: { gte: dayStartKst, lt: dayEndKst } };
    if (houseId) sensorWhere.houseId = houseId;

    const sensorRows = await prisma.sensorData.findMany({
      where: sensorWhere,
      select: { timestamp: true, data: true },
      orderBy: { timestamp: "asc" },
    });

    // sensorData.data 는 { temp_<id>: number, humidity_<id>: number, co2_<id>?, ec_<id>?, ph_<id>? }
    // prefix 별로 모든 센서 값을 모아 평균/최저/최고 산출
    const buckets = {}; // prefix -> [values]
    for (const row of sensorRows) {
      const d = row.data || {};
      for (const [k, v] of Object.entries(d)) {
        const m = /^([a-zA-Z]+)_/.exec(k);
        const prefix = (m ? m[1] : k).toLowerCase();
        const num = Number(v);
        if (!Number.isFinite(num)) continue;
        if (!buckets[prefix]) buckets[prefix] = [];
        buckets[prefix].push(num);
      }
    }

    const stats = (arr) => {
      if (!arr || arr.length === 0) return null;
      const sum = arr.reduce((a, b) => a + b, 0);
      return { min: Math.min(...arr), max: Math.max(...arr), avg: Math.round((sum / arr.length) * 10) / 10, count: arr.length };
    };

    const temp = stats(buckets.temp);
    const humid = stats(buckets.humidity);
    const co2 = stats(buckets.co2);

    // controlLog 같은 시간대 — 자동/수동 분류, 디바이스별 그룹
    const controlWhere = { farmId, timestamp: { gte: dayStartKst, lt: dayEndKst }, success: true };
    if (houseId) controlWhere.houseId = houseId;

    const controlRows = await prisma.controlLog.findMany({
      where: controlWhere,
      select: { timestamp: true, deviceId: true, deviceType: true, deviceName: true, command: true, isAutomatic: true, automationReason: true, operator: true },
      orderBy: { timestamp: "asc" },
    });

    // 디바이스별 첫/마지막 명령으로 사용 시간 계산
    const events = controlRows.map((r) => ({
      time: new Date(r.timestamp).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }),
      deviceId: r.deviceId,
      deviceType: r.deviceType,
      deviceName: r.deviceName || r.deviceId,
      command: r.command,
      isAutomatic: !!r.isAutomatic,
      reason: r.automationReason || null,
      operator: r.operator,
    }));

    // 디바이스 타입별 횟수 요약 (window/fan/heater 등)
    const byType = {};
    for (const e of events) {
      const k = e.deviceType || "기타";
      if (!byType[k]) byType[k] = { auto: 0, manual: 0 };
      if (e.isAutomatic) byType[k].auto += 1;
      else byType[k].manual += 1;
    }
    const summaryParts = [];
    for (const [type, c] of Object.entries(byType)) {
      const total = c.auto + c.manual;
      summaryParts.push(`${type} ${total}회${c.auto > 0 ? `(자동 ${c.auto})` : ""}`);
    }
    const controlSummary = events.length > 0 ? `🤖 자동 제어 ${events.filter((e) => e.isAutomatic).length}건 / 수동 ${events.filter((e) => !e.isAutomatic).length}건 — ${summaryParts.join(", ")}` : null;

    return res.json({
      success: true,
      data: {
        period: { date, from, to, tz: "Asia/Seoul" },
        houseId: houseId || null,
        sensor: {
          tempMin: temp?.min ?? null,
          tempMax: temp?.max ?? null,
          tempAvg: temp?.avg ?? null,
          humidity: humid?.avg ?? null,
          humidityMin: humid?.min ?? null,
          humidityMax: humid?.max ?? null,
          co2: co2?.avg ?? null,
          readingCount: sensorRows.length,
          available: sensorRows.length > 0,
        },
        control: {
          eventCount: events.length,
          autoCount: events.filter((e) => e.isAutomatic).length,
          manualCount: events.filter((e) => !e.isAutomatic).length,
          summary: controlSummary,
          events: events.slice(0, 50), // 표시용 최대 50건
          available: events.length > 0,
        },
      },
    });
  } catch (err) {
    logger.error("journal/auto-fill 실패: " + err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
