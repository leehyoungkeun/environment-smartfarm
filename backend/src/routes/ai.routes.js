// src/routes/ai.routes.js
// AI 기능 API - 병해충 진단, 생육 예측, 작업 추천, 농업 상담
// 무료/로컬 모델 우선: Ollama (llava, llama3) 지원 + OpenAI/Claude 옵션

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.middleware.js";
import logger from "../utils/logger.js";

const router = express.Router();

// ━━━ AI 프로바이더 설정 ━━━
const AI_CONFIG = {
  provider: process.env.AI_PROVIDER || "ollama", // ollama | openai | claude | gemini | deepseek
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "llama3",
  ollamaVisionModel: process.env.OLLAMA_VISION_MODEL || "llava",
  openaiKey: process.env.OPENAI_API_KEY || "",
  claudeKey: process.env.CLAUDE_API_KEY || "",
  geminiKey: process.env.GEMINI_API_KEY || "",
  deepseekKey: process.env.DEEPSEEK_API_KEY || "",
};

// farmId 경로 탐색 방지
function sanitizeFarmId(farmId) {
  return (farmId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ━━━ 사진 업로드 설정 ━━━
const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads/ai";
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, sanitizeFarmId(req.params.farmId));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|heic/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype.split("/")[1]);
    if (ext || mime) {
      cb(null, true);
    } else {
      cb(new Error("이미지 파일만 업로드 가능합니다 (jpg, png, gif, webp)"));
    }
  },
});

// ━━━ AI 호출 공통 함수 ━━━
export async function callAI(prompt, options = {}) {
  const { image, systemPrompt, model } = options;

  // 모델 이름으로 프로바이더 자동 감지
  if (model?.startsWith("gemini-") && AI_CONFIG.geminiKey) {
    return callGemini(prompt, image, systemPrompt, model);
  }
  if (model?.startsWith("deepseek-") && AI_CONFIG.deepseekKey) {
    return callDeepSeek(prompt, systemPrompt, model);
  }

  // 비전(이미지)이 있으면 Gemini 우선, 텍스트는 DeepSeek 우선
  if (image && AI_CONFIG.geminiKey) {
    return callGemini(prompt, image, systemPrompt);
  }
  if (!image && AI_CONFIG.deepseekKey) {
    return callDeepSeek(prompt, systemPrompt);
  }

  if (AI_CONFIG.provider === "ollama") {
    return callOllama(prompt, image, systemPrompt, model);
  } else if (AI_CONFIG.provider === "openai") {
    return callOpenAI(prompt, image, systemPrompt);
  } else if (AI_CONFIG.provider === "claude") {
    return callClaude(prompt, image, systemPrompt);
  } else if (AI_CONFIG.provider === "gemini") {
    return callGemini(prompt, image, systemPrompt);
  } else if (AI_CONFIG.provider === "deepseek") {
    return callDeepSeek(prompt, systemPrompt);
  }
  throw new Error("지원하지 않는 AI 프로바이더입니다");
}

