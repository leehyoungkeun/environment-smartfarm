// src/routes/auth.routes.js
// 인증 API - PostgreSQL 버전
// API 요청/응답 형태 동일 유지

import express from "express";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import {
  generateTokens,
  authenticate,
  authorize,
} from "../middleware/auth.middleware.js";
import logger from "../utils/logger.js";

const router = express.Router();

const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

// =========================================
// 공개 API (인증 불필요)
// =========================================

/**
 * POST /api/auth/login
 */
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ success: false, error: "사용자 ID와 비밀번호를 입력하세요" });
    }

    // 사용자 조회 (비밀번호 포함)
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "사용자 ID 또는 비밀번호가 잘못되었습니다",
      });
    }

    if (!user.enabled) {
      return res.status(403).json({
        success: false,
        error: "비활성화된 계정입니다. 관리자에게 문의하세요",
      });
    }

    // 비밀번호 검증
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: "사용자 ID 또는 비밀번호가 잘못되었습니다",
      });
    }

    // 토큰 생성
    const { accessToken, refreshToken } = generateTokens(user);

    // 리프레시 토큰 저장
    user.refreshToken = refreshToken;
    user.lastLoginAt = new Date();
    await user.save();

    logger.info(`✅ 로그인 성공: ${user.username} (${user.role})`);

    res.json({
      success: true,
      data: {
        user: user.toJSON(),
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    logger.error("로그인 실패:", error);
    res
      .status(500)
      .json({ success: false, error: "로그인 처리 중 오류가 발생했습니다" });
  }
});

/**
 * POST /api/auth/refresh
 */
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res
        .status(400)
        .json({ success: false, error: "리프레시 토큰이 필요합니다" });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: "리프레시 토큰이 만료되었습니다. 다시 로그인하세요",
        code: "REFRESH_EXPIRED",
      });
    }

    // 사용자 조회 + 리프레시 토큰 비교
    const user = await User.findById(decoded.id);
    if (!user || !user.enabled || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        error: "유효하지 않은 리프레시 토큰입니다",
      });
    }

    // 새 토큰 생성
    const tokens = generateTokens(user);
    user.refreshToken = tokens.refreshToken;
    await user.save();

    res.json({
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    });
  } catch (error) {
    logger.error("토큰 갱신 실패:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/auth/setup
 * 초기 관리자 계정 생성
 */
router.post("/setup", async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    if (userCount > 0) {
      return res
        .status(403)
        .json({ success: false, error: "이미 초기 설정이 완료되었습니다" });
    }

    const { username, password, name } = req.body;
    if (!username || !password || !name) {
      return res.status(400).json({
        success: false,
        error: "사용자 ID, 비밀번호, 이름은 필수입니다",
      });
    }

    const admin = await User.create({
      username,
      password,
      name,
      role: "admin",
      farmId: process.env.FARM_ID || "farm_001",
    });

    const { accessToken, refreshToken } = generateTokens(admin);
    admin.refreshToken = refreshToken;
    await admin.save();

    logger.info(`🎉 초기 관리자 생성: ${admin.username}`);

    res.json({
      success: true,
      data: {
        user: admin.toJSON(),
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    logger.error("초기 설정 실패:", error);
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/auth/check-setup
 */
router.get("/check-setup", async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    res.json({ success: true, data: { needsSetup: userCount === 0 } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =========================================
// 인증 필요 API
// =========================================

/**
 * GET /api/auth/me
 */
router.get("/me", authenticate, (req, res) => {
  res.json({ success: true, data: req.user.toJSON() });
});

/**
 * POST /api/auth/logout
 */
router.post("/logout", authenticate, async (req, res) => {
  try {
    req.user.refreshToken = null;
    await req.user.save();
    res.json({ success: true, message: "로그아웃되었습니다" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/auth/change-password
 */
router.put("/change-password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ success: false, error: "현재 비밀번호와 새 비밀번호를 입력하세요" });
    }

    if (newPassword.length < 4) {
      return res
        .status(400)
        .json({ success: false, error: "비밀번호는 최소 4자 이상이어야 합니다" });
    }

    const user = await User.findById(req.user._id || req.user.id);
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res
        .status(400)
        .json({ success: false, error: "현재 비밀번호가 잘못되었습니다" });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: "비밀번호가 변경되었습니다" });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// =========================================
// 관리자 전용 API
// =========================================

/**
 * GET /api/auth/users
 */
router.get("/users", authenticate, authorize("admin"), async (req, res) => {
  try {
    const users = await User.find();
    res.json({ success: true, data: users.map((u) => u.toJSON()) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/auth/users
 */
router.post("/users", authenticate, authorize("admin"), async (req, res) => {
  try {
    const { username, password, name, role, farmId, allowedHouses } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({
        success: false,
        error: "사용자 ID, 비밀번호, 이름은 필수입니다",
      });
    }

    // 허용된 역할만 허용
    const VALID_ROLES = ["admin", "worker"];
    const validatedRole = VALID_ROLES.includes(role) ? role : "worker";

    const user = await User.create({
      username,
      password,
      name,
      role: validatedRole,
      farmId: farmId || req.user.farmId,
      allowedHouses: allowedHouses || [],
    });

    logger.info(
      `👤 사용자 생성: ${user.username} (${user.role}) by ${req.user.username}`
    );
    res.json({ success: true, data: user.toJSON() });
  } catch (error) {
    // 중복 키 에러 처리 (Prisma unique constraint)
    if (error.code === "P2002") {
      return res
        .status(400)
        .json({ success: false, error: "이미 존재하는 사용자 ID입니다" });
    }
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/auth/users/:userId
 */
router.put(
  "/users/:userId",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { name, role, enabled, allowedHouses, password } = req.body;

      const user = await User.findById(userId);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, error: "사용자를 찾을 수 없습니다" });
      }

      const VALID_ROLES = ["admin", "worker"];
      if (name !== undefined) user.name = name;
      if (role !== undefined && VALID_ROLES.includes(role)) user.role = role;
      if (enabled !== undefined) user.enabled = enabled;
      if (allowedHouses !== undefined) user.allowedHouses = allowedHouses;
      if (password) user.password = password;

      await user.save();

      logger.info(
        `✏️ 사용자 수정: ${user.username} by ${req.user.username}`
      );
      res.json({ success: true, data: user.toJSON() });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
);

/**
 * DELETE /api/auth/users/:userId
 */
router.delete(
  "/users/:userId",
  authenticate,
  authorize("admin"),
  async (req, res) => {
    try {
      const { userId } = req.params;

      // 자기 자신 삭제 방지
      const currentId = req.user._id || req.user.id;
      if (userId === currentId.toString()) {
        return res
          .status(400)
          .json({ success: false, error: "자신의 계정은 삭제할 수 없습니다" });
      }

      const user = await User.findByIdAndDelete(userId);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, error: "사용자를 찾을 수 없습니다" });
      }

      logger.info(
        `🗑️ 사용자 삭제: ${user.username} by ${req.user.username}`
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

export default router;
