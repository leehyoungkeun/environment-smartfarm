// src/routes/deploy.routes.js
// GitHub Actions webhook → smartfarm-deploy.sh trigger
// (deploy.sh 가 lock/health/rollback/log 일체 담당)

import { Router } from "express";
import { exec } from "child_process";
import logger from "../utils/logger.js";

const router = Router();
const DEPLOY_TOKEN = process.env.DEPLOY_TOKEN || "smartfarm-deploy-2026";
const DEPLOY_SCRIPT = "/home/afocus/smartfarm/scripts/smartfarm-deploy.sh";

// POST /api/deploy
router.post("/", (req, res) => {
  const token = req.headers["x-deploy-token"];
  if (token !== DEPLOY_TOKEN) {
    return res.status(403).json({ success: false, error: "Invalid token" });
  }

  const { service } = req.body;
  logger.info(`🚀 배포 webhook 수신: ${service || "backend"} → deploy.sh`);

  // 즉시 응답 (deploy.sh 는 백그라운드 + 자식 detach)
  res.json({ success: true, message: "Deploy triggered (see deploy.log)" });

  // backend 가 pm2 reload 로 자신을 재시작하므로 detach 필수.
  // setsid + nohup + disown 으로 부모와 완전 분리.
  exec(
    `setsid nohup ${DEPLOY_SCRIPT} </dev/null >/dev/null 2>&1 &`,
    { timeout: 5000 },
    (err) => {
      if (err) {
        logger.error(`❌ deploy.sh trigger 실패: ${err.message}`);
      }
    }
  );
});

export default router;
