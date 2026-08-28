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
// ── GlitchTip → Discord (한글) ─────────────────────────────────────────
// 2026-08-26 신설, 2026-08-28 재작성.
//
// GlitchTip 의 "General webhook" 은 Slack 호환 형식으로 보낸다:
//   { text: "GlitchTip Alert" | "GlitchTip Alert (N issues)" | "GlitchTip Uptime Alert",
//     attachments: [{ title, title_link, text(=culprit 또는 업타임 문장), color("#hex"),
//                     fields: [{ title: "Project"|"Environment"|"Server Name"|"Release"|<tag>, value, short }] }] }
// 처음 만든 변환기는 이 형식을 모른 채 issue.title 같은 필드를 추측해 읽어 **항상 폴백만** 보냈다
// ("GlitchTip alert / error / 1"). 하루 GlitchTip 네이티브 Discord 로 돌렸더니 내용은 다 오지만 전부 영어다.
// 그래서 실제 형식을 그대로 파싱해 한글로 꾸민다. 형식은 GlitchTip 소스 apps/alerts/webhooks.py 와
// apps/uptime/webhooks.py 에서 확인했다.

const FIELD_KO = {
  Project: "프로젝트",
  Environment: "환경",
  "Server Name": "서버",
  Release: "릴리스",
  Service: "서비스",
  Farm_id: "농장",
  Hostname: "호스트",
};

function hexToInt(hex, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  return m ? parseInt(m[1], 16) : fallback;
}

/** GlitchTip 웹훅 본문 → Discord 메시지. 순수 함수라 테스트할 수 있다. */
export function formatGlitchTipForDiscord(body) {
  const header = String(body?.text || "");
  const atts = Array.isArray(body?.attachments) ? body.attachments : [];

  // ── 업타임 (Heartbeat 포함) ──
  if (/uptime/i.test(header)) {
    const embeds = atts.slice(0, 10).map((a) => {
      const down = /gone down/i.test(a.text || "");
      return {
        title: `${down ? "🔴 다운" : "✅ 복구"} · ${String(a.title || "모니터").slice(0, 240)}`,
        url: a.title_link || undefined,
        description: down
          ? "감시 대상이 응답하지 않습니다. 5분 안에 다시 확인됩니다."
          : "감시 대상이 다시 응답합니다.",
        color: down ? 0xed4245 : 0x57f287,
        footer: { text: "GlitchTip 업타임" },
        timestamp: new Date().toISOString(),
      };
    });
    return { content: undefined, embeds, summary: embeds.map((e) => e.title).join(" | ") };
  }

  // ── 오류 이슈 ──
  const countMatch = /\((\d+) issues?\)/.exec(header);
  const content = countMatch ? `오류 ${countMatch[1]}건` : undefined;
  const embeds = atts.slice(0, 10).map((a) => {
    const fields = (a.fields || []).slice(0, 25).map((f) => ({
      name: FIELD_KO[f.title] || String(f.title || "—").slice(0, 256),
      value: String(f.value ?? "—").slice(0, 1024) || "—",
      inline: f.short !== false,
    }));
    return {
      title: `🚨 ${String(a.title || "오류").slice(0, 240)}`,
      url: a.title_link || undefined,
      description: a.text ? `위치: \`${String(a.text).slice(0, 300)}\`` : undefined,
      color: hexToInt(a.color, 0xed4245),
      fields,
      footer: { text: "GlitchTip" },
      timestamp: new Date().toISOString(),
    };
  });
  if (embeds.length === 0) {
    embeds.push({ title: "🚨 GlitchTip 알림", description: header || "(내용 없음)", color: 0xed4245 });
  }
  return { content, embeds, summary: embeds.map((e) => e.title).join(" | ") };
}

router.post("/glitchtip-to-discord", verifyTokenDiscord, async (req, res) => {
  try {
    const { content, embeds, summary } = formatGlitchTipForDiscord(req.body || {});
    const payload = content ? { content, embeds } : { embeds };
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
    logger.info(`GlitchTip → Discord 전송: ${summary}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`glitchtip-to-discord 전송 실패: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
