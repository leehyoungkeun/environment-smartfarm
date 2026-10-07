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
  // 최신부터 (2026-10-07) — ASC LIMIT 이면 한도를 넘을 때 **최신이 통째로 잘린다**.
  // 부르는 쪽이 파일처럼 시간순이 필요하면 뒤집어 쓴다.
  sql += ` ORDER BY "timestamp" DESC, unit ASC, idx ASC LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

/** GET /api/sensor-status/:farmId?unit&idx=1,4&houseId&startDate&endDate&limit — 1분 행 (JSON) */
router.get("/:farmId", async (req, res) => {
  try {
    const [start, end] = resolveRange(req.query.startDate, req.query.endDate);
    const rows = await queryRows(req.params.farmId, { ...req.query, start, end });   // 최신이 위
    res.json({ success: true, count: rows.length, range: { start, end }, intervalSec: 60, order: "desc", data: rows });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** GET /api/sensor-status/:farmId/export?format=csv|txt — 파일 추출 */
router.get("/:farmId/export", async (req, res) => {
  try {
    const [start, end] = resolveRange(req.query.startDate, req.query.endDate);
    const rows = await queryRows(req.params.farmId, { ...req.query, start, end });
    rows.reverse();   // 파일은 시간순(오름차순) — 조회는 최신이 위, 파일은 관례대로
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
    // 하우스를 고르면 그 하우스 센서만 — 안 거르면 옛 시험 기간의 하우스 미지정 행까지 섞여
    // 선언한 것보다 많은 종류가 목록에 떠서 심사에서 혼란을 준다 (2026-10-05).
    const { houseId } = req.query;
    const params = [req.params.farmId, start, end];
    if (houseId) params.push(houseId);
    const { rows } = await pool.query(
      `SELECT unit, idx, max(code) AS code, max(name) AS name, max(house_id) AS house_id, max(sensor_id) AS sensor_id, count(*)::int AS rows
       FROM ks_sensor_status WHERE farm_id = $1 AND "timestamp" >= $2 AND "timestamp" <= $3
       ${houseId ? "AND house_id = $4" : ""} GROUP BY 1,2 ORDER BY 1,2`,
      params);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;
