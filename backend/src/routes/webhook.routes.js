// src/routes/webhook.routes.js
// 외부 서비스 → Slack/Telegram 알람 변환 proxy
// 인증: URL query token (?token=xxx) — 환경변수 GLITCHTIP_SLACK_TOKEN 과 비교

import express from "express";
import logger from "../utils/logger.js";

const router = express.Router();

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL || "";
const TOKEN = process.env.GLITCHTIP_SLACK_TOKEN || "";
const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

function verifyToken(req, res, next) {
  if (!TOKEN) return res.status(503).json({ error: "GLITCHTIP_SLACK_TOKEN not configured" });
  if ((req.query.token || "") !== TOKEN) return res.status(401).json({ error: "invalid token" });
  next();
}

function verifyTokenSlack(req, res, next) {
  verifyToken(req, res, () => {
    if (!SLACK_WEBHOOK) return res.status(503).json({ error: "SLACK_WEBHOOK_URL not configured" });
    next();
  });
}

function verifyTokenTelegram(req, res, next) {
  verifyToken(req, res, () => {
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) {
      return res.status(503).json({ error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured" });
    }
    next();
  });
}

router.post("/glitchtip-to-slack", verifyTokenSlack, async (req, res) => {
  try {
    const body = req.body || {};
    const issue = body.issue || body.data?.issue || body;
    const title = issue.title || body.title || body.message || "GlitchTip alert";
    const culprit = issue.culprit || issue.metadata?.function || issue.metadata?.filename || "";
    const url = issue.web_url || body.web_url || "";
    const project = issue.project_name || body.project_name || body.project || "";
    const level = issue.level || body.level || "error";
    const count = issue.count || body.count || 1;

    const levelEmoji = { error: "🚨", warning: "⚠️", info: "ℹ️", debug: "🐛" }[level] || "🚨";

    const slackPayload = {
      text: `${levelEmoji} ${title}${project ? ` (${project})` : ""}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `${levelEmoji} *${title}*` },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*프로젝트:*\n${project || "—"}` },
            { type: "mrkdwn", text: `*레벨:*\n${level}` },
            { type: "mrkdwn", text: `*이벤트:*\n${count}` },
            ...(culprit ? [{ type: "mrkdwn", text: `*위치:*\n\`${String(culprit).slice(0, 80)}\`` }] : []),
          ],
        },
        ...(url ? [{
          type: "actions",
          elements: [{ type: "button", text: { type: "plain_text", text: "GlitchTip 에서 보기", emoji: true }, url }],
        }] : []),
      ],
    };

    const response = await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: Buffer.from(JSON.stringify(slackPayload), "utf-8"),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Slack ${response.status}: ${await response.text().catch(() => "")}`);
    logger.info(`GlitchTip → Slack 전송: ${title}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`glitchtip-to-slack 전송 실패: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Telegram MarkdownV2 특수문자 escape
function escapeMd(s) {
  return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

router.post("/glitchtip-to-telegram", verifyTokenTelegram, async (req, res) => {
  try {
    const body = req.body || {};
    const issue = body.issue || body.data?.issue || body;
    const title = issue.title || body.title || body.message || "GlitchTip alert";
    const culprit = issue.culprit || issue.metadata?.function || issue.metadata?.filename || "";
    const url = issue.web_url || body.web_url || "";
    const project = issue.project_name || body.project_name || body.project || "";
    const level = issue.level || body.level || "error";
    const count = issue.count || body.count || 1;

    const levelEmoji = { error: "🚨", warning: "⚠️", info: "ℹ️", debug: "🐛" }[level] || "🚨";

    const lines = [
      `${levelEmoji} *${escapeMd(title)}*`,
      "",
      `📁 프로젝트: ${escapeMd(project || "—")}`,
      `📊 레벨: ${escapeMd(level)}`,
      `🔢 이벤트: ${escapeMd(String(count))}`,
    ];
    if (culprit) lines.push(`📍 위치: \`${escapeMd(String(culprit).slice(0, 80))}\``);
    if (url) lines.push("", `[GlitchTip 에서 보기](${url})`);

    const text = lines.join("\n");

    const response = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: Buffer.from(JSON.stringify({
        chat_id: TG_CHAT_ID,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }), "utf-8"),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Telegram ${response.status}: ${body}`);
    }
    logger.info(`GlitchTip → Telegram 전송: ${title}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`glitchtip-to-telegram 전송 실패: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
