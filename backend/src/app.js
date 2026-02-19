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


import { connectDB, disconnectDB, checkDBHealth, prisma } from "./db.js";
import bcrypt from "bcryptjs";
import configRoutes from "./routes/config.routes.js";
import sensorsRoutes from "./routes/sensors.js";
import alertsRoutes from "./routes/alerts.js";
import controlLogRoutes from "./routes/control-logs.js";
import automationRoutes from "./routes/automation.routes.js";
import authRoutes from "./routes/auth.routes.js";
import {
  authenticate,
  authenticateApiKey,
  enforceTenant,
} from "./middleware/auth.middleware.js";
import logger from "./utils/logger.js";

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
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
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
    const dbHealth = await checkDBHealth();

    res.json({
      success: true,
      timestamp: new Date(),
      uptime: process.uptime(),
      services: {
        database: dbHealth,
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

// 센서 + 설정 API (API 키 또는 JWT - Node-RED 접근 필요)
app.use("/api/sensors", authenticateApiKey, sensorsRoutes);
app.use("/api/config", authenticateApiKey, configRoutes);
app.use("/api/automation", authenticateApiKey, automationRoutes);

// JWT 인증 필수 API (테넌트 격리 적용)
app.use("/api/alerts", authenticate, enforceTenant, alertsRoutes);
app.use("/api/control-logs", authenticate, enforceTenant, controlLogRoutes);

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
    const count = await prisma.user.count();
    if (count === 0) {
      const hash = await bcrypt.hash("admin1234", 12);
      await prisma.user.create({
        data: {
          username: "admin",
          password: hash,
          name: "관리자",
          role: "admin",
          farmId: "farm_001",
          allowedHouses: [],
          enabled: true,
        },
      });
      logger.info("[AUTH] 초기 admin 계정 생성됨 (admin / admin1234)");
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
