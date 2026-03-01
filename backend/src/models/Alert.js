// src/models/Alert.js
// 알림 모델 - TimescaleDB (raw SQL) 버전

import { pool } from "../db.js";

function formatAlert(row) {
  if (!row) return null;
  const meta = row.metadata || {};
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
    metadata: meta,
    acknowledged: row.acknowledged,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: meta.acknowledgedBy || null,
    deleted: !!meta.deleted,
    deletedAt: meta.deletedAt || null,
    deletedBy: meta.deletedBy || null,
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

  async find(query = {}, { sort, limit, skip, includeDeleted } = {}) {
    let sql = "SELECT * FROM alerts WHERE 1=1";
    const params = [];
    let idx = 1;

    // 기본적으로 soft-delete된 알림 제외
    if (!includeDeleted) {
      sql += ` AND (metadata->>'deleted' IS NULL OR metadata->>'deleted' != 'true')`;
    }

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

  async acknowledge(id, resolution, source) {
    const meta = {};
    if (resolution) { meta.resolution = resolution; meta.resolvedAt = new Date().toISOString(); }
    if (source) { meta.acknowledgedBy = source; }

    let sql, params;
    if (Object.keys(meta).length > 0) {
      sql = `UPDATE alerts
               SET acknowledged = TRUE, acknowledged_at = NOW(),
                   metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
             WHERE id = $1 RETURNING *`;
      params = [id, JSON.stringify(meta)];
    } else {
      sql = `UPDATE alerts
               SET acknowledged = TRUE, acknowledged_at = NOW()
             WHERE id = $1 RETURNING *`;
      params = [id];
    }
    const result = await pool.query(sql, params);
    return formatAlert(result.rows[0]);
  },

  async updateResolution(id, resolution) {
    const result = await pool.query(
      `UPDATE alerts
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('resolution', $2::text, 'resolvedAt', NOW()::text)
       WHERE id = $1 RETURNING *`,
      [id, resolution]
    );
    return formatAlert(result.rows[0]);
  },

  async acknowledgeAll(farmId, houseId, source) {
    const meta = source ? JSON.stringify({ acknowledgedBy: source }) : null;
    let idx = 1;
    let sql = `UPDATE alerts
                 SET acknowledged = TRUE, acknowledged_at = NOW()`;
    const params = [];

    if (meta) {
      sql += `, metadata = COALESCE(metadata, '{}'::jsonb) || $${idx++}::jsonb`;
      params.push(meta);
    }

    sql += ` WHERE farm_id = $${idx++} AND acknowledged = FALSE`;
    params.push(farmId);

    // soft-delete된 건 제외
    sql += ` AND (metadata->>'deleted' IS NULL OR metadata->>'deleted' != 'true')`;

    if (houseId) {
      sql += ` AND house_id = $${idx++}`;
      params.push(houseId);
    }

    sql += " RETURNING *";
    const result = await pool.query(sql, params);
    return result.rows.map(formatAlert);
  },

  // soft-delete: DB에서 지우지 않고 metadata에 삭제 표시
  async deleteById(id, source) {
    const meta = {
      deleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: source || 'unknown',
    };
    const result = await pool.query(
      `UPDATE alerts
         SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
       WHERE id = $1 RETURNING *`,
      [id, JSON.stringify(meta)]
    );
    return formatAlert(result.rows[0]);
  },

  // 농장 전체 알림 soft-delete
  async deleteAllByFarm(farmId, houseId, source) {
    const meta = JSON.stringify({
      deleted: true,
      deletedAt: new Date().toISOString(),
      deletedBy: source || 'unknown',
    });
    let idx = 1;
    let sql = `UPDATE alerts
                 SET metadata = COALESCE(metadata, '{}'::jsonb) || $${idx++}::jsonb
               WHERE farm_id = $${idx++}`;
    const params = [meta, farmId];

    // 이미 삭제된 건 제외
    sql += ` AND (metadata->>'deleted' IS NULL OR metadata->>'deleted' != 'true')`;

    if (houseId) {
      sql += ` AND house_id = $${idx++}`;
      params.push(houseId);
    }

    sql += " RETURNING *";
    const result = await pool.query(sql, params);
    return result.rows.map(formatAlert);
  },

  async countDocuments(query = {}, { includeDeleted } = {}) {
    let sql = "SELECT COUNT(*)::int as count FROM alerts WHERE 1=1";
    const params = [];
    let idx = 1;

    if (!includeDeleted) {
      sql += ` AND (metadata->>'deleted' IS NULL OR metadata->>'deleted' != 'true')`;
    }

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
