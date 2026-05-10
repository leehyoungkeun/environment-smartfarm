import "dotenv/config";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

if (process.env.GLITCHTIP_DSN) {
  Sentry.init({
    dsn: process.env.GLITCHTIP_DSN,
    environment: process.env.NODE_ENV || "development",
    release: `smartfarm-backend@${process.env.npm_package_version || "2.0.0"}`,
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
