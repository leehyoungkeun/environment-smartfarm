// src/routes/report.routes.js
// 일일/주간/월간 리포트 데이터 집계 API

import express from "express";
import { prisma, pool } from "../db.js";
import ControlLog from "../models/ControlLog.js";
import logger from "../utils/logger.js";

const router = express.Router();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GET /api/reports/:farmId — 리포트 데이터 집계
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.get("/:farmId", async (req, res) => {
  try {
    const { farmId } = req.params;
    const { type = "daily", date, houseId = "all" } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, error: "date 파라미터 필수 (YYYY-MM-DD)" });
    }

    // 기간 계산
    const endDate = new Date(date + "T23:59:59.999+09:00");
    let startDate;
    switch (type) {
      case "weekly":
        startDate = new Date(date + "T00:00:00+09:00");
        startDate.setDate(startDate.getDate() - 6);
        break;
      case "monthly":
        startDate = new Date(date + "T00:00:00+09:00");
        startDate.setDate(startDate.getDate() - 29);
        break;
      default: // daily
        startDate = new Date(date + "T00:00:00+09:00");
    }

    // 농장 정보
    const farm = await prisma.farm.findFirst({ where: { farmId } });
    if (!farm) {
      return res.status(404).json({ success: false, error: "농장을 찾을 수 없습니다" });
    }

    // 하우스 설정 (센서 이름/단위 매핑용)
    const houseConfigs = await prisma.houseConfig.findMany({
      where: { farmId },
      select: { houseId: true, houseName: true, sensors: true },
    });

    const houseFilter = houseId !== "all" ? houseId : null;

    // 6개 섹션 병렬 조회
    const [sensorRows, alertRows, alertTop5, controlStats, controlByDevice, controlByHour, journalData, connectionRows] = await Promise.all([
      // 1. 센서 집계
      pool.query(`
        SELECT house_id, key AS sensor_id,
          AVG(value::numeric) AS avg,
          MIN(value::numeric) AS min,
          MAX(value::numeric) AS max,
          COUNT(*)::int AS count
        FROM sensor_data, jsonb_each_text(data) AS kv(key, value)
        WHERE farm_id = $1 AND timestamp >= $2 AND timestamp <= $3
          AND value ~ '^-?[0-9]+(\\.[0-9]+)?$'
          ${houseFilter ? "AND house_id = $4" : ""}
        GROUP BY house_id, key
        ORDER BY house_id, key
      `, houseFilter ? [farmId, startDate, endDate, houseFilter] : [farmId, startDate, endDate]),

      // 2. 알림 요약
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE severity = 'CRITICAL')::int AS critical,
          COUNT(*) FILTER (WHERE severity = 'WARNING')::int AS warning,
          COUNT(*) FILTER (WHERE severity = 'INFO')::int AS info,
          COUNT(*) FILTER (WHERE acknowledged = true)::int AS acknowledged,
          COUNT(*) FILTER (WHERE acknowledged = false)::int AS unacknowledged
        FROM alerts
        WHERE farm_id = $1 AND timestamp >= $2 AND timestamp <= $3
          ${houseFilter ? "AND house_id = $4" : ""}
      `, houseFilter ? [farmId, startDate, endDate, houseFilter] : [farmId, startDate, endDate]),

      // 3. 알림 top5
      pool.query(`
        SELECT message, severity, house_id, timestamp
        FROM alerts
        WHERE farm_id = $1 AND timestamp >= $2 AND timestamp <= $3
          AND alert_type != 'NORMAL'
          ${houseFilter ? "AND house_id = $4" : ""}
        ORDER BY
          CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
          timestamp DESC
        LIMIT 5
      `, houseFilter ? [farmId, startDate, endDate, houseFilter] : [farmId, startDate, endDate]),

      // 4. 제어 통계
      ControlLog.getStats(farmId, startDate, houseFilter),

      // 5. 제어 장비별
      ControlLog.getStatsByDevice(farmId, startDate, houseFilter),

      // 6. 제어 시간대별
      ControlLog.getStatsByHour(farmId, startDate, houseFilter),

      // 7. 영농 요약 (journal + harvest + input)
      (async () => {
        const where = { farmId };
        const dateFilter = { gte: startDate, lte: endDate };
        where.date = dateFilter;

        const [journalCount, harvestRecords, inputRecords, workTypeStats] = await Promise.all([
          prisma.farmJournal.count({ where }),
          prisma.harvestRecord.findMany({ where, select: { quantity: true, totalRevenue: true, cropName: true } }),
          prisma.inputRecord.findMany({ where, select: { cost: true, inputType: true } }),
          prisma.farmJournal.groupBy({ by: ["workType"], where, _count: { id: true } }),
        ]);

        const totalHarvest = harvestRecords.reduce((s, r) => s + (r.quantity || 0), 0);
        const totalRevenue = harvestRecords.reduce((s, r) => s + (r.totalRevenue || 0), 0);
        const totalInputCost = inputRecords.reduce((s, r) => s + (r.cost || 0), 0);

        const inputByType = {};
        for (const r of inputRecords) {
          if (!inputByType[r.inputType]) inputByType[r.inputType] = 0;
          inputByType[r.inputType] += r.cost || 0;
        }

        return {
          journalCount,
          harvestCount: harvestRecords.length,
          inputCount: inputRecords.length,
          totalHarvest: Math.round(totalHarvest * 10) / 10,
          totalRevenue: Math.round(totalRevenue),
          totalInputCost: Math.round(totalInputCost),
          profit: Math.round(totalRevenue - totalInputCost),
          workTypeStats: workTypeStats.map(w => ({ workType: w.workType, count: w._count.id })),
          inputByType,
        };
      })(),

      // 8. 접속 현황
      pool.query(`
        SELECT
          DATE(timestamp) AS date,
          COUNT(*)::int AS count,
          COUNT(DISTINCT house_id)::int AS house_count
        FROM sensor_data
        WHERE farm_id = $1 AND timestamp >= $2 AND timestamp <= $3
          ${houseFilter ? "AND house_id = $4" : ""}
        GROUP BY DATE(timestamp)
        ORDER BY date
      `, houseFilter ? [farmId, startDate, endDate, houseFilter] : [farmId, startDate, endDate]),
    ]);

    // 센서 데이터를 하우스별로 그룹핑 + 센서명/단위 매핑
    const sensorMap = {};
    for (const row of sensorRows.rows) {
      if (!sensorMap[row.house_id]) sensorMap[row.house_id] = [];
      // 하우스 config에서 센서 이름/단위 찾기
      const hc = houseConfigs.find(h => h.houseId === row.house_id);
      const sensors = Array.isArray(hc?.sensors) ? hc.sensors : [];
      const sensorDef = sensors.find(s => (s.sensorId || s.id) === row.sensor_id);

      sensorMap[row.house_id].push({
        sensorId: row.sensor_id,
        name: sensorDef?.name || row.sensor_id,
        unit: sensorDef?.unit || "",
        avg: Math.round(parseFloat(row.avg) * 100) / 100,
        min: Math.round(parseFloat(row.min) * 100) / 100,
        max: Math.round(parseFloat(row.max) * 100) / 100,
        count: row.count,
      });
    }

    const sensorsResult = {
      houses: Object.entries(sensorMap).map(([hId, sensors]) => {
        const hc = houseConfigs.find(h => h.houseId === hId);
        return { houseId: hId, houseName: hc?.houseName || hId, sensors };
      }),
    };

    // 알림
    const aRow = alertRows.rows[0] || {};
    const alertsResult = {
      total: aRow.total || 0,
      bySeverity: { CRITICAL: aRow.critical || 0, WARNING: aRow.warning || 0, INFO: aRow.info || 0 },
      acknowledged: aRow.acknowledged || 0,
      unacknowledged: aRow.unacknowledged || 0,
      top5: alertTop5.rows.map(r => ({
        message: r.message,
        severity: r.severity,
        houseId: r.house_id,
        timestamp: r.timestamp,
      })),
    };

    // 제어
    const totalCmd = controlStats.totalCommands || 0;
    const controlsResult = {
      totalCommands: totalCmd,
      successCount: controlStats.successCount || 0,
      failCount: controlStats.failCount || 0,
      successRate: totalCmd > 0 ? Math.round((controlStats.successCount / totalCmd) * 1000) / 10 : 0,
      autoCount: controlStats.autoCount || 0,
      manualCount: controlStats.manualCount || 0,
      autoRatio: totalCmd > 0 ? Math.round((controlStats.autoCount / totalCmd) * 1000) / 10 : 0,
      byDevice: controlByDevice.map(d => ({
        deviceType: d._id.deviceType,
        command: d._id.command,
        count: d.count,
      })),
      byHour: controlByHour.map(h => ({ hour: h._id, count: h.count })),
    };

    // 접속 현황
    const connDaily = connectionRows.rows.map(r => ({
      date: r.date,
      count: r.count,
      houseCount: r.house_count,
    }));
    const totalDataPoints = connDaily.reduce((s, d) => s + d.count, 0);
    const days = connDaily.length || 1;
    const connectionResult = {
      totalDataPoints,
      dailyAvg: Math.round(totalDataPoints / days),
      days,
      daily: connDaily,
    };

    res.json({
      success: true,
      data: {
        meta: {
          farmId,
          farmName: farm.name,
          type,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          houseId: houseId,
          generatedAt: new Date().toISOString(),
        },
        sensors: sensorsResult,
        alerts: alertsResult,
        controls: controlsResult,
        journal: journalData,
        connection: connectionResult,
      },
    });
  } catch (error) {
    logger.error("리포트 생성 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
