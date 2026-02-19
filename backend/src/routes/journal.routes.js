// src/routes/journal.routes.js
// 영농일지 + 수확 기록 + 투입물 기록 API
// 사진 업로드 포함

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
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
      photos,
    } = req.body;

    if (!date || !workType || !content) {
      return res.status(400).json({
        success: false,
        error: "날짜, 작업유형, 작업내용은 필수입니다",
      });
    }

    const entry = await prisma.farmJournal.create({
      data: {
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
      "photos",
    ];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        if (f === "date") data[f] = new Date(req.body[f]);
        else if (["tempMin", "tempMax", "humidity"].includes(f))
          data[f] = req.body[f] ? parseFloat(req.body[f]) : null;
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

export default router;
