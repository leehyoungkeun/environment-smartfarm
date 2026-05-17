// src/routes/webhook.routes.js
// 외부 서비스 → Slack 알람 변환 proxy
// 인증: URL query token (?token=xxx) — 환경변수 GLITCHTIP_SLACK_TOKEN 과 비교

import express from "express";
import axios from "axios";
import logger from "../utils/logger.js";

const router = express.Router();

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL || "";
const TOKEN = process.env.GLITCHTIP_SLACK_TOKEN || "";

function verifyToken(req, res, next) {
  if (!TOKEN) return res.status(503).json({ error: "GLITCHTIP_SLACK_TOKEN not configured" });
  if ((req.query.token || "") !== TOKEN) return res.status(401).json({ error: "invalid token" });
  if (!SLACK_WEBHOOK) return res.status(503).json({ error: "SLACK_WEBHOOK_URL not configured" });
  next();
}

router.post("/glitchtip-to-slack", verifyToken, async (req, res) => {
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
      text: `${levelEmoji} *${title}*${project ? ` (${project})` : ""}`,
      blocks: [
        { type: "header", text: { type: "plain_text", text: `${levelEmoji} ${title}`.slice(0, 150) } },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Project:*\n${project || "—"}` },
            { type: "mrkdwn", text: `*Level:*\n${level}` },
            { type: "mrkdwn", text: `*Events:*\n${count}` },
            ...(culprit ? [{ type: "mrkdwn", text: `*Where:*\n\`${String(culprit).slice(0, 80)}\`` }] : []),
          ],
        },
        ...(url ? [{
          type: "actions",
          elements: [{ type: "button", text: { type: "plain_text", text: "GlitchTip 에서 보기" }, url }],
        }] : []),
      ],
    };

    await axios.post(SLACK_WEBHOOK, slackPayload, { timeout: 5000 });
    logger.info(`GlitchTip → Slack 전송: ${title}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`glitchtip-to-slack 전송 실패: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
