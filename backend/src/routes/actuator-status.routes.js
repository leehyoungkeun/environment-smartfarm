// 표준(KS X 3267) 구동기 상태 1분 스냅샷 — 조회·추출 (KOAT 116 4.가.2) 마)바))
// 마운트: /api/actuator-status (JWT + 테넌트 격리). 수신은 /internal/actuator-status (NR, 농장 키).
import express from "express";
import { pool } from "../db.js";
import { actuatorStatusTable, toDelimited, formatSpec, exportFilename, resolveRange } from "../utils/exportCsv.js";

const router = express.Router();
const MAX_ROWS = 200000; // 31일 × 1440분 × 4장치

async function queryRows(farmId, { houseId, deviceId, start, end, limit }) {
  const params = [farmId, start, end];
  let sql = `SELECT "timestamp", house_id, device_id, unit, kind, n, status, status_name, remain, opid
             FROM actuator_status WHERE farm_id = $1 AND "timestamp" >= $2 AND "timestamp" <= $3`;
  if (houseId) { params.push(houseId); sql += ` AND house_id = $${params.length}`; }
  if (deviceId) {
    const ids = String(deviceId).split(",").map((s) => s.trim()).filter(Boolean);
    params.push(ids); sql += ` AND device_id = ANY($${params.length})`;
  }
  params.push(Math.min(parseInt(limit) || MAX_ROWS, MAX_ROWS));
  sql += ` ORDER BY "timestamp" ASC, device_id ASC LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

/** GET /api/actuator-status/:farmId?houseId&deviceId=a,b&startDate&endDate&limit — 1분 행 (JSON) */
router.get("/:farmId", async (req, res) => {
  try {
    const [start, end] = resolveRange(req.query.startDate, req.query.endDate);
    const rows = await queryRows(req.params.farmId, { ...req.query, start, end });
    res.json({ success: true, count: rows.length, range: { start, end }, data: rows });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** GET /api/actuator-status/:farmId/export?format=csv|txt|xls — 파일 추출 */
router.get("/:farmId/export", async (req, res) => {
  try {
    const [start, end] = resolveRange(req.query.startDate, req.query.endDate);
    const rows = await queryRows(req.params.farmId, { ...req.query, start, end });
    const { columns, rows: table } = actuatorStatusTable(rows);
    const body = toDelimited(table, columns, req.query.format);
    res.setHeader("Content-Type", formatSpec(req.query.format).mime);
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename("actuator", req.params.farmId, req.query.houseId, start, end, req.query.format)}"`);
    res.send(body);
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** GET /api/actuator-status/:farmId/devices — 기간 안에 기록된 장치 목록 (화면 선택용) */
router.get("/:farmId/devices", async (req, res) => {
  try {
    const [start, end] = resolveRange(req.query.startDate, req.query.endDate);
    const { rows } = await pool.query(
      `SELECT house_id, device_id, kind, unit, n, count(*)::int AS rows FROM actuator_status
       WHERE farm_id = $1 AND "timestamp" >= $2 AND "timestamp" <= $3 GROUP BY 1,2,3,4,5 ORDER BY 1,2`,
      [req.params.farmId, start, end]);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;
