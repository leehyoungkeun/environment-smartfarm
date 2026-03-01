// src/app.js
// Express 메인 애플리케이션 - PostgreSQL + TimescaleDB 버전
// 변경: mongoose 제거 → Prisma + pg pool

import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import journalRoutes from "./routes/journal.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import farmsRoutes from "./routes/farms.routes.js";
import reportRoutes from "./routes/report.routes.js";

import { connectDB, disconnectDB, checkDBHealth, prisma } from "./db.js";
import bcrypt from "bcryptjs";
import configRoutes from "./routes/config.routes.js";
import sensorsRoutes from "./routes/sensors.js";
import alertsRoutes from "./routes/alerts.js";
import controlLogRoutes from "./routes/control-logs.js";
import automationRoutes from "./routes/automation.routes.js";
import authRoutes from "./routes/auth.routes.js";
import internalRoutes from "./routes/internal.routes.js";
import {
  authenticate,
  authenticateApiKey,
  enforceTenant,
} from "./middleware/auth.middleware.js";
import { getAlertHealth } from "./routes/sensors.js";
import logger from "./utils/logger.js";
import { startMaintenanceAlertScheduler } from "./schedulers/maintenanceAlert.js";
import { startOfflineAlertScheduler } from "./schedulers/offlineAlert.js";
import { startTrashCleanupScheduler } from "./schedulers/trashCleanup.js";
import { startSensorThresholdScheduler } from "./schedulers/sensorThresholdAlert.js";

const app = express();
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

// 공개 API (인증 불필요)
app.use("/api/auth", authRoutes);

// Node-RED 내부 통신 (로컬 네트워크 전용, 인증 불필요)
app.use("/internal", internalRoutes);

// 센서 + 설정 API (API 키 또는 JWT - Node-RED 접근 필요)
app.use("/api/sensors", authenticateApiKey, sensorsRoutes);
app.use("/api/config", authenticateApiKey, configRoutes);
app.use("/api/automation", authenticateApiKey, automationRoutes);

// 농장 관리 API (JWT 인증)
app.use("/api/farms", authenticate, farmsRoutes);

// JWT 인증 필수 API (테넌트 격리 적용)
app.use("/api/alerts", authenticate, enforceTenant, alertsRoutes);
app.use("/api/control-logs", authenticate, enforceTenant, controlLogRoutes);
app.use("/api/reports", authenticate, enforceTenant, reportRoutes);

app.use("/api/journal", authenticate, enforceTenant, journalRoutes);
app.use("/api/ai", authenticate, enforceTenant, aiRoutes);

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
            apiKey: process.env.SENSOR_API_KEY || "smartfarm-sensor-key",
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

    app.listen(PORT, "0.0.0.0", () => {
      logger.info(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌱 Configurable SmartFarm Backend Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Port: ${PORT}
   Environment: ${process.env.NODE_ENV || "development"}
   Database: PostgreSQL + TimescaleDB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `);
    });
  } catch (error) {
    logger.error("❌ Server startup failed:", error);
    process.exit(1);
  }
}

startServer();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 프로세스 안정성: 예외 핸들러
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

process.on("uncaughtException", (err) => {
  logger.error("UNCAUGHT EXCEPTION — 프로세스 종료 예정:", {
    message: err.message,
    stack: err.stack,
  });
  // DB 연결 정리 후 종료 (PM2가 자동 재시작)
  disconnectDB()
    .catch(() => {})
    .finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("UNHANDLED REJECTION:", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // unhandledRejection은 로그만 남기고 계속 실행 (프로세스 종료 안 함)
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  await disconnectDB();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully...");
  await disconnectDB();
  process.exit(0);
});

export default app;
