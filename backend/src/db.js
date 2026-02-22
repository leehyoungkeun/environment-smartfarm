// src/db.js
// 데이터베이스 연결 관리
// - Prisma Client: 관계형 테이블 (users, house_configs, automation_rules)
// - pg Pool: 시계열 테이블 raw SQL (sensor_data, control_logs, alerts)

import { PrismaClient } from "@prisma/client";
import pg from "pg";
import logger from "./utils/logger.js";

const { Pool } = pg;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Prisma Client (관계형)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"],
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// pg Pool (시계열 raw SQL)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "smartfarm",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "smartfarm_db",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000, // 쿼리 30초 타임아웃 (hang 방지)
  query_timeout: 30000,
  keepAlive: true, // TCP keepalive 활성화
  keepAliveInitialDelayMillis: 10000,
  application_name: "smartfarm-backend",
});

pool.on("error", (err) => {
  logger.error("PostgreSQL pool error — 연결 복구 시도 중:", err.message);
  // Pool이 자동으로 dead client를 제거하고 새 연결을 생성함
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 연결 테스트
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function connectDB() {
  try {
    await prisma.$connect();
    logger.info("✅ Prisma (PostgreSQL) Connected");

    const client = await pool.connect();
    const result = await client.query("SELECT NOW()");
    client.release();
    logger.info(
      `✅ pg Pool Connected - Server time: ${result.rows[0].now}`
    );

    // 스키마 마이그레이션: operator_name 컬럼 추가 (없는 경우)
    try {
      await pool.query(`
        ALTER TABLE control_logs ADD COLUMN IF NOT EXISTS operator_name TEXT
      `);
    } catch {
      // 테이블 미존재 시 무시 (init-timescale.sql로 생성)
    }

    // system_settings 테이블 생성 (없는 경우)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          farm_id TEXT PRIMARY KEY,
          settings JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } catch {
      // 테이블 미존재 시 무시
    }

    // TimescaleDB 확인
    try {
      const tsResult = await pool.query(
        "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"
      );
      if (tsResult.rows.length > 0) {
        logger.info(
          `   TimescaleDB version: ${tsResult.rows[0].extversion}`
        );
      } else {
        logger.warn(
          "⚠️  TimescaleDB extension not found - 시계열 기능 제한됨"
        );
      }
    } catch {
      logger.warn("⚠️  TimescaleDB 확인 실패");
    }

    return true;
  } catch (error) {
    logger.error("❌ Database Connection Error:", error);
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 연결 종료
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function disconnectDB() {
  await prisma.$disconnect();
  await pool.end();
  logger.info("Database connections closed");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Health check helper
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function checkDBHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const poolResult = await pool.query("SELECT 1");
    return {
      prisma: "connected",
      pool: "connected",
      totalPoolClients: pool.totalCount,
      idlePoolClients: pool.idleCount,
      waitingPoolClients: pool.waitingCount,
    };
  } catch (error) {
    return {
      prisma: "error",
      pool: "error",
      error: error.message,
    };
  }
}

export { prisma, pool };
export default prisma;
