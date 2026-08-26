import "dotenv/config";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

if (process.env.GLITCHTIP_DSN) {
  Sentry.init({
    dsn: process.env.GLITCHTIP_DSN,
    environment: process.env.NODE_ENV || "development",
    // 커밋 해시를 릴리스로 쓴다 — 고정 버전(2.0.0)이면 모든 배포가 같은
    // 릴리스로 묶여 "어느 배포부터 생긴 오류인가" 를 알 수 없다.
    // GIT_SHA 는 smartfarm-deploy.sh 가 배포 때마다 backend/.env 에 기록한다.
    release: `smartfarm-backend@${process.env.GIT_SHA || process.env.npm_package_version || "2.0.0"}`,
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    sendDefaultPii: false,
    initialScope: {
      tags: { service: "backend" },
    },
    beforeSend(event) {
      const msg = event.exception?.values?.[0]?.value || "";
      if (msg.includes("ECONNRESET") || msg.includes("EPIPE")) return null;
      return event;
    },
  });
}

export { Sentry };
