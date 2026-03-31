// src/routes/kakao.routes.js
// 카카오톡 챗봇 스킬 서버 (카카오 i 오픈빌더 연동)

import express from "express";
import logger from "../utils/logger.js";

const router = express.Router();

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
router.post("/chat", async (req, res) => {
  try {
    const utterance = req.body?.userRequest?.utterance;
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

export default router;
