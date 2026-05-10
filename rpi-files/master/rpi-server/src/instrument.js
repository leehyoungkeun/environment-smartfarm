require("dotenv").config();
const Sentry = require("@sentry/node");

if (process.env.GLITCHTIP_DSN) {
  Sentry.init({
    dsn: process.env.GLITCHTIP_DSN,
    environment: process.env.NODE_ENV || "production",
    release: `smartfarm-rpi@${process.env.npm_package_version || "1.0.0"}`,
    tracesSampleRate: 0.05,
    sendDefaultPii: false,
    initialScope: {
      tags: {
        service: "rpi",
        farm_id: (process.env.AWS_IOT_CLIENT_ID || "").replace("MyFarmPi_", "") || "unknown",
        hostname: require("os").hostname(),
      },
    },
    beforeSend(event) {
      const msg = event.exception?.values?.[0]?.value || "";
      if (msg.includes("ECONNRESET") || msg.includes("EPIPE") || msg.includes("ETIMEDOUT")) return null;
      return event;
    },
  });
}

module.exports = { Sentry };
