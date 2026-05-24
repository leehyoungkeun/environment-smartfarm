// src/routes/relay-status.routes.js
// 릴레이 실시간 상태 영구 저장소 조회 — frontend ControlPanel mount sync 용
// 양산 표준 sync: NR publish → mqttClient._cacheRelayStatus DB UPSERT → 이 API 로 mount 시 즉시 복원

import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// GET /api/relay-status/:farmId
// 응답: { success, data: { [unitId]: { moduleType, coils, updatedAt } } }
router.get("/:farmId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT unit_id, module_type, coils, updated_at
       FROM relay_status WHERE farm_id = $1`,
      [req.params.farmId]
    );
    const data = {};
    rows.forEach((r) => {
      data[r.unit_id] = {
        moduleType: r.module_type,
        coils: r.coils,
        updatedAt: r.updated_at,
      };
    });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