// ━━━ DeepSeek 호출 (OpenAI 호환 API) ━━━
async function callDeepSeek(prompt, systemPrompt, model = "deepseek-chat") {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_CONFIG.deepseekKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 8192,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API 오류 (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

// ━━━ Ollama 호출 ━━━
async function callOllama(prompt, imagePath, systemPrompt, overrideModel) {
  const model = overrideModel || (imagePath ? AI_CONFIG.ollamaVisionModel : AI_CONFIG.ollamaModel);
  const body = {
    model,
    prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
    stream: false,
  };
  if (imagePath) {
    const imgBuf = fs.readFileSync(imagePath);
    body.images = [imgBuf.toString("base64")];
  }
  const res = await fetch(`${AI_CONFIG.ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama 오류: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.response;
}

// ━━━ OpenAI 호출 ━━━
async function callOpenAI(prompt, imagePath, systemPrompt) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  const userContent = [{ type: "text", text: prompt }];
  if (imagePath) {
    const imgBuf = fs.readFileSync(imagePath);
    userContent.push({
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${imgBuf.toString("base64")}` },
    });
  }
  messages.push({ role: "user", content: userContent });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_CONFIG.openaiKey}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, max_tokens: 2000 }),
  });
  if (!res.ok) throw new Error(`OpenAI 오류: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// ━━━ Claude 호출 ━━━
async function callClaude(prompt, imagePath, systemPrompt) {
  const content = [{ type: "text", text: prompt }];
  if (imagePath) {
    const imgBuf = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mediaType = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : "image/jpeg";
    content.unshift({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: imgBuf.toString("base64") },
    });
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": AI_CONFIG.claudeKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: systemPrompt || "",
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`Claude 오류: ${res.status}`);
  const data = await res.json();
  return data.content[0].text;
}

// ━━━ Google Gemini 호출 ━━━
async function callGemini(prompt, imagePath, systemPrompt, overrideModel) {
  const model = overrideModel || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${AI_CONFIG.geminiKey}`;

  const parts = [];
  if (systemPrompt) parts.push({ text: systemPrompt + "\n\n" });
  parts.push({ text: prompt });

  if (imagePath) {
    const imgBuf = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : "image/jpeg";
    parts.push({ inline_data: { mime_type: mimeType, data: imgBuf.toString("base64") } });
  }

  const reqBody = {
    contents: [{ parts }],
    generationConfig: { maxOutputTokens: 8192 },
  };
  // 2.5 모델은 thinking을 끄면 훨씬 빠름
  if (model.includes("2.5")) {
    reqBody.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini 오류: ${res.status} - ${err}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "응답을 생성하지 못했습니다.";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. 병해충 사진 분석
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PEST_SYSTEM_PROMPT = `당신은 농업 병해충 전문가입니다. 
작물 사진을 분석하여 다음 형식으로 JSON 응답해주세요:
{
  "diagnosis": "진단명 (병명 또는 해충명)",
  "confidence": "높음/중간/낮음",
  "symptoms": ["증상1", "증상2"],
  "cause": "원인 설명",
  "treatment": ["방제법1", "방제법2", "방제법3"],
  "prevention": ["예방법1", "예방법2"],
  "urgency": "긴급/주의/관찰",
  "additionalInfo": "추가 참고 사항"
}
JSON만 출력하세요. 다른 텍스트 없이 JSON만 응답하세요.`;

// ━━━ 모델 목록 (Ollama + Gemini) ━━━
router.get("/models", authenticate, async (req, res) => {
  const models = [];
  // Ollama 로컬 모델
  try {
    const r = await fetch(`${AI_CONFIG.ollamaUrl}/api/tags`);
    if (r.ok) {
      const data = await r.json();
      (data.models || []).forEach(m => models.push({
        name: m.name, provider: "ollama",
        details: { parameter_size: m.details?.parameter_size, quantization_level: m.details?.quantization_level },
      }));
    }
  } catch {}
  // Gemini 클라우드 모델
  if (AI_CONFIG.geminiKey) {
    models.push(
      { name: "gemini-2.5-flash", provider: "gemini", details: { parameter_size: "클라우드", desc: "빠르고 무료" } },
      { name: "gemini-2.5-pro", provider: "gemini", details: { parameter_size: "클라우드", desc: "고성능" } },
    );
  }
  res.json({ success: true, data: { models, defaultModel: AI_CONFIG.geminiKey ? "gemini-2.5-flash" : AI_CONFIG.ollamaModel } });
});

router.post("/:farmId/pest-analysis", authenticate, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "사진을 업로드해주세요" });

    const { cropName, symptoms } = req.body;
    let prompt = "이 작물 사진을 분석하여 병해충을 진단해주세요.";
    if (cropName) prompt += ` 작물: ${cropName}.`;
    if (symptoms) prompt += ` 증상: ${symptoms}.`;

    const result = await callAI(prompt, {
      image: req.file.path,
      systemPrompt: PEST_SYSTEM_PROMPT,
    });

    let parsed;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result);
    } catch {
      parsed = { diagnosis: "분석 결과", raw: result };
    }

    const photoPath = `/${req.file.path.replace(/\\/g, "/")}`;

    res.json({ success: true, data: { ...parsed, photoPath } });
  } catch (error) {
    logger.error("병해충 분석 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 분석 이력 조회 (현재 DB 테이블 미구현 — 빈 배열 반환)
router.get("/:farmId/pest-analysis", authenticate, async (req, res) => {
  res.json({ success: true, data: [] });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 생육 예측
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const GROWTH_SYSTEM_PROMPT = `당신은 작물 생육 전문가입니다.
센서 데이터와 재배 정보를 분석하여 다음 형식으로 JSON 응답해주세요:
{
  "currentStage": "현재 생육 단계",
  "healthScore": 0-100,
  "estimatedHarvestDate": "예상 수확일 (YYYY-MM-DD)",
  "daysToHarvest": 숫자,
  "growthRate": "빠름/보통/느림",
  "riskFactors": ["위험요소1", "위험요소2"],
  "recommendations": ["권장사항1", "권장사항2"],
  "optimalConditions": {
    "temperature": "적정 온도 범위",
    "humidity": "적정 습도 범위"
  }
}
JSON만 출력하세요.`;

router.post("/:farmId/growth-prediction", authenticate, async (req, res) => {
  try {
    const { cropName, plantingDate, growthStage } = req.body;

    // 최근 센서 데이터 조회 (TimescaleDB JSONB 스키마)
    let sensorRows = [];
    try {
      sensorRows = await prisma.$queryRaw`
        SELECT data FROM sensor_data
        WHERE farm_id = ${req.params.farmId} AND timestamp > NOW() - INTERVAL '7 days'
        ORDER BY timestamp DESC LIMIT 100
      `;
    } catch (e) { logger.warn("센서 데이터 조회 실패 (생육예측):", e.message); }

    // JSONB 데이터를 센서별로 집계
    const sensorAgg = {};
    for (const row of sensorRows) {
      if (!row.data) continue;
      for (const [key, val] of Object.entries(row.data)) {
        if (typeof val !== "number") continue;
        if (!sensorAgg[key]) sensorAgg[key] = { sum: 0, min: val, max: val, count: 0 };
        sensorAgg[key].sum += val;
        sensorAgg[key].min = Math.min(sensorAgg[key].min, val);
        sensorAgg[key].max = Math.max(sensorAgg[key].max, val);
        sensorAgg[key].count++;
      }
    }

    // 최근 영농일지 요약
    let journals = [];
    try {
      journals = await prisma.farmJournal.findMany({
        where: { farmId: req.params.farmId },
        orderBy: { date: "desc" },
        take: 5,
        select: { date: true, workType: true, content: true },
      });
    } catch (e) { logger.warn("영농일지 조회 실패 (생육예측):", e.message); }

    const sensorSummary = Object.keys(sensorAgg).length > 0
      ? Object.entries(sensorAgg).map(([key, s]) => `${key}: 평균 ${(s.sum / s.count).toFixed(1)}, 최저 ${s.min.toFixed(1)}, 최고 ${s.max.toFixed(1)}`).join("\n")
      : "센서 데이터 없음";

    const journalSummary = journals.length > 0
      ? journals.map(j => `${j.date}: ${j.workType} - ${j.content}`).join("\n")
      : "영농일지 없음";

    const prompt = `작물: ${cropName || "미지정"}
정식일: ${plantingDate || "미지정"}
현재 생육단계: ${growthStage || "미지정"}
현재 날짜: ${new Date().toISOString().split("T")[0]}

[최근 7일 센서 데이터]
${sensorSummary}

[최근 영농일지]
${journalSummary}

위 정보를 바탕으로 생육 상태를 분석하고 수확 시기를 예측해주세요.`;

    const result = await callAI(prompt, { systemPrompt: GROWTH_SYSTEM_PROMPT });

    let parsed;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result);
    } catch {
      parsed = { currentStage: "분석 결과", raw: result };
    }

    res.json({ success: true, data: parsed });
  } catch (error) {
    logger.error("생육 예측 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. AI 작업 추천
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const TASK_SYSTEM_PROMPT = `당신은 스마트팜 작업 관리 전문가입니다.
현재 환경 데이터, 영농일지, 재배 상황을 분석하여 오늘 해야 할 작업을 추천해주세요.
다음 형식으로 JSON 응답해주세요:
{
  "date": "오늘 날짜",
  "weather_summary": "현재 환경 요약",
  "tasks": [
    {
      "priority": "높음/중간/낮음",
      "category": "관수/시비/방제/수확/관리/점검",
      "title": "작업 제목",
      "description": "상세 설명",
      "reason": "추천 이유",
      "timing": "추천 시간대"
    }
  ],
  "alerts": ["주의사항1", "주의사항2"],
  "weeklyOutlook": "이번 주 전망"
}
JSON만 출력하세요.`;

router.get("/:farmId/task-recommendation", authenticate, async (req, res) => {
  try {
    // 최근 센서 데이터 (TimescaleDB JSONB 스키마)
    let latestSensorRow = null;
    try {
      const rows = await prisma.$queryRaw`
        SELECT data FROM sensor_data
        WHERE farm_id = ${req.params.farmId} AND timestamp > NOW() - INTERVAL '1 hour'
        ORDER BY timestamp DESC LIMIT 1
      `;
      latestSensorRow = rows[0]?.data || null;
    } catch (e) { logger.warn("센서 데이터 조회 실패 (작업추천):", e.message); }

    // 최근 영농일지
    let journals = [];
    try {
      journals = await prisma.farmJournal.findMany({
        where: { farmId: req.params.farmId },
        orderBy: { date: "desc" },
        take: 10,
        select: { date: true, workType: true, content: true, pest: true, notes: true },
      });
    } catch (e) { logger.warn("영농일지 조회 실패 (작업추천):", e.message); }

    // 최근 투입물
    let inputs = [];
    try {
      inputs = await prisma.inputRecord.findMany({
        where: { farmId: req.params.farmId },
        orderBy: { date: "desc" },
        take: 5,
        select: { date: true, inputType: true, productName: true, quantity: true, unit: true },
      });
    } catch (e) { logger.warn("투입물 조회 실패 (작업추천):", e.message); }

    const currentSensors = latestSensorRow
      ? Object.entries(latestSensorRow).map(([k, v]) => `${k}: ${v}`).join(", ")
      : "센서 데이터 없음";

    const recentWork = journals.length > 0
      ? journals.map(j => `${j.date}: [${j.workType}] ${j.content}${j.pest ? ` (병해충: ${j.pest})` : ""}`).join("\n")
      : "영농일지 없음";

    const recentInputs = inputs.length > 0
      ? inputs.map(i => `${i.date}: ${i.inputType} - ${i.productName} ${i.quantity}${i.unit}`).join("\n")
      : "투입물 기록 없음";

    const prompt = `오늘 날짜: ${new Date().toISOString().split("T")[0]}

[현재 센서 데이터]
${currentSensors}

[최근 영농일지]
${recentWork}

[최근 투입물]
${recentInputs}

위 정보를 분석하여 오늘 해야 할 작업을 우선순위별로 추천해주세요.`;

    const result = await callAI(prompt, { systemPrompt: TASK_SYSTEM_PROMPT });

    let parsed;
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result);
    } catch {
      parsed = { tasks: [], raw: result };
    }

    res.json({ success: true, data: parsed });
  } catch (error) {
    logger.error("작업 추천 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. AI 농업 상담 (채팅)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CHAT_SYSTEM_PROMPT = `당신은 한국 시설원예 전문 AI 상담사입니다.
- 토마토, 딸기, 고추, 상추 등 시설작물 전문
- 병해충, 생육, 토양, 시비, 환경 제어 답변
- 답변은 3~5문장으로 간결하게, 핵심만 전달
- 구체적 수치/시기 포함 (예: "25~28°C 유지", "정식 후 30일")
- 농업과 무관한 질문은 정중히 거절
- 한국어로만 답변`;

router.post("/:farmId/chat", authenticate, async (req, res) => {
  try {
    const { message, context, model } = req.body;
    if (!message) return res.status(400).json({ success: false, error: "메시지를 입력해주세요" });

    let enrichedPrompt = message;

    // 컨텍스트가 있으면 추가 (이전 대화 등)
    if (context) {
      enrichedPrompt = `[이전 대화 컨텍스트]\n${context}\n\n[사용자 질문]\n${message}`;
    }

    const result = await callAI(enrichedPrompt, { systemPrompt: CHAT_SYSTEM_PROMPT, model });

    res.json({ success: true, data: { reply: result, timestamp: new Date() } });
  } catch (error) {
    logger.error("AI 상담 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ━━━ AI 설정 조회 ━━━
router.get("/config", authenticate, (req, res) => {
  res.json({
    success: true,
    data: {
      provider: AI_CONFIG.provider,
      ollamaUrl: AI_CONFIG.ollamaUrl,
      ollamaModel: AI_CONFIG.ollamaModel,
      ollamaVisionModel: AI_CONFIG.ollamaVisionModel,
      hasOpenAI: !!AI_CONFIG.openaiKey,
      hasClaude: !!AI_CONFIG.claudeKey,
      hasGemini: !!AI_CONFIG.geminiKey,
    },
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 영농일지 자유 텍스트 → 구조화 (음성/메모 → 폼 자동 채움)
// 농민이 자연어로 적은 일지를 분류된 필드로 구조화. 빈칸은 null.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function buildJournalParseSystemPrompt(hints) {
  const houses = (hints?.houses || []).map(h => `${h.houseId}:${h.houseName || h.houseId}`).join(", ") || "(없음)";
  const workTypes = (hints?.workTypes || []).join(", ") || "관찰, 관수, 시비, 방제, 정식, 수확, 관리, 기타";
  const weather = (hints?.weatherOptions || []).join(", ") || "맑음, 흐림, 비, 눈, 안개, 바람";
  const growth = (hints?.growthStages || []).join(", ") || "발아, 영양생장, 생식생장, 개화, 착과, 비대, 성숙, 수확";

  return `당신은 한국 농가 영농일지 보조 AI 입니다.
농민이 자유롭게 말한/쓴 텍스트를 영농일지 폼 필드로 구조화하는 게 임무입니다.

다음 JSON 스키마로만 응답하세요. 텍스트에서 추론할 수 없는 필드는 null 로 두세요. 임의로 만들지 마세요.

{
  "houseId": "텍스트의 하우스 언급에 가장 가까운 houseId, 없으면 null",
  "workType": "다음 중 하나 또는 null: ${workTypes}",
  "weather": "다음 중 하나 또는 null: ${weather}",
  "growthStage": "다음 중 하나 또는 null: ${growth}",
  "tempMin": "최저온도(℃ 숫자) 또는 null",
  "tempMax": "최고온도(℃ 숫자) 또는 null",
  "humidity": "습도(% 숫자) 또는 null",
  "content": "정제된 작업 내용(원문에서 군더더기 제거, 한국어 자연스러운 1~3문장)",
  "pest": "발견된 병해충 (없으면 null)",
  "notes": "특이사항/메모 (없으면 null)",
  "tags": ["#기호 없는 짧은 단어 1~5개. 예: 방제, 수확, 황화, 곁순정리, 양액. 없으면 빈 배열 []"],
  "measurements": {
    "plantHeight": "초장 cm 숫자 또는 null. 예: '초장 25cm' / '키가 30센치' → 25 또는 30",
    "leafCount": "엽수(잎 개수) 또는 null. 예: '잎 12장'",
    "floweringRate": "개화율 % 또는 null. 예: '개화 60%'",
    "fruitSetRate": "착과율 % 또는 null. 예: '착과 80%'"
  },
  "confidence": {
    "houseId": "high|medium|low|null",
    "workType": "high|medium|low|null",
    "_other_fields_too": "..."
  }
}

참고할 하우스 목록 (houseId:이름): ${houses}

규칙:
- 사용자가 명시적으로 말한 값만 채우세요. 추측 금지.
- "1번 하우스" / "1동" → 가능한 houseId 매칭, 모호하면 null + low confidence.
- 작업 내용(content)은 원문 보존하되 "어 그러니까" 같은 발화 군더더기 제거.
- JSON 만 출력. 다른 텍스트, 마크다운 코드블록(\`\`\`) 금지.`;
}

function safeJsonParse(text) {
  if (!text) return null;
  let s = String(text).trim();
  // ```json ... ``` 또는 ``` ... ``` 제거
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // 첫 { 부터 마지막 } 까지 추출
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try { return JSON.parse(s); } catch { return null; }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 영농일지 사진 분석 — 사진 1장 → 작목/생육/병해충/관찰 자동 추론
// 농민이 사진만 찍어도 일지 폼이 자동으로 채워지는 흐름.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const JOURNAL_PHOTO_DIR = process.env.UPLOAD_DIR_JOURNAL || "uploads/journal";

function buildJournalPhotoSystemPrompt(hints) {
  const workTypes = (hints?.workTypes || []).join(", ") || "관찰, 관수, 시비, 방제, 정식, 수확, 관리, 기타";
  const growth = (hints?.growthStages || []).join(", ") || "발아기, 생장기, 개화기, 착과기, 수확기";

  return `당신은 한국 농가 영농일지 보조 AI 입니다. 농가 사진 1 장을 보고 영농일지 폼 필드를 추론하세요.

다음 JSON 스키마로만 응답하세요. 사진에서 확실히 보이지 않는 필드는 null. 추측 금지.

{
  "cropName": "작목명 추정 (예: 토마토, 오이, 딸기, 상추) 또는 null",
  "growthStage": "${growth} 중 하나 또는 null",
  "workType": "사진에서 추정 가능한 작업 유형. ${workTypes} 중 하나 또는 null",
  "pest": "발견된 병/해충/이상 증상 (없으면 null). 예: '잎 황화 의심', '응애 흔적', '탄저병 초기'",
  "pestSeverity": "발견된 경우 정도 (경미/중간/심각/null)",
  "observation": "사진에서 관찰한 자연스러운 문장 1~3 문장 (한국어)",
  "leafColor": "잎 색상 상태 (정상/황화/갈변/얼룩 등) 또는 null",
  "diagnosis": "병해충 의심 시 진단명 후보 또는 null",
  "treatment": "병해충 발견 시 권장 대처 1~3 문장 (없으면 null)",
  "tags": ["#기호 없는 짧은 단어 1~5개. 사진 핵심 키워드 — 작목·병해명·작업·생육 단계 같은 검색 친화 단어. 예: 토마토, 황화, 탄저병, 곁순정리, 개화. 없으면 빈 배열 []"],
  "confidence": "전체 추론 신뢰도 high|medium|low"
}

규칙:
- 사진에 잎/줄기/과실이 명확히 보일 때만 작목/생육/병해충 추론.
- 흙바닥/구조물/사람만 보이면 cropName/growthStage/pest 모두 null.
- observation 은 사실 묘사만. "추측해보면..." 같은 말 금지.
- JSON 만 출력. 마크다운 코드블록(\`\`\`) 금지.`;
}

// 안전한 파일명 (path traversal 방지) — basename + 화이트리스트
function safePhotoFilename(name) {
  if (!name || typeof name !== "string") return null;
  const base = path.basename(name);
  // 영숫자/하이픈/밑줄/점만 허용. 빈 결과면 reject
  if (!/^[a-zA-Z0-9._-]+$/.test(base)) return null;
  return base;
}

router.post("/:farmId/journal/parse-photo", authenticate, async (req, res) => {
  const { filename, text, hints } = req.body || {};
  const safeName = safePhotoFilename(filename);
  if (!safeName) {
    return res.status(400).json({ success: false, error: "유효하지 않은 파일명" });
  }

  const farmDir = path.join(JOURNAL_PHOTO_DIR, sanitizeFarmId(req.params.farmId));
  const filePath = path.join(farmDir, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: "사진 파일을 찾을 수 없습니다" });
  }

  const systemPrompt = buildJournalPhotoSystemPrompt(hints);
  const userPrompt = text && typeof text === "string" && text.trim()
    ? `참고 텍스트: ${text.trim()}\n\n사진을 분석하여 JSON 으로 응답.`
    : "사진을 분석하여 JSON 으로 응답.";
  const model = AI_CONFIG.geminiKey ? "gemini-2.5-flash" : undefined;

  try {
    const raw = await callAI(userPrompt, { systemPrompt, image: filePath, model });
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== "object") {
      return res.json({ success: false, error: "AI 응답을 구조화하지 못했습니다", rawResponse: raw });
    }

    const str = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
    // tags 정규화 — 배열 + #제거 + 중복 제거 + max 10
    const tags = Array.isArray(parsed.tags)
      ? Array.from(new Set(parsed.tags.map((t) => String(t).trim().replace(/^#/, "")).filter(Boolean))).slice(0, 10)
      : [];
    const data = {
      cropName: str(parsed.cropName),
      growthStage: str(parsed.growthStage),
      workType: str(parsed.workType),
      pest: str(parsed.pest),
      pestSeverity: str(parsed.pestSeverity),
      observation: str(parsed.observation),
      leafColor: str(parsed.leafColor),
      diagnosis: str(parsed.diagnosis),
      treatment: str(parsed.treatment),
      tags,
      confidence: str(parsed.confidence) || "medium",
    };

    return res.json({ success: true, data });
  } catch (err) {
    logger.error("journal parse-photo 실패: " + err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/:farmId/journal/parse-text", authenticate, async (req, res) => {
  const { text, hints } = req.body || {};
  if (!text || typeof text !== "string" || text.trim().length < 2) {
    return res.status(400).json({ success: false, error: "텍스트가 비어있거나 너무 짧습니다" });
  }

  const systemPrompt = buildJournalParseSystemPrompt(hints);
  // Gemini 우선 — 한국어 + JSON 구조화에 강하고 비용 무료
  const model = AI_CONFIG.geminiKey ? "gemini-2.5-flash" : undefined;

  try {
    const raw = await callAI(text, { systemPrompt, model });
    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== "object") {
      return res.json({
        success: false,
        error: "AI 응답을 구조화하지 못했습니다",
        rawResponse: raw,
      });
    }

    // 안전 캐스팅: 숫자 필드는 number 또는 null
    const num = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const str = (v) => (v === null || v === undefined ? null : String(v).trim() || null);

    // tags 배열 정규화
    const tags = Array.isArray(parsed.tags)
      ? Array.from(new Set(parsed.tags.map((t) => String(t).trim().replace(/^#/, "")).filter(Boolean))).slice(0, 10)
      : [];

    // 측정 정규화 — 표준 4 필드만, null 가능
    const m = parsed.measurements && typeof parsed.measurements === "object" ? parsed.measurements : {};
    const measurements = {
      plantHeight: num(m.plantHeight),
      leafCount: num(m.leafCount),
      floweringRate: num(m.floweringRate),
      fruitSetRate: num(m.fruitSetRate),
    };
    // 모두 null 이면 빈 객체로
    const hasMeasure = Object.values(measurements).some((v) => v !== null);

    const data = {
      houseId: str(parsed.houseId),
      workType: str(parsed.workType),
      weather: str(parsed.weather),
      growthStage: str(parsed.growthStage),
      tempMin: num(parsed.tempMin),
      tempMax: num(parsed.tempMax),
      humidity: num(parsed.humidity),
      content: str(parsed.content),
      pest: str(parsed.pest),
      notes: str(parsed.notes),
      tags,
      measurements: hasMeasure ? measurements : null,
      confidence: parsed.confidence && typeof parsed.confidence === "object" ? parsed.confidence : {},
    };

    return res.json({ success: true, data });
  } catch (err) {
    logger.error("journal parse-text 실패: " + err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
