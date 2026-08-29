// src/app.js
// Express 메인 애플리케이션 - PostgreSQL + TimescaleDB 버전
// 변경: mongoose 제거 → Prisma + pg pool

import "./instrument.js"; // Sentry: 반드시 다른 import 보다 먼저
import * as Sentry from "@sentry/node";
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import promClient from "prom-client";
import journalRoutes from "./routes/journal.routes.js";
import nutrientRoutes from "./routes/nutrient.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import farmsRoutes from "./routes/farms.routes.js";
import reportRoutes from "./routes/report.routes.js";

import { connectDB, disconnectDB, checkDBHealth, prisma } from "./db.js";
import { initMqttClient } from "./services/mqttClient.js";
import { initWebSocketServer, getConnectedClients } from "./services/wsServer.js";
import mqttService from "./services/mqttClient.js";
import bcrypt from "bcryptjs";
import configRoutes from "./routes/config.routes.js";
import sensorsRoutes from "./routes/sensors.js";
import alertsRoutes from "./routes/alerts.js";
import controlLogRoutes from "./routes/control-logs.js";
import automationRoutes from "./routes/automation.routes.js";
import auditLogRoutes from "./routes/audit-logs.js";
import authRoutes from "./routes/auth.routes.js";
import internalRoutes from "./routes/internal.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";
import devicesRoutes from "./routes/devices.routes.js";
import deployRoutes from "./routes/deploy.routes.js";
import camerasRoutes from "./routes/cameras.routes.js";
import devicePositionsRoutes from "./routes/device-positions.routes.js";
import relayStatusRoutes from "./routes/relay-status.routes.js";
import kakaoRoutes from "./routes/kakao.routes.js";
import {
  authenticate,
  authenticateApiKey,
  enforceTenant,
} from "./middleware/auth.middleware.js";
import { normalizeIds } from "./middleware/normalizeIds.js";
import { getAlertHealth } from "./routes/sensors.js";
import logger from "./utils/logger.js";
import { startMaintenanceAlertScheduler } from "./schedulers/maintenanceAlert.js";
import { startOfflineAlertScheduler } from "./schedulers/offlineAlert.js";
import { startTrashCleanupScheduler } from "./schedulers/trashCleanup.js";
import { startSensorThresholdScheduler } from "./schedulers/sensorThresholdAlert.js";
import { start as startNutrientAutoScheduler } from "./services/nutrientAutoScheduler.js";
import { startDeviceFailureScheduler } from "./schedulers/deviceFailureAlert.js";
import crypto from "crypto";

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 미들웨어
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false,
}));

app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = (process.env.CORS_ORIGIN || "http://localhost:5173")
        .split(",")
        .map(s => s.trim());
      // allow requests with no origin (curl, mobile apps, etc.)
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // 개발 중 모든 origin 허용
      }
    },
    credentials: true,
  })
);

app.use(compression());

