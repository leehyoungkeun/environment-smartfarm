// src/routes/cameras.routes.js
// 카메라 CRUD API

import { Router } from "express";
import { prisma } from "../db.js";
import logger from "../utils/logger.js";

const router = Router();

// GET /api/cameras/:farmId — 카메라 목록
router.get("/:farmId", async (req, res) => {
  try {
    const cameras = await prisma.camera.findMany({
      where: { farmId: req.params.farmId },
      orderBy: { sortOrder: "asc" },
    });
    res.json({ success: true, data: cameras });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/cameras/:farmId — 카메라 추가
router.post("/:farmId", async (req, res) => {
  try {
    const { name, location, rtspUrl, camId } = req.body;
    if (!name || !rtspUrl) {
      return res.status(400).json({ success: false, error: "name, rtspUrl 필수" });
    }

    const count = await prisma.camera.count({ where: { farmId: req.params.farmId } });
    const camera = await prisma.camera.create({
      data: {
        farmId: req.params.farmId,
        camId: camId || `cam${count + 1}`,
        name,
        location: location || "",
        rtspUrl,
        sortOrder: count,
      },
    });

    logger.info(`📹 카메라 추가: ${req.params.farmId}/${camera.camId}`);
    res.status(201).json({ success: true, data: camera });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/cameras/:farmId/:camId — 카메라 수정
router.put("/:farmId/:camId", async (req, res) => {
  try {
    const { name, location, rtspUrl, enabled, sortOrder } = req.body;
    const update = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (location !== undefined) update.location = location;
    if (rtspUrl !== undefined) update.rtspUrl = rtspUrl;
    if (enabled !== undefined) update.enabled = enabled;
    if (sortOrder !== undefined) update.sortOrder = sortOrder;

    const camera = await prisma.camera.update({
      where: { farmId_camId: { farmId: req.params.farmId, camId: req.params.camId } },
      data: update,
    });

    logger.info(`📹 카메라 수정: ${req.params.farmId}/${req.params.camId}`);
    res.json({ success: true, data: camera });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/cameras/:farmId/:camId — 카메라 삭제
router.delete("/:farmId/:camId", async (req, res) => {
  try {
    await prisma.camera.delete({
      where: { farmId_camId: { farmId: req.params.farmId, camId: req.params.camId } },
    });

    logger.info(`📹 카메라 삭제: ${req.params.farmId}/${req.params.camId}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
