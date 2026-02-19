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
  provider: process.env.AI_PROVIDER || "ollama", // ollama | openai | claude
  ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "llama3",
  ollamaVisionModel: process.env.OLLAMA_VISION_MODEL || "llava",
  openaiKey: process.env.OPENAI_API_KEY || "",
  claudeKey: process.env.CLAUDE_API_KEY || "",
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
async function callAI(prompt, options = {}) {
  const { image, systemPrompt } = options;

  if (AI_CONFIG.provider === "ollama") {
    return callOllama(prompt, image, systemPrompt);
  } else if (AI_CONFIG.provider === "openai") {
    return callOpenAI(prompt, image, systemPrompt);
  } else if (AI_CONFIG.provider === "claude") {
    return callClaude(prompt, image, systemPrompt);
  }
  throw new Error("지원하지 않는 AI 프로바이더입니다");
}

// ━━━ Ollama 호출 ━━━
async function callOllama(prompt, imagePath, systemPrompt) {
  const model = imagePath ? AI_CONFIG.ollamaVisionModel : AI_CONFIG.ollamaModel;
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
const CHAT_SYSTEM_PROMPT = `당신은 친절하고 전문적인 농업 상담 AI입니다.
한국 농업 환경에 맞는 답변을 해주세요.
답변은 구체적이고 실용적으로 해주세요.
작물 재배, 병해충 관리, 토양 관리, 시비, 수확, 출하 등에 대해 답변할 수 있습니다.
가능하면 구체적인 수치와 시기를 포함해주세요.`;

router.post("/:farmId/chat", authenticate, async (req, res) => {
  try {
    const { message, context } = req.body;
    if (!message) return res.status(400).json({ success: false, error: "메시지를 입력해주세요" });

    let enrichedPrompt = message;

    // 컨텍스트가 있으면 추가 (이전 대화 등)
    if (context) {
      enrichedPrompt = `[이전 대화 컨텍스트]\n${context}\n\n[사용자 질문]\n${message}`;
    }

    const result = await callAI(enrichedPrompt, { systemPrompt: CHAT_SYSTEM_PROMPT });

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
    },
  });
});

export default router;
