// src/routes/webhook.routes.js
// 외부 서비스 → Slack/Telegram/Discord 알람 변환 proxy
// 인증: URL query token (?token=xxx) — 환경변수 GLITCHTIP_SLACK_TOKEN 과 비교

import express from "express";
import logger from "../utils/logger.js";

const router = express.Router();

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL || "";
const TOKEN = process.env.GLITCHTIP_SLACK_TOKEN || "";
const TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || "";

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

function verifyTokenDiscord(req, res, next) {
  verifyToken(req, res, () => {
    if (!DISCORD_WEBHOOK) return res.status(503).json({ error: "DISCORD_WEBHOOK_URL not configured" });
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

// GlitchTip → Discord
// 2026-08-26 신설. 운영 알림 채널을 Discord 로 통일하기 위함.
//
// ⚠ 2026-08-27 사용 중지 — GlitchTip 이 Discord 를 네이티브로 지원한다(RecipientType.DISCORD).
//   이 변환기는 GlitchTip 의 Slack 호환 페이로드(`attachments[].title`)를 `issue.title` 로
//   추측해 읽어 실제로는 항상 폴백("GlitchTip alert / error / 1")만 보냈다 — 오류가 무엇인지,
//   어느 서비스인지, 링크가 어디인지 전부 잃었다. 수신처를 GlitchTip 안에서 discord 타입으로
//   바꿔 제목·culprit·프로젝트·service/farm_id 태그·링크가 그대로 간다. 라우트는 호환용으로 남긴다.
//   Prometheus/Alertmanager 알림도 같은 채널로 가므로 한 곳에서 다 본다.
// Discord embed 스펙: description 4096자, 필드값 1024자, embed 최대 10개.
router.post("/glitchtip-to-discord", verifyTokenDiscord, async (req, res) => {
  try {
    const body = req.body || {};
    const issue = body.issue || body.data?.issue || body;
    const title = issue.title || body.title || body.message || "GlitchTip alert";
    const culprit = issue.culprit || issue.metadata?.function || issue.metadata?.filename || "";
    const url = issue.web_url || body.web_url || "";
    const project = issue.project_name || body.project_name || body.project || "";
    const level = issue.level || body.level || "error";
    const count = issue.count || body.count || 1;

    // Alertmanager 쪽 색상 규칙과 맞춘다 (빨강=긴급, 노랑=주의)
    const levelMeta = {
      error: { emoji: "🚨", color: 0xed4245 },
      fatal: { emoji: "💥", color: 0x992d22 },
      warning: { emoji: "⚠️", color: 0xfee75c },
      info: { emoji: "ℹ️", color: 0x5865f2 },
      debug: { emoji: "🐛", color: 0x99aab5 },
    }[level] || { emoji: "🚨", color: 0xed4245 };

    const fields = [
      { name: "프로젝트", value: String(project || "—").slice(0, 1024), inline: true },
      { name: "레벨", value: String(level).slice(0, 1024), inline: true },
      { name: "이벤트", value: String(count).slice(0, 1024), inline: true },
    ];
    if (culprit) {
      fields.push({ name: "위치", value: "`" + String(culprit).slice(0, 200) + "`", inline: false });
    }

    const payload = {
      embeds: [
        {
          title: `${levelMeta.emoji} ${String(title).slice(0, 250)}`,
          url: url || undefined,
          color: levelMeta.color,
          fields,
          footer: { text: "GlitchTip" },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const response = await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: Buffer.from(JSON.stringify(payload), "utf-8"),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const t = await response.text().catch(() => "");
      throw new Error(`Discord ${response.status}: ${t}`);
    }
    logger.info(`GlitchTip → Discord 전송: ${title}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`glitchtip-to-discord 전송 실패: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
