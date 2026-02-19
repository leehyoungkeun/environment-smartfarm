// src/models/ControlLog.js
// 제어 이력 모델 - TimescaleDB (raw SQL) 버전
// API 응답 형태는 MongoDB 버전과 동일하게 유지

import { pool } from "../db.js";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 응답 포맷 (MongoDB 호환: snake_case → camelCase + _id)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function formatLog(row) {
  if (!row) return null;
  return {
    _id: row.id,
    farmId: row.farm_id,
    houseId: row.house_id,
    controlHouseId: row.control_house_id,
    deviceId: row.device_id,
    deviceType: row.device_type,
    deviceName: row.device_name,
    command: row.command,
    success: row.success,
    error: row.error,
    requestId: row.request_id,
    operator: row.operator,
    operatorName: row.operator_name,
    lambdaResponse: row.lambda_response,
    isAutomatic: row.is_automatic,
    automationRuleId: row.automation_rule_id,
    automationReason: row.automation_reason,
    createdAt: row.created_at || row.timestamp,
    updatedAt: row.created_at || row.timestamp,
    timestamp: row.timestamp,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ControlLog 모델
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ControlLog = {
  /**
   * 이력 저장 (Mongoose new + save 호환)
   */
  async create(data) {
    const result = await pool.query(
      `INSERT INTO control_logs
        (farm_id, house_id, control_house_id, device_id, device_type, device_name,
         command, success, error, request_id, operator, operator_name, lambda_response,
         is_automatic, automation_rule_id, automation_reason, timestamp, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
       RETURNING *`,
      [
        data.farmId,
        data.houseId,
        data.controlHouseId || data.houseId,
        data.deviceId,
        data.deviceType || "unknown",
        data.deviceName || data.deviceId,
        data.command,
        data.success !== false,
        data.error || null,
        data.requestId || null,
        data.operator || "web_dashboard",
        data.operatorName || null,
        data.lambdaResponse ? JSON.stringify(data.lambdaResponse) : null,
        data.isAutomatic || false,
        data.automationRuleId || null,
        data.automationReason || null,
      ]
    );
    return formatLog(result.rows[0]);
  },

  /**
   * 이력 조회 (필터 + 페이지네이션)
   */
  async find(query, { sort, skip, limit } = {}) {
    let sql = "SELECT * FROM control_logs WHERE 1=1";
    const params = [];
    let paramIdx = 1;

    if (query.farmId) {
      sql += ` AND farm_id = $${paramIdx++}`;
      params.push(query.farmId);
    }
    if (query.houseId) {
      sql += ` AND house_id = $${paramIdx++}`;
      params.push(query.houseId);
    }
    if (query.deviceId) {
      sql += ` AND device_id = $${paramIdx++}`;
      params.push(query.deviceId);
    }
    if (query.deviceType) {
      sql += ` AND device_type = $${paramIdx++}`;
      params.push(query.deviceType);
    }
    if (query.createdAt) {
      if (query.createdAt.$gte) {
        sql += ` AND created_at >= $${paramIdx++}`;
        params.push(query.createdAt.$gte);
      }
      if (query.createdAt.$lte) {
        sql += ` AND created_at <= $${paramIdx++}`;
        params.push(query.createdAt.$lte);
      }
      if (query.createdAt.$lt) {
        sql += ` AND created_at < $${paramIdx++}`;
        params.push(query.createdAt.$lt);
      }
    }

    // 정렬
    sql += " ORDER BY created_at DESC";

    // 페이지네이션
    if (skip !== undefined) {
      sql += ` OFFSET $${paramIdx++}`;
      params.push(skip);
    }
    if (limit !== undefined) {
      sql += ` LIMIT $${paramIdx++}`;
      params.push(limit);
    }

    const result = await pool.query(sql, params);
    return result.rows.map(formatLog);
  },

  /**
   * 건수 조회
   */
  async countDocuments(query) {
    let sql = "SELECT COUNT(*)::int as count FROM control_logs WHERE 1=1";
    const params = [];
    let paramIdx = 1;

    if (query.farmId) {
      sql += ` AND farm_id = $${paramIdx++}`;
      params.push(query.farmId);
    }
    if (query.houseId) {
      sql += ` AND house_id = $${paramIdx++}`;
      params.push(query.houseId);
    }
    if (query.deviceId) {
      sql += ` AND device_id = $${paramIdx++}`;
      params.push(query.deviceId);
    }
    if (query.deviceType) {
      sql += ` AND device_type = $${paramIdx++}`;
      params.push(query.deviceType);
    }
    if (query.createdAt) {
      if (query.createdAt.$gte) {
        sql += ` AND created_at >= $${paramIdx++}`;
        params.push(query.createdAt.$gte);
      }
      if (query.createdAt.$lte) {
        sql += ` AND created_at <= $${paramIdx++}`;
        params.push(query.createdAt.$lte);
      }
      if (query.createdAt.$lt) {
        sql += ` AND created_at < $${paramIdx++}`;
        params.push(query.createdAt.$lt);
      }
    }

    const result = await pool.query(sql, params);
    return result.rows[0].count;
  },

  /**
   * 통계 집계 (MongoDB aggregate 호환)
   */
  async aggregate(pipeline) {
    // 간단한 파이프라인 해석기 (control-logs.js의 stats용)
    // 복잡한 집계는 직접 SQL로 처리
    return [];
  },

  /**
   * 통계: 제어 요약 (farmId, startDate, houseId)
   */
  async getStats(farmId, startDate, houseId) {
    let sql = `
      SELECT
        COUNT(*)::int as "totalCommands",
        COUNT(*) FILTER (WHERE success = true)::int as "successCount",
        COUNT(*) FILTER (WHERE success = false)::int as "failCount",
        COUNT(*) FILTER (WHERE is_automatic = true)::int as "autoCount",
        COUNT(*) FILTER (WHERE is_automatic = false)::int as "manualCount"
      FROM control_logs
      WHERE farm_id = $1 AND created_at >= $2
    `;
    const params = [farmId, startDate];

    if (houseId) {
      sql += " AND house_id = $3";
      params.push(houseId);
    }

    const result = await pool.query(sql, params);
    return (
      result.rows[0] || {
        totalCommands: 0,
        successCount: 0,
        failCount: 0,
        autoCount: 0,
        manualCount: 0,
      }
    );
  },

  /**
   * 통계: 장치별 명령 분포
   */
  async getStatsByDevice(farmId, startDate, houseId) {
    let sql = `
      SELECT device_type as "deviceType", command, COUNT(*)::int as count
      FROM control_logs
      WHERE farm_id = $1 AND created_at >= $2
    `;
    const params = [farmId, startDate];

    if (houseId) {
      sql += " AND house_id = $3";
      params.push(houseId);
    }

    sql += " GROUP BY device_type, command ORDER BY count DESC";

    const result = await pool.query(sql, params);
    // MongoDB aggregate 형태로 변환
    return result.rows.map((r) => ({
      _id: { deviceType: r.deviceType, command: r.command },
      count: r.count,
    }));
  },

  /**
   * 통계: 시간대별 분포
   */
  async getStatsByHour(farmId, startDate, houseId) {
    let sql = `
      SELECT EXTRACT(HOUR FROM created_at)::int as hour, COUNT(*)::int as count
      FROM control_logs
      WHERE farm_id = $1 AND created_at >= $2
    `;
    const params = [farmId, startDate];

    if (houseId) {
      sql += " AND house_id = $3";
      params.push(houseId);
    }

    sql += " GROUP BY hour ORDER BY hour";

    const result = await pool.query(sql, params);
    return result.rows.map((r) => ({
      _id: r.hour,
      count: r.count,
    }));
  },

  /**
   * 삭제
   */
  async deleteMany(query) {
    let sql = "DELETE FROM control_logs WHERE 1=1";
    const params = [];
    let paramIdx = 1;

    if (query.farmId) {
      sql += ` AND farm_id = $${paramIdx++}`;
      params.push(query.farmId);
    }
    if (query.createdAt?.$lt) {
      sql += ` AND created_at < $${paramIdx++}`;
      params.push(query.createdAt.$lt);
    }

    const result = await pool.query(sql, params);
    return { deletedCount: result.rowCount };
  },
};

export default ControlLog;
