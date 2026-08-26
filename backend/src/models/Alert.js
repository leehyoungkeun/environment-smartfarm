// src/models/Alert.js
// 알림 모델 - TimescaleDB (raw SQL) 버전

import { pool } from "../db.js";
import logger from "../utils/logger.js";

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Discord 전송
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Alertmanager 가 쓰는 것과 같은 채널·색상 규칙을 따른다 — 인프라 알림과
// 농장 알림을 한 곳에서 보게 하려는 것이다.
//
// INFO 는 보내지 않는다. 해소 통지·검증 기록 같은 것이 대부분이라
// 그것까지 보내면 정작 중요한 알림이 묻힌다.
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || "";
const NOTIFY_SEVERITIES = new Set(["WARNING", "CRITICAL"]);

const SEVERITY_STYLE = {
  CRITICAL: { emoji: "🔴", color: 0xed4245 },
  WARNING: { emoji: "🟡", color: 0xfee75c },
  INFO: { emoji: "ℹ️", color: 0x5865f2 },
};

const ALERT_TYPE_LABEL = {
  FARM_OFFLINE: "농장 오프라인",
  SENSOR_THRESHOLD: "센서 임계 이탈",
  DEVICE_FAILURE: "장비 고장",
  MAINTENANCE_EXPIRY: "유지보수 만료",
  CONTROL_FAILURE: "제어 실패",
  MODBUS_BUS_FAILURE: "Modbus 통신 장애",
};

// 실패해도 알림 생성 자체는 막지 않는다 — 전달은 부가 기능이지 전제가 아니다
async function notifyDiscord(alert) {
  if (!DISCORD_WEBHOOK) return;
  if (!NOTIFY_SEVERITIES.has(String(alert.severity || "").toUpperCase())) return;

  try {
    const sev = String(alert.severity || "WARNING").toUpperCase();
    const style = SEVERITY_STYLE[sev] || SEVERITY_STYLE.WARNING;
    const label = ALERT_TYPE_LABEL[alert.alertType] || alert.alertType;

    const fields = [
      { name: "농장", value: String(alert.farmId || "-"), inline: true },
      { name: "하우스", value: String(alert.houseId || "-"), inline: true },
      { name: "심각도", value: sev, inline: true },
    ];
    if (alert.sensorId) {
      fields.push({ name: "센서", value: String(alert.sensorId), inline: true });
    }
    if (alert.value != null && alert.threshold != null) {
      fields.push({
        name: "측정값 / 기준",
        value: `${alert.value} / ${alert.threshold}`,
        inline: true,
      });
    }

    const payload = {
      embeds: [
        {
          title: `${style.emoji} ${label}`,
          description: String(alert.message || "").slice(0, 3800),
          color: style.color,
          fields,
          footer: { text: "SmartFarm" },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const res = await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: Buffer.from(JSON.stringify(payload), "utf-8"),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn(`Discord 알림 전송 실패 (${res.status}): ${alert.alertType}`);
    }
  } catch (err) {
    logger.warn(`Discord 알림 전송 오류: ${err?.message}`);
  }
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
    const alert = formatAlert(result.rows[0]);

    // 전송이 느리거나 실패해도 알림 생성은 이미 끝났다 — 기다리지 않는다
    notifyDiscord(alert).catch(() => {});

    return alert;
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
