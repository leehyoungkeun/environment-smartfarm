// src/services/diagnosisAgent.js
// L1 자동 진단 (2026-08-30) — CRITICAL 알림 발생 시 읽기 전용으로 증거를 모아
// 한국어 진단 보고서를 Discord 로 보낸다.
//
// 설계 원칙:
//   - **읽기 전용.** 어떤 조치도 실행하지 않는다 — 제어·수정은 사람(승인) 몫이다.
//   - 증거는 전부 이미 있는 것에서: DB(센서·릴레이·알림·제어이력) + RPi 헬스 HTTP.
//   - LLM(Gemini)은 **요약만** 한다. 실패하면 결정적(deterministic) 보고서로 폴백 —
//     진단 자체가 LLM 가용성에 의존하면 안 된다.
//   - 농장당 10분 쿨다운 + 동시 1건 — 알림 폭주가 진단 폭주(비용·소음)로 번지지 않게.
//   - 어떤 실패도 밖으로 던지지 않는다 — 진단은 부가 기능이지 알림 생성의 전제가 아니다.

import { pool } from "../db.js";
import logger from "../utils/logger.js";
import { getRpiBase } from "../routes/config.routes.js";

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";

const COOLDOWN_MS = 10 * 60 * 1000;
const lastRunAt = new Map(); // farmId → ts
let running = false;

export function _resetForTest() {
  lastRunAt.clear();
  running = false;
}

/** 쿨다운·동시성 게이트 — 실행해도 되면 true 를 반환하며 점유한다 */
export function shouldRun(farmId, now = Date.now()) {
  if (running) return false;
  const last = lastRunAt.get(farmId) || 0;
  if (now - last < COOLDOWN_MS) return false;
  lastRunAt.set(farmId, now);
  return true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 증거 수집 — 전부 읽기 전용, 항목별로 실패를 삼킨다 (부분 증거라도 보고)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function q(sql, params) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows;
  } catch (e) {
    return { error: e.message };
  }
}

