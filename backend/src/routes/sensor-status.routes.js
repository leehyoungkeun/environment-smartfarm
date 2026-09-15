// 표준(KS X 3267) 센서 관측치·상태 1분 스냅샷 — 조회·추출 (SPS-7466 §5.4.4 c·d, KOAT 116 센서 상태정보) 2026-09-15
// 마운트: /api/sensor-status (JWT + 테넌트 격리). 수신은 /internal/actuator-status 의 sensorRows (NR, 농장 키).
// 운영 sensor_data 와 다른 점: 상태 101~103 이어도 관측치·상태를 그대로 남긴다 (시험 증적용 — 값을 생략하지 않는다).
import express from "express";
import { pool } from "../db.js";
import { sensorStatusTable, toDelimited, formatSpec, exportFilename, resolveRange } from "../utils/exportCsv.js";

const router = express.Router();
const MAX_ROWS = 200000; // 31일 × 1440분 × 4~5센서

async function queryRows(farmId, { unit, idx, houseId, start, end, limit }) {
  const params = [farmId, start, end];
  let sql = `SELECT "timestamp", unit, idx, code, name, value, status, status_name, house_id, sensor_id
             FROM ks_sensor_status WHERE farm_id = $1 AND "timestamp" >= $2 AND "timestamp" <= $3`;
  const u = parseInt(unit, 10);
  if (Number.isFinite(u)) { params.push(u); sql += ` AND unit = $${params.length}`; }
  if (idx) {
    const ids = String(idx).split(",").map((s) => parseInt(s, 10)).filter(Number.isFinite);
    if (ids.length) { params.push(ids); sql += ` AND idx = ANY($${params.length})`; }
  }
  if (houseId) { params.push(houseId); sql += ` AND house_id = $${params.length}`; }
  params.push(Math.min(parseInt(limit) || MAX_ROWS, MAX_ROWS));
  sql += ` ORDER BY "timestamp" ASC, unit ASC, idx ASC LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

/** GET /api/sensor-status/:farmId?unit&idx=1,4&houseId&startDate&endDate&limit — 1분 행 (JSON) */
router.get("/:farmId", async (req, res) => {
  try {
    const [start, end] = resolveRange(req.query.startDate, req.query.endDate);
    const rows = await queryRows(req.params.farmId, { ...req.query, start, end });
    res.json({ success: true, count: rows.length, range: { start, end }, intervalSec: 60, data: rows });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** GET /api/sensor-status/:farmId/export?format=csv|txt — 파일 추출 */
router.get("/:farmId/export", async (req, res) => {
  try {
    const [start, end] = resolveRange(req.query.startDate, req.query.endDate);
    const rows = await queryRows(req.params.farmId, { ...req.query, start, end });
    const { columns, rows: table } = sensorStatusTable(rows);
    const body = toDelimited(table, columns, req.query.format);
    res.setHeader("Content-Type", formatSpec(req.query.format).mime);
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename("ks-sensor", req.params.farmId, req.query.houseId, start, end, req.query.format)}"`);
    res.send(body);
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** GET /api/sensor-status/:farmId/sensors — 기간 안에 기록된 표준 센서 목록 (화면 선택용) */
router.get("/:farmId/sensors", async (req, res) => {
  try {
    const [start, end] = resolveRange(req.query.startDate, req.query.endDate);
    const { rows } = await pool.query(
      `SELECT unit, idx, max(code) AS code, max(name) AS name, max(house_id) AS house_id, max(sensor_id) AS sensor_id, count(*)::int AS rows
       FROM ks_sensor_status WHERE farm_id = $1 AND "timestamp" >= $2 AND "timestamp" <= $3 GROUP BY 1,2 ORDER BY 1,2`,
      [req.params.farmId, start, end]);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;
