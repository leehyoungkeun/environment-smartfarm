// src/routes/device-positions.routes.js
// 장치 위치 + 활성 동작 정보 저장/조회 API

import { Router } from "express";
import { pool } from "../db.js";
import { broadcastDevicePosition } from "../services/wsServer.js";

const router = Router();

// GET /api/device-positions/:farmId
router.get("/:farmId", async (req, res) => {
  try {
    // houseId 지정 시 해당 하우스만, 생략 시 전 하우스
    const { houseId } = req.query;
    const params = [req.params.farmId];
    let where = `farm_id = $1`;
    if (houseId) {
      params.push(houseId);
      where += ` AND house_id = $2`;
    }

    const { rows } = await pool.query(
      `SELECT house_id, device_id, position, command, start_position, target_position, duration, started_at, updated_at
       FROM device_positions WHERE ${where}`,
      params
    );

    const shape = (r) => ({
      position: r.position,
      command: r.command,
      startPosition: r.start_position,
      targetPosition: r.target_position,
      duration: r.duration,
      startedAt: r.started_at,
      updatedAt: r.updated_at,
    });

    // data   : deviceId 평면 맵 — 기존 클라이언트 호환
    // byHouse: { houseId: { deviceId: {...} } } — 다중 하우스 대응 신규 형식
    const positions = {};
    const byHouse = {};
    rows.forEach(r => {
      positions[r.device_id] = shape(r);
      if (!byHouse[r.house_id]) byHouse[r.house_id] = {};
      byHouse[r.house_id][r.device_id] = shape(r);
    });

    res.json({ success: true, data: positions, byHouse });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/device-positions/:farmId
router.post("/:farmId", async (req, res) => {
  try {
    const { deviceId, position, command, startPosition, targetPosition, duration, startedAt } = req.body;
    if (!deviceId) {
      return res.status(400).json({ success: false, error: "deviceId 필수" });
    }

    // 하위 호환: houseId 미전달 시 단일 하우스 기본값
    const houseId = req.body.houseId || 'house_0001';

    await pool.query(
      `INSERT INTO device_positions (farm_id, house_id, device_id, position, command, start_position, target_position, duration, started_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (farm_id, house_id, device_id) DO UPDATE
       SET position = $4, command = $5, start_position = $6, target_position = $7, duration = $8, started_at = $9, updated_at = NOW()`,
      [req.params.farmId, houseId, deviceId, position ?? 0, command || 'stop', startPosition ?? 0, targetPosition ?? 0, duration ?? 0, startedAt || null]
    );

    res.json({ success: true });

    // WebSocket broadcast → frontend ControlPanel 즉시 sync (다른 키오스크·PC 인스턴스 포함)
    try {
      broadcastDevicePosition(req.params.farmId, {
        houseId,
        deviceId,
        position: position ?? 0,
        command: command || 'stop',
        startPosition: startPosition ?? 0,
        targetPosition: targetPosition ?? 0,
        duration: duration ?? 0,
        startedAt: startedAt || null,
      });
    } catch (e) { /* WS broadcast 실패는 무시 */ }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
