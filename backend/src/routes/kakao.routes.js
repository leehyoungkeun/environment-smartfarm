// src/routes/kakao.routes.js
// 카카오톡 챗봇 스킬 서버 (카카오 i 오픈빌더 연동)

import express from "express";
import crypto from "crypto";
import logger from "../utils/logger.js";
import { pool } from "../db.js";
import Alert from "../models/Alert.js";
import { gatherEvidence } from "../services/diagnosisAgent.js";

const router = express.Router();

// ━━━ 스킬 인증 (2026-08-29) ━━━
// 카카오 오픈빌더는 요청 서명(HMAC)을 지원하지 않는다 — 표준 해법은 스킬 URL 에
// 비밀 조각을 넣는 것이다. 이전에는 이 엔드포인트가 인터넷에 무인증으로 열려 있어
// 누구나 우리 API 키 비용으로 DeepSeek/Gemini 를 호출할 수 있었다.
// KAKAO_SKILL_SECRET 미설정이면 전부 거부한다 — 열린 기본값 금지.
const SKILL_SECRET = process.env.KAKAO_SKILL_SECRET || "";

function secretOk(given) {
  if (!SKILL_SECRET || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(SKILL_SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 간단 IP 레이트리밋 (분당 10회) — 시크릿이 새어도 과금에 상한을 둔다.
// 별도 저장소 없이 메모리 Map — 카카오 챗봇 트래픽 규모(단일 채널)에 충분하다.
const rateMap = new Map();
function rateLimited(ip) {
  if (rateMap.size > 500) rateMap.clear(); // 폭주 시 메모리 상한
  const now = Date.now();
  const recent = (rateMap.get(ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= 10) { rateMap.set(ip, recent); return true; }
  recent.push(now);
  rateMap.set(ip, recent);
  return false;
}

// ━━━ 농장 연동 (2단계, 2026-08-30) ━━━
// 오픈빌더 userRequest.user.id ↔ farm_id (kakao_links 테이블).
// 대화 상태(등록 코드 대기, 접수 증상 대기)는 메모리 — 단일 프로세스라 충분하고,
// 재시작하면 "농장 등록" 부터 다시 하면 된다 (연동 자체는 DB 라 유지).
const TEST_MODE = process.env.NODE_ENV === "test";

/** 테스트 전용 — 레이트리밋·대화 상태 초기화 (한 파일이 30+ 요청을 쏘면 자기 리밋에 걸린다) */
export function _resetKakaoStateForTest() {
  rateMap.clear();
  pendingState.clear();
  codeTries.clear();
}

/** 테스트 전용 — 레이트리밋만 초기화 (무차별 대입 테스트가 코드 시도 카운터는 유지해야) */
export function _resetKakaoRateForTest() {
  rateMap.clear();
}
const pendingState = new Map(); // kakaoUserId -> { mode: "await_code" | "await_report" }
const codeTries = new Map();    // kakaoUserId -> { n, resetAt } — 등록 코드 무차별 대입 방어

function codeGuard(uid) {
  const now = Date.now();
  let t = codeTries.get(uid);
  if (!t || now > t.resetAt) t = { n: 0, resetAt: now + 3600 * 1000 };
  t.n++;
  codeTries.set(uid, t);
  return t.n <= 5;
}

async function getLinkedFarm(kakaoUserId) {
  try {
    const { rows } = await pool.query(
      "SELECT k.farm_id, f.name FROM kakao_links k JOIN farms f ON f.farm_id = k.farm_id WHERE k.kakao_user_id = $1",
      [kakaoUserId]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

const fmtAge = (sec) =>
  sec == null ? "기록 없음" : sec < 120 ? `${sec}초 전` : sec < 7200 ? `${Math.round(sec / 60)}분 전` : `${Math.round(sec / 3600)}시간 전`;

/** 증거 -> LLM 프롬프트에 붙일 실시간 상태 요약 (짧게 — 토큰 비용) */
export function buildSnapshotText(ev) {
  const L = [];
  if (ev.sensor && !ev.sensor.error) L.push(`센서 마지막 수신: ${fmtAge(ev.sensor.age_sec)} (최근 1시간 ${ev.sensor.rows_1h ?? 0}행, 정상≈60)`);
  if (ev.latestValues) {
    const vals = Object.entries(ev.latestValues).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(", ");
    if (vals) L.push(`최신 측정값: ${vals}`);
  }
  L.push(`제어기(RPi): ${ev.rpi?.reachable ? "응답함" : "응답 없음"}`);
  if (Array.isArray(ev.controlFailures) && ev.controlFailures.length)
    L.push(`최근 30분 제어 실패: ${ev.controlFailures.map((c) => `${c.device_id}x${c.n}`).join(", ")}`);
  if (Array.isArray(ev.unackAlerts) && ev.unackAlerts.length)
    L.push(`미확인 알림 24시간: ${ev.unackAlerts.length}건 (${ev.unackAlerts.slice(0, 3).map((a) => a.alert_type).join(", ")})`);
  return L.join("\n");
}

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";

const SYSTEM_PROMPT = `당신은 "스마트그린" AI 상담사입니다. 두 가지를 담당합니다.

[1. 농업 상담] 한국 시설원예 전문 (토마토, 딸기, 고추, 상추 등)
- 병해충, 생육, 토양, 시비, 환경 제어, 보조사업 정보 제공
- 구체적 수치/시기 포함

[2. 스마트그린 제품 지원] 스마트그린 환경제어기·스마트팜 시스템 사용 고객의 장애·사용법 상담
- 제품 구성: 제어기(라즈베리파이) + 릴레이(측창/천창/팬/밸브 제어) + 온습도 센서 + 웹/키오스크 화면 + CCTV
- 흔한 증상별 1차 안내:
  · 화면에 값이 안 나옴/멈춤 → 제어기 전원과 인터넷 공유기를 껐다 켜고 2~3분 기다리기
  · 버튼을 눌러도 장치가 안 움직임 → 화면에서 해당 장치가 "수동" 모드인지 확인, 비상정지 상태 해제 확인
  · 인터넷이 끊김 → 현장 키오스크 화면에서는 제어 가능 (로컬 모드 안내 배너 확인)
  · 자동화가 이상하게 동작 → 자동화 규칙의 시간/온도 조건과 쿨다운 설정 확인
- 위 조치로 해결 안 되면: "관리자에게 전달해 드리겠습니다. 농장 이름과 증상을 남겨주세요" 라고 안내
- 전기 배선·기기 분해는 절대 안내하지 말 것 (감전 위험 — 반드시 관리자 방문 안내)

[공통]
- 답변은 3~5문장으로 간결하게, 핵심만 전달
- 위 두 범위 밖의 질문은 정중히 거절
- 한국어로만 답변`;

// DeepSeek 호출
async function askDeepSeek(message, snapshot = "") {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT + snapshot },
        { role: "user", content: message },
      ],
      max_tokens: 1024,
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "응답을 생성하지 못했습니다.";
}

// Gemini 폴백
async function askGemini(message, snapshot = "") {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: message }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT + snapshot }] },
        generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "응답을 생성하지 못했습니다.";
}

// ━━━ 카카오 스킬 엔드포인트 ━━━
// 카카오 오픈빌더는 POST로 요청, 특정 JSON 형식으로 응답해야 함
router.post("/chat/:secret", async (req, res) => {
  // 시크릿 불일치는 404 — 엔드포인트의 존재 자체를 드러내지 않는다
  if (!secretOk(req.params.secret)) return res.status(404).end();
  const ip = req.headers["cf-connecting-ip"] || req.ip || req.socket?.remoteAddress || "?";
  if (rateLimited(String(ip))) {
    logger.warn(`[카카오챗봇] 레이트리밋: ${ip}`);
    return res.json(kakaoResponse("요청이 많습니다. 잠시 후 다시 질문해주세요."));
  }
  try {
    let utterance = req.body?.userRequest?.utterance;
    if (utterance) utterance = String(utterance).slice(0, 500); // 발화 길이 상한 — 토큰 비용 상한
    if (!utterance) {
      return res.json(kakaoResponse("질문을 입력해주세요."));
    }

    logger.info(`[카카오챗봇] 질문: ${utterance}`);

    // ━━━ 농장 연동 대화 (2단계) ━━━
    const kakaoUserId = req.body?.userRequest?.user?.id || null;
    const cmd = utterance.trim();

    if (kakaoUserId) {
      const st = pendingState.get(kakaoUserId);

      if (cmd === "농장 등록" || cmd === "농장등록") {
        pendingState.set(kakaoUserId, { mode: "await_code" });
        return res.json(kakaoResponse("농장 등록 코드 6자리를 입력해 주세요.\n(설치 시 안내받은 코드 — 모르시면 관리자에게 문의)"));
      }
      if (cmd === "농장 해제" || cmd === "농장해제") {
        await pool.query("DELETE FROM kakao_links WHERE kakao_user_id = $1", [kakaoUserId]).catch(() => {});
        pendingState.delete(kakaoUserId);
        return res.json(kakaoResponse("농장 연동을 해제했습니다."));
      }

      if (st?.mode === "await_code") {
        pendingState.delete(kakaoUserId);
        if (!codeGuard(kakaoUserId)) {
          return res.json(kakaoResponse("시도 횟수를 초과했습니다. 1시간 후 '농장 등록' 으로 다시 시도해 주세요."));
        }
        const code = cmd.toUpperCase();
        const linkQ = await pool
          .query("SELECT farm_id, name FROM farms WHERE kakao_link_code = $1 AND status = 'active'", [code])
          .catch(() => ({ rows: [] }));
        if (!linkQ.rows[0]) {
          return res.json(kakaoResponse("코드가 올바르지 않습니다. '농장 등록' 을 입력해 다시 시도해 주세요."));
        }
        await pool.query(
          `INSERT INTO kakao_links (kakao_user_id, farm_id, linked_at) VALUES ($1, $2, now())
           ON CONFLICT (kakao_user_id) DO UPDATE SET farm_id = $2, linked_at = now()`,
          [kakaoUserId, linkQ.rows[0].farm_id]
        );
        logger.info(`[카카오챗봇] 농장 연동: ${linkQ.rows[0].farm_id}`);
        return res.json(kakaoResponse(`✅ '${linkQ.rows[0].name}' 농장이 연동되었습니다.\n이제 "지금 상태 어때?" 처럼 물어보시면 실시간 상태로 답해 드립니다.\n장애 접수는 '접수' 라고 입력해 주세요.`));
      }

      if (st?.mode === "await_report") {
        pendingState.delete(kakaoUserId);
        const link = await getLinkedFarm(kakaoUserId);
        if (link) {
          // 접수 -> 알림 생성 -> 기존 경로로 Discord 까지 자동 전달 (3단계)
          await Alert.create({
            farmId: link.farm_id,
            houseId: "FARM",
            alertType: "CUSTOMER_REPORT",
            severity: "WARNING",
            message: `[고객 접수] ${cmd}`,
            metadata: { source: "kakao", kakaoUserId },
          }).catch((e) => logger.error(`[카카오챗봇] 접수 저장 실패: ${e.message}`));
          return res.json(kakaoResponse("✅ 접수되었습니다. 관리자에게 바로 전달했습니다.\n확인 후 연락드리겠습니다."));
        }
        return res.json(kakaoResponse("농장 연동이 필요합니다. '농장 등록' 을 먼저 진행해 주세요."));
      }

      if (cmd === "접수") {
        const link = await getLinkedFarm(kakaoUserId);
        if (!link) return res.json(kakaoResponse("농장 연동 후 이용할 수 있습니다. '농장 등록' 을 입력해 주세요."));
        pendingState.set(kakaoUserId, { mode: "await_report" });
        return res.json(kakaoResponse("증상을 한 줄로 입력해 주세요. 그대로 관리자에게 전달됩니다."));
      }
    }

    // ━━━ 연동된 농장이면 실시간 상태를 프롬프트에 주입 ━━━
    let snapshot = "";
    if (kakaoUserId) {
      const link = await getLinkedFarm(kakaoUserId);
      if (link) {
        try {
          const ev = await gatherEvidence(link.farm_id, { rpiTimeoutMs: 2000 }); // 카카오 5초 예산
          snapshot = `\n\n[고객 농장 '${link.name}' 실시간 상태 — 상태·장애 질문이면 이 데이터를 근거로 답하라]\n` + buildSnapshotText(ev);
        } catch (e) {
          logger.warn(`[카카오챗봇] 상태 수집 실패 (${link.farm_id}): ${e.message}`);
        }
      }
    }

    let reply;
    if (TEST_MODE) {
      // 테스트는 실제 LLM 을 부르지 않는다 — 분기·형식만 검증
      return res.json(kakaoResponse(`(테스트 응답)${snapshot ? " [상태연동]" : ""}`));
    }
    try {
      reply = DEEPSEEK_KEY ? await askDeepSeek(utterance, snapshot) : await askGemini(utterance, snapshot);
    } catch (e1) {
      logger.warn(`[카카오챗봇] 1차 실패 (${e1.message}), 폴백 시도`);
      try {
        reply = GEMINI_KEY ? await askGemini(utterance, snapshot) : "AI 서비스에 일시적인 문제가 있습니다.";
      } catch (e2) {
        reply = "죄송합니다. 잠시 후 다시 질문해주세요.";
      }
    }

    // 카카오톡 말풍선 최대 1000자 제한
    if (reply.length > 990) {
      reply = reply.substring(0, 990) + "...";
    }

    logger.info(`[카카오챗봇] 응답: ${reply.substring(0, 100)}...`);
    res.json(kakaoResponse(reply));
  } catch (error) {
    logger.error("[카카오챗봇] 오류:", error);
    res.json(kakaoResponse("죄송합니다. 오류가 발생했습니다. 잠시 후 다시 시도해주세요."));
  }
});

// 카카오 오픈빌더 응답 형식
function kakaoResponse(text) {
  return {
    version: "2.0",
    template: {
      outputs: [
        {
          simpleText: {
            text,
          },
        },
      ],
    },
  };
}

// 옛 무인증 경로 — 404 로 잠금 (2026-08-29). 오픈빌더 URL 을 새 주소로 교체할 것.
router.post("/chat", (req, res) => res.status(404).end());

export default router;
