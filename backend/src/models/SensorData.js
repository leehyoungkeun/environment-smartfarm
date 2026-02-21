// src/models/SensorData.js
// 센서 데이터 모델 - TimescaleDB (raw SQL) 버전

import { pool } from "../db.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 응답 포맷 (MongoDB 호환)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatSensorData(row) {
  if (!row) return null;
  return {
    _id: `${row.farm_id}_${row.house_id}_${new Date(row.timestamp).getTime()}`,
    farmId: row.farm_id,
    houseId: row.house_id,
    timestamp: row.timestamp,
    data: row.data,
    metadata: row.metadata || {},
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SensorData 모델
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SensorData = {
  /**
   * 센서 데이터 저장
   * Mongoose의 new SensorData() + save() 패턴을 함수로 대체
   */
  async create(data) {
    const result = await pool.query(
      `INSERT INTO sensor_data (timestamp, farm_id, house_id, data, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (timestamp, farm_id, house_id) DO UPDATE
         SET data = EXCLUDED.data, metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        data.timestamp || new Date(),
        data.farmId,
        data.houseId,
        JSON.stringify(data.data),
        JSON.stringify(data.metadata || {}),
      ]
    );
    return formatSensorData(result.rows[0]);
  },

  /**
   * 배치 삽입
   */
  async bulkInsert(dataArray) {
    if (!dataArray || dataArray.length === 0) return [];

    // 단일 multi-row INSERT로 성능 최적화
    const values = [];
    const params = [];
    let idx = 1;

    for (const item of dataArray) {
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      params.push(
        item.timestamp || new Date(),
        item.farmId,
        item.houseId,
        JSON.stringify(item.data),
        JSON.stringify(item.metadata || {})
      );
    }

    const sql = `INSERT INTO sensor_data (timestamp, farm_id, house_id, data, metadata)
       VALUES ${values.join(", ")}
       ON CONFLICT (timestamp, farm_id, house_id) DO UPDATE
         SET data = EXCLUDED.data, metadata = EXCLUDED.metadata
       RETURNING *`;

    const result = await pool.query(sql, params);
    return result.rows.map(formatSensorData);
  },

  /**
   * 최신 센서 데이터 조회
   */
  async getLatest(farmId, houseId) {
    const result = await pool.query(
      `SELECT * FROM sensor_data
       WHERE farm_id = $1 AND house_id = $2
       ORDER BY timestamp DESC
       LIMIT 1`,
      [farmId, houseId]
    );
    return result.rows[0] ? formatSensorData(result.rows[0]) : null;
  },

  /**
   * 시간 범위 조회
   */
  async getTimeRange(farmId, houseId, startDate, endDate, limit) {
    let sql =
      "SELECT * FROM sensor_data WHERE farm_id = $1 AND house_id = $2";
    const params = [farmId, houseId];
    let idx = 3;

    if (startDate) {
      sql += ` AND timestamp >= $${idx++}`;
      params.push(new Date(startDate));
    }
    if (endDate) {
      sql += ` AND timestamp <= $${idx++}`;
      params.push(new Date(endDate));
    }

    sql += " ORDER BY timestamp DESC";

    if (limit) {
      sql += ` LIMIT $${idx++}`;
      params.push(limit);
    }

    const result = await pool.query(sql, params);
    return result.rows.map(formatSensorData);
  },

  /**
   * 시간 범위 내 데이터 건수 조회 (COUNT만 반환, 전체 row를 가져오지 않음)
   */
  async getCount(farmId, houseId, startDate, endDate) {
    let sql =
      "SELECT COUNT(*)::int AS count FROM sensor_data WHERE farm_id = $1 AND house_id = $2";
    const params = [farmId, houseId];
    let idx = 3;

    if (startDate) {
      sql += ` AND timestamp >= $${idx++}`;
      params.push(new Date(startDate));
    }
    if (endDate) {
      sql += ` AND timestamp <= $${idx++}`;
      params.push(new Date(endDate));
    }

    const result = await pool.query(sql, params);
    return result.rows[0]?.count || 0;
  },

  /**
   * 센서별 집계 통계
   */
  async getAggregated(farmId, houseId, sensorId, startDate, endDate, interval) {
    const bucket =
      interval === "day"
        ? "1 day"
        : interval === "minute"
          ? "1 minute"
          : "1 hour";

    let sql = `
      SELECT
        time_bucket($1::interval, timestamp) AS bucket,
        AVG((data->>$4)::numeric) AS avg,
        MIN((data->>$4)::numeric) AS min,
        MAX((data->>$4)::numeric) AS max,
        COUNT(*)::int AS count
      FROM sensor_data
      WHERE farm_id = $2 AND house_id = $3
        AND data ? $4
    `;
    const params = [bucket, farmId, houseId, sensorId];
    let idx = 5;

    if (startDate) {
      sql += ` AND timestamp >= $${idx++}`;
      params.push(new Date(startDate));
    }
    if (endDate) {
      sql += ` AND timestamp <= $${idx++}`;
      params.push(new Date(endDate));
    }

    sql += " GROUP BY bucket ORDER BY bucket DESC";

    const result = await pool.query(sql, params);
    return result.rows.map((r) => ({
      timestamp: r.bucket,
      avg: parseFloat(r.avg),
      min: parseFloat(r.min),
      max: parseFloat(r.max),
      count: r.count,
    }));
  },

  /**
   * find - Mongoose 호환 (sensors.js의 /data 엔드포인트용)
   */
  async find(query, { sort, limit } = {}) {
    let sql = "SELECT * FROM sensor_data WHERE 1=1";
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
    if (query.timestamp) {
      if (query.timestamp.$gte) {
        sql += ` AND timestamp >= $${idx++}`;
        params.push(query.timestamp.$gte);
      }
      if (query.timestamp.$lte) {
        sql += ` AND timestamp <= $${idx++}`;
        params.push(query.timestamp.$lte);
      }
    }

    sql += " ORDER BY timestamp DESC";

    if (limit) {
      sql += ` LIMIT $${idx++}`;
      params.push(limit);
    }

    const result = await pool.query(sql, params);
    return result.rows.map(formatSensorData);
  },

  /**
   * validateAgainstConfig - Mongoose 메서드 호환
   * 센서 데이터의 설정 대비 검증
   */
  validateAgainstConfig(data, config) {
    const errors = [];
    if (!config || !config.sensors) return errors;

    const sensors = Array.isArray(config.sensors) ? config.sensors : [];

    for (const sensor of sensors) {
      const value = data[sensor.sensorId];
      if (value === undefined) continue;

      if (sensor.type === "number") {
        if (typeof value !== "number") {
          errors.push(`${sensor.sensorId}: expected number, got ${typeof value}`);
        }
      }
    }
    return errors;
  },
};

export default SensorData;
