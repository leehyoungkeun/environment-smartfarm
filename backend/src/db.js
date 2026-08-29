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
    process.env.NODE_ENV === "production"
      ? ["error"]
      : [
          { level: "query", emit: "event" },
          { level: "error", emit: "stdout" },
          { level: "warn", emit: "stdout" },
        ],
});

// 개발 모드: 쿼리를 간결하게 출력 (모델·액션 + 소요시간)
if (process.env.NODE_ENV !== "production") {
  prisma.$on("query", (e) => {
    const q = e.query;
    // SELECT/INSERT/UPDATE/DELETE + 테이블명 추출
    const match = q.match(/^(SELECT|INSERT|UPDATE|DELETE).*?"public"\.?"(\w+)"/i);
    const tag = match ? `${match[1]} ${match[2]}` : q.slice(0, 60);
    logger.debug(`[Prisma] ${tag}  (${e.duration}ms)`);
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// pg Pool (시계열 raw SQL)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 연결 설정이 두 갈래다 — Prisma 는 DATABASE_URL, raw SQL 풀은 DB_HOST/DB_PORT/....
// 한쪽만 바꾸면 (DB 이사, 포트 변경 등) 조용히 서로 다른 DB 를 보게 된다.
// 그래서 DATABASE_URL 을 기본값으로 삼고, DB_* 는 명시적 재정의로만 취급한다.
// 둘이 어긋나면 시작 시 경고를 남긴다 (2026-08-29).
function dbUrlParts() {
  try {
    const u = new URL(process.env.DATABASE_URL || "");
    if (!/^postgres/.test(u.protocol)) return {};
    return {
      host: u.hostname || undefined,
      port: u.port ? parseInt(u.port) : undefined,
      user: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      database: u.pathname ? u.pathname.replace(/^\//, "") : undefined,
    };
  } catch {
    return {};
  }
}
const urlParts = dbUrlParts();
const poolConfig = {
  host: process.env.DB_HOST || urlParts.host || "localhost",
  port: parseInt(process.env.DB_PORT) || urlParts.port || 5432,
  user: process.env.DB_USER || urlParts.user || "smartfarm",
  password: process.env.DB_PASSWORD || urlParts.password || "",
  database: process.env.DB_NAME || urlParts.database || "smartfarm_db",
};
for (const [k, v] of Object.entries(urlParts)) {
  if (k === "password" || v === undefined) continue;
  if (String(poolConfig[k]) !== String(v)) {
    logger.warn(
      `DB 설정 불일치: raw SQL 풀은 ${k}=${poolConfig[k]}, DATABASE_URL 은 ${k}=${v} — ` +
        "Prisma 와 raw SQL 이 서로 다른 DB 를 본다. .env 의 DB_* 와 DATABASE_URL 을 맞출 것."
    );
  }
}

const pool = new Pool({
  ...poolConfig,
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
// Remote DB Pool (이중 저장용 - 114 서버)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const remoteEnabled = process.env.REMOTE_DB_ENABLED === "true";

const remotePool = remoteEnabled
  ? new Pool({
      host: process.env.REMOTE_DB_HOST,
      port: parseInt(process.env.REMOTE_DB_PORT) || 5432,
      user: process.env.REMOTE_DB_USER,
      password: process.env.REMOTE_DB_PASSWORD,
      database: process.env.REMOTE_DB_NAME || "smartfarm_db",
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      application_name: "smartfarm-remote",
    })
  : null;

if (remotePool) {
  remotePool.on("error", (err) => {
    logger.warn("Remote DB pool error (무시):", err.message);
  });
}

/**
 * 원격 DB에 비동기 저장 (실패 시 무시)
 */
export async function remoteQuery(text, params) {
  if (!remotePool) return null;
  try {
    return await remotePool.query(text, params);
  } catch (err) {
    logger.warn(`Remote DB 저장 실패 (무시): ${err.message}`);
    return null;
  }
}

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
