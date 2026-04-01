// src/routes/cameras.routes.js
// 카메라 CRUD API + go2rtc 자동 동기화

import { Router } from "express";
import { prisma } from "../db.js";
import logger from "../utils/logger.js";

const router = Router();

const GO2RTC_URL = process.env.GO2RTC_URL || "https://cctv.smartgreen.kr";

// ━━━ go2rtc 스트림 동기화 ━━━
async function syncGo2rtc(farmId) {
  try {
    // DB에서 해당 농장의 활성 카메라 전체 조회
    const cameras = await prisma.camera.findMany({
      where: { farmId, enabled: true },
      orderBy: { sortOrder: "asc" },
    });

    // 현재 go2rtc 스트림 목록 조회
    const streamsRes = await fetch(`${GO2RTC_URL}/api/streams`);
    if (!streamsRes.ok) throw new Error(`go2rtc API ${streamsRes.status}`);
    const currentStreams = await streamsRes.json();

    // DB 기준 camId 목록
    const dbCamIds = new Set(cameras.map(c => c.camId));

    // 1. DB에 있는 카메라 → go2rtc에 추가/업데이트
    for (const cam of cameras) {
      const streamUrl = `${cam.rtspUrl}#video=copy#audio=off`;
      const existing = currentStreams[cam.camId];
      const existingUrl = existing?.producers?.[0]?.url;

      if (!existing || existingUrl !== streamUrl) {
        await fetch(`${GO2RTC_URL}/api/streams?name=${cam.camId}&src=${encodeURIComponent(streamUrl)}`, {
          method: "PUT",
        });
        logger.info(`📹 go2rtc 스트림 등록: ${cam.camId}`);
      }
    }

    // 2. go2rtc에만 있고 DB에 없는 cam* 스트림 → 정리 (동적 추가분만, 재시작 시 yaml 기준으로 복원됨)
    // 참고: go2rtc 동적 DELETE는 지원 안 되므로 로그만 남김
    for (const streamName of Object.keys(currentStreams)) {
      if (streamName.startsWith("cam") && !dbCamIds.has(streamName)) {
        logger.warn(`📹 go2rtc에 불필요한 스트림: ${streamName} (yaml에서 수동 삭제 필요)`);
      }
    }

    logger.info(`📹 go2rtc 동기화 완료: ${cameras.length}개 카메라`);
    return { success: true, synced: cameras.length };
  } catch (error) {
    logger.error(`📹 go2rtc 동기화 실패:`, error.message);
    return { success: false, error: error.message };
  }
}

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

    // go2rtc 동기화
    const syncResult = await syncGo2rtc(req.params.farmId);
    res.status(201).json({ success: true, data: camera, go2rtc: syncResult });
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

    // go2rtc 동기화 (RTSP URL 변경 또는 활성화 상태 변경 시)
    if (rtspUrl !== undefined || enabled !== undefined) {
      const syncResult = await syncGo2rtc(req.params.farmId);
      return res.json({ success: true, data: camera, go2rtc: syncResult });
    }

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

    // go2rtc 동기화
    const syncResult = await syncGo2rtc(req.params.farmId);
    res.json({ success: true, go2rtc: syncResult });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/cameras/:farmId/sync — 수동 go2rtc 동기화
router.post("/:farmId/sync", async (req, res) => {
  const syncResult = await syncGo2rtc(req.params.farmId);
  res.json(syncResult);
});

export default router;
