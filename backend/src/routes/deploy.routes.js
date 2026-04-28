// src/routes/deploy.routes.js
// GitHub Actions webhook → 자동 배포

import { Router } from "express";
import { exec } from "child_process";
import logger from "../utils/logger.js";

const router = Router();
const DEPLOY_TOKEN = process.env.DEPLOY_TOKEN || "smartfarm-deploy-2026";

// POST /api/deploy
router.post("/", (req, res) => {
  const token = req.headers["x-deploy-token"];
  if (token !== DEPLOY_TOKEN) {
    return res.status(403).json({ success: false, error: "Invalid token" });
  }

  const { service } = req.body;
  logger.info(`🚀 배포 webhook 수신: ${service || "backend"}`);

  // 비동기로 배포 실행 (응답은 즉시 반환)
  res.json({ success: true, message: "Deploy started" });

  exec(
    "cd ~/smartfarm/backend && " +
      "git fetch origin main && " +
      "git reset --hard origin/main && " +
      "npm install --omit=dev && " +
      "npx prisma generate && " +
      "pm2 restart smartfarm-backend",
    { timeout: 300000 },
    (err, stdout, stderr) => {
      if (err) {
        logger.error(`❌ 배포 실패: ${err.message}\nstderr: ${stderr}`);
      } else {
        logger.info(`✅ 배포 완료: ${stdout.trim().split("\n").pop()}`);
      }
    }
  );
});

export default router;
