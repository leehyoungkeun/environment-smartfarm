// src/routes/device-positions.routes.js
// 장치 위치(열림 %) 저장/조회 API
// Node-RED → 서버: 자동 정지 시 위치 보고
// 프론트 → 서버: 제어 페이지 진입 시 위치 조회

import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// GET /api/device-positions/:farmId — 농장별 장치 위치 조회
router.get("/:farmId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT device_id, position, command, updated_at
       FROM device_positions WHERE farm_id = $1`,
      [req.params.farmId]
    );
    const positions = {};
    rows.forEach(r => { positions[r.device_id] = { position: r.position, command: r.command, updatedAt: r.updated_at }; });
    res.json({ success: true, data: positions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/device-positions/:farmId — 장치 위치 저장 (Node-RED에서 호출)
router.post("/:farmId", async (req, res) => {
  try {
    const { deviceId, position, command } = req.body;
    if (!deviceId || position === undefined) {
      return res.status(400).json({ success: false, error: "deviceId, position 필수" });
    }

    await pool.query(
      `INSERT INTO device_positions (farm_id, device_id, position, command, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (farm_id, device_id) DO UPDATE
       SET position = $3, command = $4, updated_at = NOW()`,
      [req.params.farmId, deviceId, position, command || 'stop']
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
