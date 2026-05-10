// src/routes/device-positions.routes.js
// 장치 위치 + 활성 동작 정보 저장/조회 API

import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// GET /api/device-positions/:farmId
router.get("/:farmId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT device_id, position, command, start_position, target_position, duration, started_at, updated_at
       FROM device_positions WHERE farm_id = $1`,
      [req.params.farmId]
    );
    const positions = {};
    rows.forEach(r => {
      positions[r.device_id] = {
        position: r.position,
        command: r.command,
        startPosition: r.start_position,
        targetPosition: r.target_position,
        duration: r.duration,
        startedAt: r.started_at,
        updatedAt: r.updated_at,
      };
    });
    res.json({ success: true, data: positions });
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

    await pool.query(
      `INSERT INTO device_positions (farm_id, device_id, position, command, start_position, target_position, duration, started_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (farm_id, device_id) DO UPDATE
       SET position = $3, command = $4, start_position = $5, target_position = $6, duration = $7, started_at = $8, updated_at = NOW()`,
      [req.params.farmId, deviceId, position ?? 0, command || 'stop', startPosition ?? 0, targetPosition ?? 0, duration ?? 0, startedAt || null]
    );

    res.json({ success: true });

    // MQTT publish → RPi 가 즉시 global.devicePositions 동기화
    // 자동화 ② 평가의 isAlready 판정에 정확한 position 전달 (사용자 ■정지 중간 위치 포함)
    try {
      const mqttService = (await import("../services/mqttClient.js")).default;
      if (mqttService.isConnected()) {
        const topic = `smartfarm/${req.params.farmId}/device-positions`;
        mqttService.client.publish(topic, JSON.stringify({
          action: 'set_device_position',
          farmId: req.params.farmId,
          deviceId,
          position: position ?? 0,
          command: command || 'stop',
          startPosition: startPosition ?? 0,
          targetPosition: targetPosition ?? 0,
          duration: duration ?? 0,
          startedAt: startedAt || null,
          timestamp: new Date().toISOString(),
        }), { qos: 1 });
      }
    } catch (e) { /* MQTT 발행 실패는 무시 — 5분 fetch fallback */ }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
