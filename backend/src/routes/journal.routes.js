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
      measurements,
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

    // 생육 측정 정규화 (P1-A) — 표준 필드 4 + custom 배열
    const normMeasurements = normalizeMeasurements(measurements);

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
        measurements: normMeasurements,
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
      "measurements",
      "photos",
    ];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        if (f === "date") data[f] = new Date(req.body[f]);
        else if (["tempMin", "tempMax", "humidity"].includes(f))
          data[f] = req.body[f] ? parseFloat(req.body[f]) : null;
        else if (f === "measurements") {
          data[f] = normalizeMeasurements(req.body[f]);
        }
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
      // PLS 농약 정밀 기록 (인증 의무)
      pesticideRegNo,
      dilutionRatio,
      applicationCount,
      safeUseInterval,
      applicator,
    } = req.body;

    if (!date || !inputType || !productName || !quantity || !unit) {
      return res.status(400).json({
        success: false,
        error: "날짜, 투입유형, 제품명, 사용량, 단위는 필수입니다",
      });
    }

    // PLS 안전사용기준 일수 → 마지막 농약사용일자 자동 계산
    // GAP 의무: "최초 수확 가능일자 = 살포일 + safeUseInterval"
    const pls = inputType === "농약" ? {
      pesticideRegNo: pesticideRegNo?.trim() || null,
      dilutionRatio: dilutionRatio?.trim() || null,
      applicationCount: applicationCount != null && applicationCount !== "" ? parseInt(applicationCount) : null,
      safeUseInterval: safeUseInterval != null && safeUseInterval !== "" ? parseInt(safeUseInterval) : null,
      applicator: applicator?.trim() || null,
    } : {};
    const preHarvestDate = (inputType === "농약" && pls.safeUseInterval && date) ? (() => {
      const d = new Date(date);
      d.setDate(d.getDate() + pls.safeUseInterval);
      return d;
    })() : null;

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
        ...pls,
        preHarvestDate,
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
      // PLS 6 필드
      "pesticideRegNo",
      "dilutionRatio",
      "applicationCount",
      "safeUseInterval",
      "applicator",
    ];

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        if (f === "date") data[f] = new Date(req.body[f]);
        else if (["quantity", "cost", "targetArea"].includes(f))
          data[f] = req.body[f] ? parseFloat(req.body[f]) : null;
        else if (["applicationCount", "safeUseInterval"].includes(f))
          data[f] = req.body[f] != null && req.body[f] !== "" ? parseInt(req.body[f]) : null;
        else data[f] = req.body[f] || null;
      }
    }
    // safeUseInterval 또는 date 변경 시 preHarvestDate 자동 재계산
    if (data.safeUseInterval !== undefined || data.date !== undefined) {
      const cur = await prisma.inputRecord.findUnique({ where: { id } });
      if (cur) {
        const dt = data.date || cur.date;
        const sui = data.safeUseInterval !== undefined ? data.safeUseInterval : cur.safeUseInterval;
        if (sui != null && dt) {
          const d = new Date(dt);
          d.setDate(d.getDate() + sui);
          data.preHarvestDate = d;
        } else {
          data.preHarvestDate = null;
        }
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

// 생육 측정 정규화 (P1-A)
// - 표준 4 필드 (plantHeight cm, leafCount 개, floweringRate %, fruitSetRate %) 는 number 또는 null
// - custom: [{name, value, unit}] 최대 8 개
// - 모든 값 빈 입력이면 빈 객체 {} 반환 (DB 저장량 최소화)
function normalizeMeasurements(m) {
  if (!m || typeof m !== "object") return {};
  const num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const out = {};
  const ph = num(m.plantHeight);
  const lc = num(m.leafCount);
  const fr = num(m.floweringRate);
  const fs = num(m.fruitSetRate);
  if (ph !== null) out.plantHeight = ph;
  if (lc !== null) out.leafCount = lc;
  if (fr !== null) out.floweringRate = fr;
  if (fs !== null) out.fruitSetRate = fs;
  if (Array.isArray(m.custom)) {
    const cleaned = m.custom
      .map((c) => ({
        name: String(c?.name || "").trim().slice(0, 30),
        value: num(c?.value),
        unit: String(c?.unit || "").trim().slice(0, 10),
      }))
      .filter((c) => c.name && c.value !== null)
      .slice(0, 8);
    if (cleaned.length > 0) out.custom = cleaned;
  }
  return out;
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 자재 입출고 대장 (친환경 인증 의무, 단계 2)
// IN(입고) / OUT(사용) / DISPOSAL(폐기) 3 액션, 현재 보관량 자동 집계
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 목록 (날짜 내림차순)
router.get("/:farmId/inventory", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const { type, productName, action, startDate, endDate, limit = 100, page = 1 } = req.query;
    const where = { farmId };
    if (type) where.type = type;
    if (productName) where.productName = { contains: productName };
    if (action) where.action = action;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }
    const limitNum = Math.min(parseInt(limit) || 100, 500);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const [rows, total] = await Promise.all([
      prisma.inputInventory.findMany({ where, orderBy: { date: "desc" }, skip: (pageNum - 1) * limitNum, take: limitNum }),
      prisma.inputInventory.count({ where }),
    ]);
    res.json({ success: true, data: rows.map(formatRecord), pagination: { total, page: pageNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 등록
router.post("/:farmId/inventory", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const { date, type, productName, manufacturer, action, quantity, unit, supplier, cost, receiptPhoto, notes } = req.body;
    if (!date || !type || !productName || !action || !quantity || !unit) {
      return res.status(400).json({ success: false, error: "날짜·유형·제품명·액션·수량·단위는 필수입니다" });
    }
    if (!["IN", "OUT", "DISPOSAL"].includes(action)) {
      return res.status(400).json({ success: false, error: "action 은 IN / OUT / DISPOSAL 중 하나" });
    }
    const row = await prisma.inputInventory.create({
      data: {
        farmId,
        date: new Date(date),
        type,
        productName: productName.trim(),
        manufacturer: manufacturer?.trim() || null,
        action,
        quantity: parseFloat(quantity),
        unit,
        supplier: supplier?.trim() || null,
        cost: cost ? parseFloat(cost) : null,
        receiptPhoto: receiptPhoto || null,
        notes: notes || null,
        createdBy: req.user._id || req.user.id,
      },
    });
    res.status(201).json({ success: true, data: formatRecord(row) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

// 수정
router.put("/:farmId/inventory/:id", authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const data = {};
    const fields = ["date", "type", "productName", "manufacturer", "action", "quantity", "unit", "supplier", "cost", "receiptPhoto", "notes"];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        if (f === "date") data[f] = new Date(req.body[f]);
        else if (["quantity", "cost"].includes(f)) data[f] = req.body[f] != null && req.body[f] !== "" ? parseFloat(req.body[f]) : null;
        else data[f] = req.body[f] || null;
      }
    }
    const row = await prisma.inputInventory.update({ where: { id }, data });
    res.json({ success: true, data: formatRecord(row) });
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ success: false, error: "기록을 찾을 수 없습니다" });
    res.status(400).json({ success: false, error: e.message });
  }
});

// 삭제
router.delete("/:farmId/inventory/:id", authenticate, async (req, res) => {
  try {
    await prisma.inputInventory.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    if (e.code === "P2025") return res.status(404).json({ success: false, error: "기록을 찾을 수 없습니다" });
    res.status(400).json({ success: false, error: e.message });
  }
});

// 보관량 집계 — 제품별 IN - OUT - DISPOSAL = 현재 보관량
router.get("/:farmId/inventory/summary", authenticate, async (req, res) => {
  try {
    const { farmId } = req.params;
    const rows = await prisma.inputInventory.findMany({
      where: { farmId },
      orderBy: [{ productName: "asc" }, { date: "desc" }],
    });
    const map = new Map();
    for (const r of rows) {
      const key = `${r.type}|${r.productName}`;
      if (!map.has(key)) {
        map.set(key, {
          type: r.type, productName: r.productName, manufacturer: r.manufacturer || null, unit: r.unit,
          inQty: 0, outQty: 0, disposalQty: 0, currentStock: 0, lastDate: r.date, totalCost: 0,
        });
      }
      const cur = map.get(key);
      const q = Number(r.quantity) || 0;
      if (r.action === "IN") { cur.inQty += q; if (r.cost) cur.totalCost += Number(r.cost); }
      else if (r.action === "OUT") cur.outQty += q;
      else if (r.action === "DISPOSAL") cur.disposalQty += q;
      cur.currentStock = cur.inQty - cur.outQty - cur.disposalQty;
    }
    const summary = Array.from(map.values()).sort((a, b) => a.productName.localeCompare(b.productName));
    res.json({ success: true, data: summary });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI 자동 요약 (P2-4) — 주간/월간 일지를 Gemini 가 요약
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import { callAI as _callAI } from "./ai.routes.js";

router.get("/:farmId/ai-summary", authenticate, async (req, res) => {
  const { farmId } = req.params;
  const { period = "week", endDate } = req.query;

  // 기간 결정 (KST 기준)
  const end = endDate ? new Date(endDate + "T23:59:59+09:00") : new Date();
  const start = new Date(end);
  if (period === "month") start.setDate(start.getDate() - 30);
  else start.setDate(start.getDate() - 7);

  try {
    const entries = await prisma.farmJournal.findMany({
      where: { farmId, date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
      take: 200,
    });

    if (entries.length === 0) {
      return res.json({
        success: true,
        data: {
          summary: "이 기간에 작성된 일지가 없습니다.",
          highlights: [],
          suggestions: [],
          stats: { entryCount: 0, period, start, end },
        },
      });
    }

    // 일지 내용 압축 (token 절약)
    const text = entries.map((e) => {
      const m = e.measurements || {};
      const measure = ["plantHeight", "leafCount", "floweringRate", "fruitSetRate"]
        .filter((k) => m[k] != null)
        .map((k) => `${k}=${m[k]}`)
        .join(",");
      return `[${e.date?.toISOString?.().slice(0, 10) || e.date}] ${e.workType}${e.houseId ? `/${e.houseId}` : ""}${e.growthStage ? `/${e.growthStage}` : ""}: ${e.content}${e.pest ? ` | 병해충: ${e.pest}` : ""}${measure ? ` | ${measure}` : ""}${Array.isArray(e.tags) && e.tags.length ? ` | #${e.tags.join(" #")}` : ""}`;
    }).join("\n");

    const systemPrompt = `당신은 한국 농가 영농일지 분석 AI 입니다. ${period === "month" ? "한 달" : "한 주"} 동안의 영농일지 ${entries.length}건을 분석해 다음 JSON 으로 응답하세요.

{
  "summary": "전체 요약 1~3 문장 — 주요 작업, 작목 상태, 특이사항 통합",
  "highlights": ["주목할 사건 1~5 개. 예: '5/2 황화 발견 후 5/3 약제 살포', '5/1~5/4 초장 22→25cm 증가'"],
  "suggestions": ["다음 주(또는 달) 권장 작업 1~3 개. 데이터 기반 — 추측 금지"],
  "stats": {
    "workTypeBreakdown": {"방제": 2, "수확": 5, "...": 0},
    "trendNotes": "측정값 추세 한 줄 (예: '초장 안정적 증가, 엽수 정체')"
  }
}

규칙:
- 사실 기반 — 일지 내용에서 직접 인용. 추측 표현 금지 ("~할 것 같다" X).
- highlights 는 시간 흐름 연결 (이 날 X 후 다음 날 Y).
- JSON 만 출력. 마크다운 코드블록 금지.`;

    const raw = await _callAI(`다음은 ${entries.length}건의 영농일지입니다:\n\n${text}`, { systemPrompt, model: "gemini-2.5-flash" });

    // JSON 파싱
    let parsed = null;
    try {
      let s = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      const f = s.indexOf("{"), l = s.lastIndexOf("}");
      if (f >= 0 && l > f) s = s.slice(f, l + 1);
      parsed = JSON.parse(s);
    } catch (e) { /* fallback below */ }

    const data = parsed && typeof parsed === "object" ? {
      summary: String(parsed.summary || "").trim(),
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String).slice(0, 8) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String).slice(0, 5) : [],
      stats: {
        ...(parsed.stats || {}),
        entryCount: entries.length,
        period,
        start: start.toISOString(),
        end: end.toISOString(),
      },
    } : {
      summary: String(raw).slice(0, 500),
      highlights: [], suggestions: [],
      stats: { entryCount: entries.length, period, start, end, parseFailed: true },
    };

    res.json({ success: true, data });
  } catch (err) {
    logger.error("AI 자동 요약 실패: " + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
