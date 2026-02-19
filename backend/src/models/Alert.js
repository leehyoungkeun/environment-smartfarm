// src/models/Alert.js
// 알림 모델 - TimescaleDB (raw SQL) 버전

import { pool } from "../db.js";

function formatAlert(row) {
  if (!row) return null;
  return {
    _id: row.id,
    farmId: row.farm_id,
    houseId: row.house_id,
    sensorId: row.sensor_id,
    alertType: row.alert_type,
    severity: row.severity,
    message: row.message,
    value: row.value,
    threshold: row.threshold,
    metadata: row.metadata || {},
    acknowledged: row.acknowledged,
    acknowledgedAt: row.acknowledged_at,
    createdAt: row.timestamp,
    timestamp: row.timestamp,
  };
}

const Alert = {
  async create(data) {
    const result = await pool.query(
      `INSERT INTO alerts
        (farm_id, house_id, sensor_id, alert_type, severity,
         message, value, threshold, metadata, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       RETURNING *`,
      [
        data.farmId,
        data.houseId,
        data.sensorId || null,
        data.alertType,
        data.severity || "WARNING",
        data.message || null,
        data.value || null,
        data.threshold || null,
        JSON.stringify(data.metadata || {}),
      ]
    );
    return formatAlert(result.rows[0]);
  },

  async find(query = {}, { sort, limit, skip } = {}) {
    let sql = "SELECT * FROM alerts WHERE 1=1";
    const params = [];
    let idx = 1;

    if (query.farmId) {
      sql += ` AND farm_id = $${idx++}`;
      params.push(query.farmId);
    }
    if (query.houseId) {
      sql += ` AND house_id = $${idx++}`;
      params.push(query.houseId);
    }
    if (query.acknowledged !== undefined) {
      sql += ` AND acknowledged = $${idx++}`;
      params.push(query.acknowledged);
    }

    sql += " ORDER BY timestamp DESC";

    if (limit) {
      sql += ` LIMIT $${idx++}`;
      params.push(limit);
    }
    if (skip) {
      sql += ` OFFSET $${idx++}`;
      params.push(skip);
    }

    const result = await pool.query(sql, params);
    return result.rows.map(formatAlert);
  },

  async findById(id) {
    const result = await pool.query(
      "SELECT * FROM alerts WHERE id = $1 LIMIT 1",
      [id]
    );
    return formatAlert(result.rows[0]);
  },

  async acknowledge(id) {
    const result = await pool.query(
      `UPDATE alerts
         SET acknowledged = TRUE, acknowledged_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    return formatAlert(result.rows[0]);
  },

  async acknowledgeAll(farmId, houseId) {
    let sql = `UPDATE alerts
                 SET acknowledged = TRUE, acknowledged_at = NOW()
               WHERE farm_id = $1 AND acknowledged = FALSE`;
    const params = [farmId];

    if (houseId) {
      sql += " AND house_id = $2";
      params.push(houseId);
    }

    sql += " RETURNING *";
    const result = await pool.query(sql, params);
    return result.rows.map(formatAlert);
  },

  async deleteById(id) {
    const result = await pool.query(
      "DELETE FROM alerts WHERE id = $1 RETURNING *",
      [id]
    );
    return formatAlert(result.rows[0]);
  },

  async countDocuments(query = {}) {
    let sql = "SELECT COUNT(*)::int as count FROM alerts WHERE 1=1";
    const params = [];
    let idx = 1;

    if (query.farmId) {
      sql += ` AND farm_id = $${idx++}`;
      params.push(query.farmId);
    }
    if (query.houseId) {
      sql += ` AND house_id = $${idx++}`;
      params.push(query.houseId);
    }
    if (query.acknowledged !== undefined) {
      sql += ` AND acknowledged = $${idx++}`;
      params.push(query.acknowledged);
    }

    const result = await pool.query(sql, params);
    return result.rows[0].count;
  },
};

export default Alert;