export async function gatherEvidence(farmId) {
  const ev = { farmId, collectedAt: new Date().toISOString() };

  const [farm, sensor, relays, alerts, ctrlFail, lastCtrl] = await Promise.all([
    q(`SELECT name, status, last_seen_at FROM farms WHERE farm_id = $1`, [farmId]),
    q(
      `SELECT max(timestamp) AS last_at,
              EXTRACT(EPOCH FROM (now() - max(timestamp)))::int AS age_sec,
              count(*) FILTER (WHERE timestamp > now() - interval '1 hour')::int AS rows_1h
         FROM sensor_data
        WHERE farm_id = $1 AND timestamp > now() - interval '7 days'
          AND (metadata->>'quality') IS DISTINCT FROM 'simulated'`,
      [farmId]
    ),
    q(
      `SELECT unit_id, EXTRACT(EPOCH FROM (now() - updated_at))::int AS age_sec
         FROM relay_status WHERE farm_id = $1 ORDER BY unit_id`,
      [farmId]
    ),
    q(
      `SELECT alert_type, severity, message, timestamp
         FROM alerts
        WHERE farm_id = $1 AND acknowledged = false
          AND timestamp > now() - interval '24 hours'
          AND (metadata->>'deleted') IS DISTINCT FROM 'true'
        ORDER BY timestamp DESC LIMIT 10`,
      [farmId]
    ),
    q(
      `SELECT device_id, count(*)::int AS n, max(error) AS last_error
         FROM control_logs
        WHERE farm_id = $1 AND success = false AND timestamp > now() - interval '30 minutes'
        GROUP BY device_id ORDER BY n DESC LIMIT 5`,
      [farmId]
    ),
    q(
      `SELECT device_id, command, success, operator, timestamp
         FROM control_logs WHERE farm_id = $1
        ORDER BY timestamp DESC LIMIT 5`,
      [farmId]
    ),
  ]);

  ev.farm = Array.isArray(farm) ? farm[0] || null : farm;
  ev.sensor = Array.isArray(sensor) ? sensor[0] || null : sensor;
  ev.relays = relays;
  ev.unackAlerts = alerts;
  ev.controlFailures = ctrlFail;
  ev.recentControls = lastCtrl;

  // RPi 응답성 — Tailscale 경유 NR 헬스 (읽기 전용 GET, 4초 제한)
  try {
    const res = await fetch(`${getRpiBase(farmId)}/api/health`, {
      signal: AbortSignal.timeout(4000),
    });
    ev.rpi = res.ok ? { reachable: true, ...(await res.json()) } : { reachable: false, status: res.status };
  } catch (e) {
    ev.rpi = { reachable: false, error: e?.message || "unreachable" };
  }

  return ev;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 보고서 — 결정적 폴백이 기본, LLM 은 그 위의 요약
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const fmtAge = (sec) =>
  sec == null ? "기록 없음" : sec < 120 ? `${sec}초 전` : sec < 7200 ? `${Math.round(sec / 60)}분 전` : `${Math.round(sec / 3600)}시간 전`;

export function buildFallbackReport(alert, ev) {
  const L = [];
  L.push(`[알림] ${alert.alertType || "?"} (${alert.severity || "?"}) — ${alert.message || ""}`);
  if (ev.farm && !ev.farm.error) {
    L.push(`[농장] ${ev.farm.name || ev.farmId} (${ev.farm.status}) — 마지막 접속 ${fmtAge(ev.farm.last_seen_at ? Math.round((Date.now() - new Date(ev.farm.last_seen_at)) / 1000) : null)}`);
  }
  if (ev.sensor && !ev.sensor.error) {
    L.push(`[센서] 마지막 수신 ${fmtAge(ev.sensor.age_sec)} · 최근 1시간 ${ev.sensor.rows_1h ?? 0}행 (정상 ≈ 하우스당 60)`);
  }
  if (Array.isArray(ev.relays) && ev.relays.length) {
    L.push(`[릴레이] ` + ev.relays.map((r) => `unit${r.unit_id} ${fmtAge(r.age_sec)}`).join(", "));
  }
  L.push(`[RPi] ${ev.rpi?.reachable ? `응답함 (mode=${ev.rpi.mode || "?"}, serverOnline=${ev.rpi.serverOnline})` : `응답 없음 (${ev.rpi?.error || ev.rpi?.status || "?"})`}`);
  if (Array.isArray(ev.controlFailures) && ev.controlFailures.length) {
    L.push(`[제어실패 30분] ` + ev.controlFailures.map((c) => `${c.device_id}×${c.n}`).join(", ") + (ev.controlFailures[0].last_error ? ` (${ev.controlFailures[0].last_error})` : ""));
  }
  if (Array.isArray(ev.unackAlerts) && ev.unackAlerts.length) {
    L.push(`[미확인 알림 24h] ${ev.unackAlerts.length}건 — ` + ev.unackAlerts.slice(0, 3).map((a) => a.alert_type).join(", "));
  }
  return L.join("\n");
}

async function summarizeWithGemini(alert, ev) {
  const prompt = `너는 스마트팜 시스템의 1차 장애 진단자다. 아래 JSON 증거만 사용해서 진단하라.
규칙: 증거에 없는 것은 추측하지 말 것. 조치를 실행했다고 말하지 말 것 (너는 읽기만 했다).
형식 (한국어, 8줄 이내):
① 상황 요약 1줄
② 확인된 사실 2~3줄 (증거 인용)
③ 가장 유력한 원인 1줄
④ 사람이 확인할 것 1~2줄

발생 알림: ${alert.alertType} (${alert.severity}) — ${alert.message}
증거 JSON:
${JSON.stringify(ev).slice(0, 6000)}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("");
  if (!text) throw new Error("빈 응답");
  return text;
}

async function postDiscord(alert, report, usedLLM) {
  if (!DISCORD_WEBHOOK) return;
  const body = {
    embeds: [
      {
        title: `🔍 자동 진단 — ${alert.farmId}`,
        description: report.slice(0, 3800),
        color: 0x3498db,
        footer: { text: `트리거: ${alert.alertType} · ${usedLLM ? "Gemini 요약" : "기본 보고서"} · 읽기 전용 진단` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
  const res = await fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: Buffer.from(JSON.stringify(body), "utf-8"),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) logger.warn(`[진단] Discord 전송 실패 (${res.status})`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 진입점 — Alert.create 가 CRITICAL 일 때 부른다 (비동기, 실패 무해)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function runDiagnosis(alert) {
  // 테스트에서는 돌지 않는다 — DB 테스트가 CRITICAL 을 만들 때마다 진단이 따라 돌면
  // RPi 프로브 대기·로그 소음이 생긴다. 진단 함수 자체는 유닛 테스트가 직접 부른다.
  if (process.env.NODE_ENV === "test") return;
  const farmId = alert?.farmId;
  if (!farmId) return;
  if (!shouldRun(farmId)) {
    logger.info(`[진단] 스킵 (쿨다운/동시실행): ${farmId}`);
    return;
  }
  running = true;
  try {
    logger.info(`[진단] 시작: ${farmId} ← ${alert.alertType}`);
    const ev = await gatherEvidence(farmId);
    let report;
    let usedLLM = false;
    try {
      if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY 없음");
      report = await summarizeWithGemini(alert, ev);
      usedLLM = true;
    } catch (e) {
      logger.warn(`[진단] LLM 요약 실패 (${e.message}) — 기본 보고서로 폴백`);
      report = buildFallbackReport(alert, ev);
    }
    await postDiscord(alert, report, usedLLM);
    logger.info(`[진단] 완료: ${farmId} (LLM=${usedLLM})`);
  } catch (e) {
    logger.error(`[진단] 실패: ${farmId} — ${e.message}`);
  } finally {
    running = false;
  }
}