// ★ realtime endpoint 의 응답에 no-cache header — workbox / CDN / browser 캐시 전부 차단
//   PWA service worker 가 옛 응답 stale 표시하던 사고 (2026-06-07 진단) 영구 방지
const NO_CACHE_PATTERNS = [
  /\/api\/sensors\/latest\//,
  /\/api\/automation\/[^/]+\/schedule/,
  /\/api\/alerts/,
  /\/api\/device-positions/,
  /\/api\/nutrient\/(?:current|status)/,
];
app.use((req, res, next) => {
  if (req.method === "GET" && NO_CACHE_PATTERNS.some(re => re.test(req.path))) {
    res.set("Cache-Control", "no-store, must-revalidate");
    res.set("Pragma", "no-cache");
  }
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// 인증 라우트 전용 (brute-force 방지: 15분에 20회)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 일반 API (1분에 300회 — 대시보드 폴링 고려)
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 300,
  skip: (req) => {
    // RPi 센서 수집/동기화/내부통신은 rate limit 제외
    return req.path.startsWith("/sensors") || req.path.startsWith("/config");
  },
  message: {
    success: false,
    error: "Too many requests from this IP",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/refresh", authLimiter);
app.use("/api/", apiLimiter);

app.use("/uploads", express.static("uploads"));


// 요청 로깅 (개발 모드)
if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`);
    next();
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Prometheus Metrics
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

promClient.collectDefaultMetrics({ prefix: "smartfarm_" });

const httpRequestDuration = new promClient.Histogram({
  name: "smartfarm_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
});

const httpRequestTotal = new promClient.Counter({
  name: "smartfarm_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"],
});

// ── 도메인 지표 ────────────────────────────────────────────
// 2026-08-25: 감지 실패 3건(AWS MQTT 3주 / farm_0006 플래핑 3.5개월 /
// RPi 전원 꺼짐 9일)이 전부 "로그에는 있었지만 아무도 안 봤다" 였다.
// 아래 지표로 Prometheus 알림이 당일에 잡도록 한다.

// MQTT 브로커 연결 여부 (1=연결, 0=끊김)
new promClient.Gauge({
  name: "smartfarm_mqtt_connected",
  help: "AWS IoT Core MQTT connection state (1=connected, 0=disconnected)",
  async collect() {
    try {
      const mqttService = (await import("./services/mqttClient.js")).default;
      this.set(mqttService.isConnected() ? 1 : 0);
    } catch {
      this.set(0);
    }
  },
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 농장 운영 지표
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 대시보드에 올릴 것이 MQTT·수신지연·센서값뿐이라 너무 적었다.
// 농장이 실제로 어떻게 돌아가는지 — 알림이 몇 건 났는지, 제어가 얼마나
// 이뤄졌는지, 장치가 몇 개인지 — 는 DB 에만 있고 지표로 나오지 않았다.
//
// 스크레이프는 30초 주기다. 농장별로 쿼리를 쪼개면 농장 수만큼 늘어나므로
// 한 번의 GROUP BY 로 모아 담는다.

// 농장 자체의 존재와 상태. status 라벨이 붙어 있어 대시보드에서
// '운전중이 아닌 농장' 을 그대로 걸러낼 수 있다.
new promClient.Gauge({
  name: "smartfarm_farm_up",
  help: "1 per registered farm (labels carry name and status)",
  labelNames: ["farm_id", "farm_name", "status"],
  async collect() {
    try {
      const { pool } = await import("./db.js");
      const { rows } = await pool.query(
        "SELECT farm_id, name, status FROM farms WHERE status <> 'deleted'"
      );
      this.reset();
      rows.forEach((r) =>
        this.set(
          { farm_id: r.farm_id, farm_name: r.name || r.farm_id, status: r.status || "unknown" },
          r.status === "active" ? 1 : 0
        )
      );
    } catch {
      // 실패하면 값을 지운다 — 남겨두면 마지막 정상값이 계속 보고돼
      // 장애 중에도 정상으로 보인다. 부재 자체는 smartfarm_db_up 이 알린다.
      this.reset();
    }
  },
});

// 하우스·장치 구성 — 규모를 한눈에 보고, 갑자기 줄면 설정 사고를 의심할 수 있다
new promClient.Gauge({
  name: "smartfarm_house_count",
  help: "Enabled houses per farm",
  labelNames: ["farm_id"],
  async collect() {
    try {
      const { pool } = await import("./db.js");
      const { rows } = await pool.query(
        `SELECT hc.farm_id, count(*) AS n
           FROM house_configs hc
           JOIN farms f ON f.farm_id = hc.farm_id AND f.status = 'active'
          WHERE hc.enabled = true
          GROUP BY hc.farm_id`
      );
      this.reset();
      rows.forEach((r) => this.set({ farm_id: r.farm_id }, Number(r.n) || 0));
    } catch {
      // 실패 시 값 제거 (마지막 정상값이 남아 거짓 신호가 되는 것 방지)
      this.reset();
    }
  },
});

new promClient.Gauge({
  name: "smartfarm_device_count",
  help: "Configured control devices per farm",
  labelNames: ["farm_id"],
  async collect() {
    try {
      const { pool } = await import("./db.js");
      const { rows } = await pool.query(
        `SELECT hc.farm_id, COALESCE(sum(jsonb_array_length(hc.devices)), 0) AS n
           FROM house_configs hc
           JOIN farms f ON f.farm_id = hc.farm_id AND f.status = 'active'
          WHERE hc.enabled = true
          GROUP BY hc.farm_id`
      );
      this.reset();
      rows.forEach((r) => this.set({ farm_id: r.farm_id }, Number(r.n) || 0));
    } catch {
      // 실패 시 값 제거 (마지막 정상값이 남아 거짓 신호가 되는 것 방지)
      this.reset();
    }
  },
});

// 최근 24시간 알림 — 심각도별. 어느 농장이 시끄러운지 바로 드러난다
new promClient.Gauge({
  name: "smartfarm_alerts_24h",
  help: "Alerts raised in the last 24h per farm and severity",
  labelNames: ["farm_id", "severity"],
  async collect() {
    try {
      const { pool } = await import("./db.js");
      const { rows } = await pool.query(
        // soft-delete 된 알림은 화면에서 사라진 것이므로 지표에서도 빼야 한다.
        // 빠뜨리면 사용자가 알림을 지운 뒤에도 대시보드 숫자가 그대로 남아
        // 화면과 지표가 어긋난다 (2026-08-26 실제로 그랬다).
        `SELECT farm_id, COALESCE(severity, 'UNKNOWN') AS severity, count(*) AS n
           FROM alerts
          WHERE timestamp > now() - interval '24 hours'
            AND (metadata->>'deleted') IS DISTINCT FROM 'true'
          GROUP BY farm_id, severity`
      );
      this.reset();
      rows.forEach((r) =>
        this.set({ farm_id: r.farm_id, severity: r.severity }, Number(r.n) || 0)
      );
    } catch {
      // 실패 시 값 제거 (마지막 정상값이 남아 거짓 신호가 되는 것 방지)
      this.reset();
    }
  },
});

// 미확인 알림 — 서킷 브레이커가 이 값을 보고 감지를 멈춘다(농장·유형당 3건).
// 쌓이는 것을 눈으로 보게 해두면 2026-08-26 같은 5주 침묵을 다시 겪지 않는다.
new promClient.Gauge({
  name: "smartfarm_alerts_unacknowledged",
  help: "Unacknowledged alerts per farm (circuit breaker counts these)",
  labelNames: ["farm_id"],
  async collect() {
    try {
      const { pool } = await import("./db.js");
      const { rows } = await pool.query(
        // 서킷 브레이커가 세는 것과 같은 기준이어야 한다 —
        // 삭제된 알림은 브레이커도 세지 않는다(Alert.find 가 제외한다).
        `SELECT farm_id, count(*) AS n
           FROM alerts
          WHERE NOT acknowledged
            AND timestamp > now() - interval '24 hours'
            AND (metadata->>'deleted') IS DISTINCT FROM 'true'
          GROUP BY farm_id`
      );
      this.reset();
      rows.forEach((r) => this.set({ farm_id: r.farm_id }, Number(r.n) || 0));
    } catch {
      // 실패 시 값 제거 (마지막 정상값이 남아 거짓 신호가 되는 것 방지)
      this.reset();
    }
  },
});

// 최근 24시간 제어 횟수와 실패 — 장비 고장 감지의 재료이기도 하다
new promClient.Gauge({
  name: "smartfarm_controls_24h",
  help: "Control commands in the last 24h per farm",
  labelNames: ["farm_id", "result"],
  async collect() {
    try {
      const { pool } = await import("./db.js");
      const { rows } = await pool.query(
        `SELECT farm_id,
                CASE WHEN success THEN 'success' ELSE 'failure' END AS result,
                count(*) AS n
           FROM control_logs
          WHERE timestamp > now() - interval '24 hours'
          GROUP BY farm_id, 2`
      );
      this.reset();
      rows.forEach((r) =>
        this.set({ farm_id: r.farm_id, result: r.result }, Number(r.n) || 0)
      );
    } catch {
      // 실패 시 값 제거 (마지막 정상값이 남아 거짓 신호가 되는 것 방지)
      this.reset();
    }
  },
});

// 최근 1시간 센서 적재 건수 — 수집이 '끊겼는지' 가 아니라 '성긴지' 를 본다.
// 1분 주기이므로 정상이면 하우스당 60 안팎이다. 30 이면 절반을 놓치고 있다는 뜻.
new promClient.Gauge({
  name: "smartfarm_sensor_rows_1h",
  help: "sensor_data rows stored in the last hour per farm/house",
  labelNames: ["farm_id", "house_id"],
  async collect() {
    try {
      const { pool } = await import("./db.js");
      const { rows } = await pool.query(
        `SELECT sd.farm_id, sd.house_id, count(*) AS n
           FROM sensor_data sd
           JOIN farms f ON f.farm_id = sd.farm_id AND f.status = 'active'
          WHERE sd.timestamp > now() - interval '1 hour'
           AND (sd.metadata->>'quality') IS DISTINCT FROM 'simulated'  -- 시뮬레이션 제외 (B4)
          GROUP BY sd.farm_id, sd.house_id`
      );
      this.reset();
      rows.forEach((r) =>
        this.set({ farm_id: r.farm_id, house_id: r.house_id }, Number(r.n) || 0)
      );
    } catch {
      // 실패 시 값 제거 (마지막 정상값이 남아 거짓 신호가 되는 것 방지)
      this.reset();
    }
  },
});

// 자동화 규칙 — 몇 개가 켜져 있는지. 0 이면 자동제어가 꺼진 농장이다
new promClient.Gauge({
  name: "smartfarm_automation_rules",
  help: "Automation rules per farm by enabled state",
  labelNames: ["farm_id", "enabled"],
  async collect() {
    try {
      const { pool } = await import("./db.js");
      const { rows } = await pool.query(
        `SELECT ar.farm_id,
                CASE WHEN ar.enabled THEN 'true' ELSE 'false' END AS enabled,
                count(*) AS n
           FROM automation_rules ar
           JOIN farms f ON f.farm_id = ar.farm_id AND f.status = 'active'
          GROUP BY ar.farm_id, 2`
      );
      this.reset();
      rows.forEach((r) =>
        this.set({ farm_id: r.farm_id, enabled: r.enabled }, Number(r.n) || 0)
      );
    } catch {
      // 실패 시 값 제거 (마지막 정상값이 남아 거짓 신호가 되는 것 방지)
      this.reset();
    }
  },
});

// 센서 실측값과 설정 임계값 — 임계 이탈 감지를 Prometheus 로 일원화
//
// 2026-08-26 감지체계 점검에서, 임계 이탈을 판정하던 sensorThresholdAlert
// 스케줄러가 서킷 브레이커 래치로 죽어 있었고 알림을 DB 에만 넣을 뿐
// 사람에게 전달되는 경로가 없다는 것이 드러났다.
// 판정을 Prometheus 로 옮기면 이미 검증된 Alertmanager→Discord 경로를 탄다.
//
// 임계값은 농장마다 다르므로 규칙에 하드코딩할 수 없다.
// 값과 임계값을 함께 노출하고 규칙이 둘을 비교하게 한다 —
// 설정 권한은 그대로 앱에 남고, 규칙은 농장 수와 무관하게 하나면 된다.
new promClient.Gauge({
  name: "smartfarm_sensor_value",
  help: "Latest sensor reading per farm/house/sensor",
  labelNames: ["farm_id", "house_id", "sensor_id"],
  async collect() {
    try {
      const { pool } = await import("./db.js");
      // 하우스별 최신 1행만 — DISTINCT ON 이 인덱스(farm_id, house_id, timestamp DESC)를 탄다
      const { rows } = await pool.query(
        // 운영 중인 농장만 — 감시 대상 판단 기준을 스케줄러와 일치시킨다
        // (farms.status='active'). 한쪽만 거르면 중지된 농장이 규칙에 다시 걸려
        // 오래 꺼둔 농장이 알림 소음을 만든다.
        `SELECT DISTINCT ON (sd.farm_id, sd.house_id) sd.farm_id, sd.house_id, sd.data
           FROM sensor_data sd
           JOIN farms f ON f.farm_id = sd.farm_id AND f.status = 'active'
          WHERE sd.timestamp > now() - interval '1 hour'
           AND (sd.metadata->>'quality') IS DISTINCT FROM 'simulated'  -- 시뮬레이션 제외 (B4)
          ORDER BY sd.farm_id, sd.house_id, sd.timestamp DESC`
      );
      this.reset();
      rows.forEach((r) => {
        const data = r.data || {};
        Object.entries(data).forEach(([sensorId, value]) => {
          const v = Number(value);
          if (Number.isFinite(v)) {
            this.set({ farm_id: r.farm_id, house_id: r.house_id, sensor_id: sensorId }, v);
          }
        });
      });
    } catch {
      // 실패하면 값을 지운다 — 남겨두면 마지막 정상값이 계속 보고돼
      // 장애 중에도 정상으로 보인다. 부재 자체는 smartfarm_db_up 이 알린다.
      this.reset();
    }
  },
});

// house_configs.sensors 에 설정된 min/max. 값이 없는 센서는 노출하지 않는다
// (규칙이 조인에 실패해 아무것도 발동하지 않게 되는 것이 안전한 기본값).
function registerThresholdGauge(name, help, key) {
  new promClient.Gauge({
    name,
    help,
    labelNames: ["farm_id", "house_id", "sensor_id"],
    async collect() {
      try {
        const { pool } = await import("./db.js");
        const { rows } = await pool.query(
          // 실측값 지표와 같은 기준(운영 중인 농장)으로 맞춘다
          `SELECT hc.farm_id, hc.house_id, hc.sensors
             FROM house_configs hc
             JOIN farms f ON f.farm_id = hc.farm_id AND f.status = 'active'
            WHERE hc.enabled = true`
        );
        this.reset();
        rows.forEach((r) => {
          const sensors = Array.isArray(r.sensors) ? r.sensors : [];
          sensors.forEach((sc) => {
            const sensorId = sc?.id || sc?.sensorId;
            const raw = sc?.[key];
            const v = Number(raw);
            if (sensorId && raw != null && Number.isFinite(v)) {
              this.set({ farm_id: r.farm_id, house_id: r.house_id, sensor_id: sensorId }, v);
            }
          });
        });
      } catch {
        // 실패 시 값 제거 (마지막 정상값이 남아 거짓 신호가 되는 것 방지)
        this.reset();
      }
    },
  });
}

registerThresholdGauge(
  "smartfarm_sensor_threshold_min",
  "Configured minimum threshold per farm/house/sensor",
  "min"
);
registerThresholdGauge(
  "smartfarm_sensor_threshold_max",
  "Configured maximum threshold per farm/house/sensor",
  "max"
);

// DB 생존 신호.
//
// 나머지 지표들은 DB 조회가 실패하면 값을 지운다(아래 catch). 그런데
// **값이 사라지는 것만으로는 알림이 뜨지 않는다** — Prometheus 규칙은
// 존재하는 시계열을 평가하기 때문이다. 그래서 "살아 있다"는 양의 신호를
// 따로 둔다. 이것이 0 이 되면 DatabaseDown 규칙이 발동한다.
new promClient.Gauge({
  name: "smartfarm_db_up",
  help: "1 if the backend can query PostgreSQL, 0 otherwise",
  async collect() {
    try {
      const { pool } = await import("./db.js");
      await pool.query("SELECT 1");
      this.set(1);
    } catch {
      this.set(0);
    }
  },
});

// 농장/하우스별 마지막 센서 수신 이후 경과 초 — 수집 중단 감지
new promClient.Gauge({
  name: "smartfarm_sensor_last_seen_seconds",
  help: "Seconds since last sensor_data row per farm/house",
  labelNames: ["farm_id", "house_id"],
  async collect() {
    try {
      const { pool } = await import("./db.js");
      const { rows } = await pool.query(
        `SELECT sd.farm_id, sd.house_id,
                EXTRACT(EPOCH FROM (now() - max(sd.timestamp))) AS age
           FROM sensor_data sd
           JOIN farms f ON f.farm_id = sd.farm_id AND f.status = 'active'  -- 점검중·중지 농장 제외 → SensorDataStalled 안 울림 (2026-08-29)
           WHERE sd.timestamp > now() - interval '7 days'
           AND (sd.metadata->>'quality') IS DISTINCT FROM 'simulated'  -- 시뮬레이션 제외 (B4)
           GROUP BY sd.farm_id, sd.house_id`
      );
      this.reset();
      rows.forEach((r) =>
        this.set({ farm_id: r.farm_id, house_id: r.house_id }, Number(r.age) || 0)
      );
    } catch {
      this.reset(); // 실패 시 값 제거 — 마지막 정상값이 남아 거짓 신호가 되는 것 방지
    }
  },
});

// 농장별 릴레이 상태 수신 이후 경과 초 — MQTT 상태 발행 중단 감지
new promClient.Gauge({
  name: "smartfarm_relay_status_age_seconds",
  help: "Seconds since last relay_status update per farm",
  labelNames: ["farm_id"],
  async collect() {
    try {
      const { pool } = await import("./db.js");
      const { rows } = await pool.query(
        `SELECT rs.farm_id, EXTRACT(EPOCH FROM (now() - max(rs.updated_at))) AS age
        FROM relay_status rs
        JOIN farms f ON f.farm_id = rs.farm_id AND f.status = 'active'  -- 점검중 농장 제외 (2026-08-29)
        GROUP BY rs.farm_id`
      );
      this.reset();
      rows.forEach((r) =>
        this.set({ farm_id: r.farm_id }, Number(r.age) || 0)
      );
    } catch {
      // 실패 시 값 제거 (마지막 정상값이 남아 거짓 신호가 되는 것 방지)
      this.reset();
    }
  },
});

// Middleware: measure all requests
app.use((req, res, next) => {
  if (req.path === "/metrics") return next();
  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    const route = req.route?.path || req.path;
    const labels = { method: req.method, route, status: res.statusCode };
    end(labels);
    httpRequestTotal.inc(labels);
  });
  next();
});

// /metrics 는 내부 전용이다. 2026-08-29 점검에서 api.smartgreen.kr/metrics 가 인터넷에 200 으로
// 열려 있었다 — 전 농장의 센서값·임계값·장치 수가 그대로 나갔다 (고객 데이터).
// Prometheus 는 같은 호스트의 도커 네트워크(172.x → host.docker.internal)에서 긁으므로
// 사설망·루프백·Tailscale 만 허용하고, Cloudflare 터널을 거쳐 온 요청(cf-connecting-ip 헤더)은 거부한다.
// trust proxy 가 켜져 있어 req.ip 는 X-Forwarded-For 를 따르므로 소켓 주소를 직접 본다.
const METRICS_ALLOWED = [
  /^127\./, /^::1$/, /^::ffff:127\./,
  /^10\./, /^::ffff:10\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^::ffff:172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./, /^::ffff:192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::ffff:100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];
app.get("/metrics", async (req, res) => {
  const remote = req.socket?.remoteAddress || "";
  const viaTunnel = Boolean(req.headers["cf-connecting-ip"]);
  if (viaTunnel || !METRICS_ALLOWED.some((re) => re.test(remote))) {
    logger.warn(`/metrics 거부: remote=${remote} tunnel=${viaTunnel} cf-ip=${req.headers["cf-connecting-ip"] || "-"}`);
    return res.status(404).end();
  }
  res.set("Content-Type", promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Health Check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.get("/health", async (req, res) => {
  try {
    // DB 헬스체크에 5초 타임아웃 적용 (hang 방지)
    const dbHealth = await Promise.race([
      checkDBHealth(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("DB health check timeout (5s)")), 5000)
      ),
    ]);

    const alertHealth = getAlertHealth();

    res.json({
      success: true,
      timestamp: new Date(),
      uptime: process.uptime(),
      services: {
        database: dbHealth,
        alerts: alertHealth,
        memory: {
          used:
            Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB",
          total:
            Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + " MB",
        },
      },
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: error.message,
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// API 라우트 (경로 동일 유지)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// farmId/houseId 정규화 (farm_001 → farm_0001)
app.use(normalizeIds);

// 공개 API (인증 불필요)
app.use("/api/auth", authRoutes);

// Node-RED 내부 통신 (API Key 인증 필수)
app.use("/internal", authenticateApiKey, internalRoutes);

// 외부 webhook (token query 로 자체 인증)
app.use("/webhook", webhookRoutes);

// 센서 + 설정 API (API 키 또는 JWT - Node-RED 접근 필요)
app.use("/api/sensors", authenticateApiKey, sensorsRoutes);
app.use("/api/config", authenticateApiKey, configRoutes);
app.use("/api/automation", authenticateApiKey, automationRoutes);
app.use("/api/devices", devicesRoutes);
app.use("/api/deploy", deployRoutes);
app.use("/api/kakao", kakaoRoutes);
app.use("/api/cameras", authenticate, camerasRoutes);
app.use("/api/device-positions", authenticate, enforceTenant, devicePositionsRoutes); // 2026-08-29 N3: 무인증 노출 차단
app.use("/api/relay-status", authenticate, enforceTenant, relayStatusRoutes); // 2026-08-29 N3: 무인증 노출 차단

// 농장 관리 API (JWT 인증)
app.use("/api/farms", authenticate, farmsRoutes);

// JWT 인증 필수 API (테넌트 격리 적용)
app.use("/api/alerts", authenticate, enforceTenant, alertsRoutes);
app.use("/api/control-logs", authenticate, enforceTenant, controlLogRoutes);
app.use("/api/audit-logs", authenticate, enforceTenant, auditLogRoutes);
app.use("/api/reports", authenticate, enforceTenant, reportRoutes);

app.use("/api/journal", authenticate, enforceTenant, journalRoutes);
app.use("/api/ai", authenticate, enforceTenant, aiRoutes);
app.use("/api/nutrient", authenticate, enforceTenant, nutrientRoutes);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 404 처리
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    error: "Not Found",
    path: req.originalUrl,
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 에러 핸들러
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Sentry 자동 캡처 (커스텀 에러 핸들러 전에 위치해야 함)
Sentry.setupExpressErrorHandler(app);

app.use((err, req, res, next) => {
  logger.error("Error:", {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });

  // Prisma 검증 에러
  if (err.name === "PrismaClientValidationError") {
    return res.status(400).json({
      success: false,
      error: "Validation Error",
      details: [err.message],
    });
  }

  // Prisma 유니크 제약 에러
  if (err.code === "P2002") {
    return res.status(409).json({
      success: false,
      error: "Duplicate Error",
      message: "Resource already exists",
    });
  }

  // Prisma 레코드 미존재
  if (err.code === "P2025") {
    return res.status(404).json({
      success: false,
      error: "Not Found",
      message: "Resource not found",
    });
  }

  // 기본 에러
  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 서버 시작
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function ensureAdmin() {
  try {
    // 기존 admin → superadmin 마이그레이션
    try {
      const migrated = await prisma.user.updateMany({
        where: { role: "admin" },
        data: { role: "superadmin" },
      });
      if (migrated.count > 0) {
        logger.info(`[AUTH] 역할 마이그레이션: ${migrated.count}개 admin → superadmin`);
      }
    } catch {
      // 마이그레이션 실패 무시
    }

    const count = await prisma.user.count();
    if (count === 0) {
      const defaultFarmId = process.env.FARM_ID || "farm_0001";
      const hash = await bcrypt.hash("admin1234", 12);
      const admin = await prisma.user.create({
        data: {
          username: "admin",
          password: hash,
          name: "관리자",
          role: "superadmin",
          farmId: defaultFarmId,
          allowedHouses: [],
          enabled: true,
        },
      });
      logger.info("[AUTH] 초기 superadmin 계정 생성됨 (admin / admin1234)");

      // Farm + UserFarm 매핑도 함께 생성
      try {
        const farm = await prisma.farm.upsert({
          where: { farmId: defaultFarmId },
          update: {},
          create: {
            farmId: defaultFarmId,
            name: "스마트팜",
            apiKey: crypto.randomBytes(32).toString("hex"), // 농장별 키 — 공통 키 금지 (2026-08-29)
            status: "active",
          },
        });
        await prisma.userFarm.create({
          data: {
            userId: admin.id,
            farmId: farm.id,
            role: "admin",
          },
        });
        logger.info("[AUTH] Farm + UserFarm 매핑 생성됨");
      } catch (farmErr) {
        logger.warn("[AUTH] Farm 생성 건너뜀:", farmErr.message);
      }
    }
  } catch (error) {
    logger.warn("[AUTH] admin 확인 실패 (무시):", error.message);
  }
}

async function startServer() {
  try {
    // PostgreSQL 연결
    await connectDB();

    // 사용자 없으면 초기 admin 계정 생성
    await ensureAdmin();

    // 유지보수 만료 알림 스케줄러 시작
    startMaintenanceAlertScheduler();

    // 농장 오프라인 감지 스케줄러 시작
    startOfflineAlertScheduler();

    // 휴지통 자동 정리 스케줄러 시작
    startTrashCleanupScheduler();
    startSensorThresholdScheduler();
    startDeviceFailureScheduler();
    startNutrientAutoScheduler();

    const server = app.listen(PORT, "0.0.0.0", () => {
      // MQTT + WebSocket 초기화
      initMqttClient();
      initWebSocketServer(server);

      logger.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌱 Configurable SmartFarm Backend Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Port: ${PORT}
   Environment: ${process.env.NODE_ENV || "development"}
   Database: PostgreSQL + TimescaleDB
   MQTT: AWS IoT Core
   WebSocket: /ws
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `);
    });

    server.on("error", async (err) => {
      if (err.code === "EADDRINUSE") {
        logger.warn(`⚠️ 포트 ${PORT} 사용 중 — 고아 프로세스 정리 시도...`);
        try {
          const { execSync } = await import("child_process");
          const isWin = process.platform === "win32";
          if (isWin) {
            const result = execSync(`netstat -ano | findstr :${PORT} | findstr LISTEN`, { encoding: "utf8" }).trim();
            const pid = result.split(/\s+/).pop();
            if (pid && pid !== String(process.pid)) {
              execSync(`taskkill /PID ${pid} /F`);
              logger.info(`✅ 고아 프로세스(PID ${pid}) 종료 완료 — 3초 후 재시작`);
            }
          } else {
            execSync(`fuser -k ${PORT}/tcp`);
            logger.info(`✅ 포트 ${PORT} 점유 프로세스 종료 — 3초 후 재시작`);
          }
          setTimeout(() => {
            server.listen(PORT, "0.0.0.0");
          }, 3000);
        } catch (killErr) {
          logger.error("❌ 포트 정리 실패 — PM2 재시작에 의존:", killErr.message);
          process.exit(1);
        }
      } else {
        logger.error("❌ 서버 에러:", err);
        process.exit(1);
      }
    });
  } catch (error) {
    logger.error("❌ Server startup failed:", error);
    process.exit(1);
  }
}

