// src/routes/kakao.routes.js
// 카카오톡 챗봇 스킬 서버 (카카오 i 오픈빌더 연동)

import express from "express";
import crypto from "crypto";
import logger from "../utils/logger.js";

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

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";

const SYSTEM_PROMPT = `당신은 "스마트그린" 농업 AI 상담사입니다.
- 한국 시설원예 전문 (토마토, 딸기, 고추, 상추 등)
- 병해충, 생육, 토양, 시비, 환경 제어, 보조사업 정보 제공
- 답변은 3~5문장으로 간결하게, 핵심만 전달
- 구체적 수치/시기 포함
- 농업과 무관한 질문은 정중히 거절
- 한국어로만 답변`;

// DeepSeek 호출
async function askDeepSeek(message) {
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
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
async function askGemini(message) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: message }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
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

    let reply;
    try {
      reply = DEEPSEEK_KEY ? await askDeepSeek(utterance) : await askGemini(utterance);
    } catch (e1) {
      logger.warn(`[카카오챗봇] 1차 실패 (${e1.message}), 폴백 시도`);
      try {
        reply = GEMINI_KEY ? await askGemini(utterance) : "AI 서비스에 일시적인 문제가 있습니다.";
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
