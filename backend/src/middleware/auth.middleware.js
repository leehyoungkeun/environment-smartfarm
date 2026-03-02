// src/middleware/auth.middleware.js
// JWT 인증 미들웨어 - PostgreSQL 버전
// 변경점: User.findById → PostgreSQL 조회

import jwt from "jsonwebtoken";
import User, { ROLE_HIERARCHY, SYSTEM_WIDE_ROLES } from "../models/User.js";
import { prisma } from "../db.js";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "7d";

// 필수 환경변수 검증 — 미설정 시 서버 시작 차단
if (!JWT_SECRET || JWT_SECRET.includes("change-in-production")) {
  console.error("FATAL: JWT_SECRET 환경변수가 설정되지 않았거나 기본값입니다. .env 파일을 확인하세요.");
  process.exit(1);
}
if (!JWT_REFRESH_SECRET || JWT_REFRESH_SECRET.includes("change-in-production")) {
  console.error("FATAL: JWT_REFRESH_SECRET 환경변수가 설정되지 않았거나 기본값입니다. .env 파일을 확인하세요.");
  process.exit(1);
}

/**
 * JWT 토큰 생성
 * 변경: user._id → user._id || user.id (UUID 호환)
 */
export const generateTokens = (user) => {
  const payload = {
    id: user._id || user.id,
    username: user.username,
    role: user.role,
    farmId: user.farmId,
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
  const refreshToken = jwt.sign(
    { id: user._id || user.id },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );

  return { accessToken, refreshToken };
};

/**
 * JWT 인증 미들웨어
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "인증 토큰이 필요합니다",
        code: "NO_TOKEN",
      });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          error: "토큰이 만료되었습니다",
          code: "TOKEN_EXPIRED",
        });
      }
      return res.status(401).json({
        success: false,
        error: "유효하지 않은 토큰입니다",
        code: "INVALID_TOKEN",
      });
    }

    // 사용자 조회 (PostgreSQL)
    const user = await User.findById(decoded.id);
    if (!user || !user.enabled) {
      return res.status(401).json({
        success: false,
        error: "사용자를 찾을 수 없거나 비활성화되었습니다",
        code: "USER_NOT_FOUND",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: "인증 처리 중 오류가 발생했습니다",
    });
  }
};

/**
 * 역할 기반 접근제어 미들웨어
 * 계층 모드: authorize('manager') → manager 이상(superadmin, manager) 허용
 * 명시 모드: authorize('owner','worker') → 정확히 해당 역할만 허용
 * 혼합 가능: 전달된 역할 중 하나라도 계층적으로 허용이면 통과
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "인증이 필요합니다",
        code: "NOT_AUTHENTICATED",
      });
    }

    const userLevel = ROLE_HIERARCHY[req.user.role]?.level;
    if (userLevel === undefined) {
      return res.status(403).json({
        success: false,
        error: "알 수 없는 역할입니다",
        code: "UNKNOWN_ROLE",
      });
    }

    // 계층 비교: 요청된 역할 중 하나라도 사용자 레벨 이하이면 허용
    const allowed = roles.some((role) => {
      const requiredLevel = ROLE_HIERARCHY[role]?.level;
      return requiredLevel !== undefined && userLevel <= requiredLevel;
    });

    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: "접근 권한이 없습니다",
        code: "FORBIDDEN",
        required: roles,
        current: req.user.role,
      });
    }

    next();
  };
};

/**
 * 테넌트 격리 미들웨어
 * req.params.farmId가 JWT 사용자의 farmId와 일치하는지 확인
 * API Key(디바이스) 요청은 farmId 검증을 건너뜀
 * 멀티팜: UserFarm 테이블 조회로 다중 농장 접근 지원
 */
export const enforceTenant = async (req, res, next) => {
  // 디바이스(API Key) 요청은 통과
  if (req.isDevice) return next();

  const paramFarmId = req.params.farmId;
  if (!paramFarmId) return next();

  // 시스템 전역 역할(superadmin, manager)은 모든 farmId 접근 가능
  if (req.user && SYSTEM_WIDE_ROLES.includes(req.user.role)) return next();

  // 기존 단일 farmId 비교 (빠른 경로)
  if (req.user && req.user.farmId === paramFarmId) return next();

  // 멀티팜: UserFarm 테이블에서 접근 권한 조회
  if (req.user) {
    try {
      const userFarm = await prisma.userFarm.findUnique({
        where: {
          userId_farmId: {
            userId: req.user.id,
            farmId: paramFarmId,
          },
        },
      });
      if (userFarm) return next();
    } catch {
      // UserFarm 테이블 없으면 기존 로직으로 폴백
    }
  }

  return res.status(403).json({
    success: false,
    error: "해당 농장에 접근 권한이 없습니다",
    code: "FARM_ACCESS_DENIED",
  });
};

/**
 * API 키 인증 (Node-RED 등 장치용)
 * 멀티팜: Farm 테이블에서 apiKey 조회 → req.farmId 설정
 * 폴백: env SENSOR_API_KEY 비교 (기존 RPi 호환)
 */
export const authenticateApiKey = async (req, res, next) => {
  const apiKey = req.headers["x-api-key"] || req.query.apiKey;

  if (apiKey) {
    // 1) Farm 테이블에서 API key 조회
    try {
      const farm = await prisma.farm.findUnique({ where: { apiKey } });
      if (farm) {
        req.isDevice = true;
        req.farmId = farm.farmId;
        // lastSeenAt 비동기 업데이트 (응답 차단 안 함)
        prisma.farm.update({
          where: { id: farm.id },
          data: { lastSeenAt: new Date() },
        }).catch(() => {});
        return next();
      }
    } catch {
      // Farm 테이블 없으면 env 폴백
    }

    // 2) env SENSOR_API_KEY 폴백 (기존 RPi 호환)
    const validApiKey = process.env.SENSOR_API_KEY;
    if (validApiKey && apiKey === validApiKey) {
      req.isDevice = true;
      // farmId를 요청에서 추출 (URL 파라미터 > body > query > env 기본값)
      req.farmId = req.params?.farmId || req.body?.farmId || req.query?.farmId || process.env.FARM_ID || "farm_0001";
      return next();
    }
  }

  // API 키가 없거나 불일치 → JWT 인증으로 폴백
  return authenticate(req, res, next);
};

export default {
  generateTokens,
  authenticate,
  authorize,
  authenticateApiKey,
  enforceTenant,
};