// 통합 테스트가 이 모듈을 import 할 때만 서버·DB·MQTT·스케줄러를 띄우지 않는다 (2026-08-29).
// supertest 가 app 을 직접 호출하므로 포트가 필요 없다.
//
// NODE_ENV 가 아니라 전용 변수를 쓰는 이유: NODE_ENV 는 여러 도구가 건드리는 값이라
// 어딘가에서 test 로 설정되면 운영 백엔드가 조용히 안 뜬다. 이 변수는 test/setup.js 에서만
// 설정하므로 운영에서는 절대 발동하지 않는다.
if (!process.env.SMARTFARM_NO_LISTEN) startServer();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 프로세스 안정성: 예외 핸들러
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

process.on("uncaughtException", (err) => {
  Sentry.captureException(err, { tags: { handler: "uncaughtException" } });
  logger.error("UNCAUGHT EXCEPTION — 프로세스 종료 예정:", {
    message: err.message,
    stack: err.stack,
  });
  // Sentry flush 후 DB 정리 + 종료 (PM2가 자동 재시작)
  Sentry.flush(2000)
    .catch(() => {})
    .finally(() =>
      disconnectDB()
        .catch(() => {})
        .finally(() => process.exit(1))
    );
});

process.on("unhandledRejection", (reason, promise) => {
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
    tags: { handler: "unhandledRejection" },
  });
  logger.error("UNHANDLED REJECTION:", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // unhandledRejection은 로그만 남기고 계속 실행 (프로세스 종료 안 함)
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  mqttService.disconnect();
  await disconnectDB();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully...");
  mqttService.disconnect();
  await disconnectDB();
  process.exit(0);
});

export default app;
