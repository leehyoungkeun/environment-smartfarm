// src/routes/auth.routes.js
// 인증 API - PostgreSQL 버전
// API 요청/응답 형태 동일 유지

import express from "express";
import jwt from "jsonwebtoken";
import User, {
  VALID_ROLES,
  ROLE_HIERARCHY,
  SYSTEM_WIDE_ROLES,
  canCreateRole,
  canManageRole,
} from "../models/User.js";
import { prisma } from "../db.js";
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

    // 유저가 접근 가능한 농장 목록 조회
    let farms = [];
    try {
      if (SYSTEM_WIDE_ROLES.includes(user.role)) {
        // superadmin/manager: 전체 농장 목록
        const allFarms = await prisma.farm.findMany({
          where: { deletedAt: null },
          select: { farmId: true, name: true, location: true, status: true },
          orderBy: { farmId: "asc" },
        });
        farms = allFarms.map((f) => ({ farmId: f.farmId, name: f.name, location: f.location, status: f.status, role: "admin" }));
      } else {
        const userFarms = await prisma.userFarm.findMany({
          where: { userId: user.id },
          include: { farm: { select: { farmId: true, name: true, location: true, status: true } } },
        });
        farms = userFarms.map((uf) => ({
          farmId: uf.farm.farmId,
          name: uf.farm.name,
          location: uf.farm.location,
          status: uf.farm.status,
          role: uf.role,
        }));
      }
    } catch {
      // Farm 테이블 없으면 기본값 폴백
    }
    if (farms.length === 0) {
      // user_farms에 할당이 없는 경우: farmId로 직접 조회
      try {
        const farm = await prisma.farm.findFirst({ where: { farmId: user.farmId }, select: { farmId: true, name: true, location: true, status: true } });
        if (farm) farms = [{ farmId: farm.farmId, name: farm.name, location: farm.location, status: farm.status, role: "viewer" }];
      } catch {}
    }
    if (farms.length === 0) {
      farms = [{ farmId: user.farmId, name: user.farmId, status: "active", role: "viewer" }];
    }

    res.json({
      success: true,
      data: {
        user: { ...user.toJSON(), farms },
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
      role: "superadmin",
      farmId: process.env.FARM_ID || "farm_0001",
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
router.get("/me", authenticate, async (req, res) => {
  try {
    // 유저가 접근 가능한 농장 목록 조회 (login과 동일)
    let farms = [];
    if (SYSTEM_WIDE_ROLES.includes(req.user.role)) {
      // superadmin/manager: 전체 농장 목록
      const allFarms = await prisma.farm.findMany({
        where: { deletedAt: null },
        select: { farmId: true, name: true, location: true, status: true },
        orderBy: { farmId: "asc" },
      });
      farms = allFarms.map((f) => ({ farmId: f.farmId, name: f.name, location: f.location, status: f.status, role: "admin" }));
    } else {
      const userFarms = await prisma.userFarm.findMany({
        where: { userId: req.user.id },
        include: { farm: { select: { farmId: true, name: true, location: true, status: true } } },
      });
      farms = userFarms.map((uf) => ({ farmId: uf.farm.farmId, name: uf.farm.name, location: uf.farm.location, status: uf.farm.status, role: uf.role }));
    }

    res.json({ success: true, data: { ...req.user.toJSON(), farms } });
  } catch (error) {
    res.json({ success: true, data: req.user.toJSON() });
  }
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
 * GET /api/auth/check-username/:username
 * 사용자 ID 중복 확인 (owner 이상)
 */
router.get("/check-username/:username", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { username } = req.params;
    if (!username || username.trim().length < 3) {
      return res.json({ success: true, data: { available: false, reason: "3자 이상 입력해주세요" } });
    }
    const existing = await User.findOne({ username: username.trim() });
    res.json({
      success: true,
      data: { available: !existing, reason: existing ? "이미 사용 중인 아이디입니다" : "사용 가능한 아이디입니다" },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/auth/users
 * owner 이상 접근 가능
 * - superadmin/manager: 전체 사용자 목록
 * - owner: 자기 농장의 하위 역할(worker)만
 */
router.get("/users", authenticate, authorize("owner"), async (req, res) => {
  try {
    const myRole = req.user.role;
    let users;

    if (SYSTEM_WIDE_ROLES.includes(myRole)) {
      // superadmin/manager: 전체 사용자 조회
      users = await User.find();
    } else {
      // owner: 자기 농장 사용자만 (하위 역할)
      users = await User.find({ farmId: req.user.farmId });
      const myLevel = ROLE_HIERARCHY[myRole]?.level ?? 99;
      users = users.filter((u) => {
        const uLevel = ROLE_HIERARCHY[u.role]?.level ?? 0;
        return uLevel > myLevel || u.id === req.user.id;
      });
    }

    res.json({ success: true, data: users.map((u) => u.toJSON()) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/auth/users
 * owner 이상 접근 가능 — canCreate 검증
 */
router.post("/users", authenticate, authorize("owner"), async (req, res) => {
  try {
    const { username, password, name, role, farmId, allowedHouses } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({
        success: false,
        error: "사용자 ID, 비밀번호, 이름은 필수입니다",
      });
    }

    // 역할 검증: VALID_ROLES에 포함 + 요청자가 생성 가능한 역할인지
    const targetRole = VALID_ROLES.includes(role) ? role : "worker";
    if (!canCreateRole(req.user.role, targetRole)) {
      return res.status(403).json({
        success: false,
        error: `${ROLE_HIERARCHY[req.user.role]?.label || req.user.role}은(는) ${ROLE_HIERARCHY[targetRole]?.label || targetRole} 역할을 생성할 수 없습니다`,
        code: "ROLE_CREATE_DENIED",
      });
    }

    // owner는 자기 농장에만 사용자 생성 가능
    const targetFarmId = farmId || req.user.farmId;
    if (!SYSTEM_WIDE_ROLES.includes(req.user.role) && targetFarmId !== req.user.farmId) {
      return res.status(403).json({
        success: false,
        error: "다른 농장에 사용자를 생성할 수 없습니다",
        code: "FARM_CREATE_DENIED",
      });
    }

    const user = await User.create({
      username,
      password,
      name,
      role: targetRole,
      farmId: targetFarmId,
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
 * PUT /api/auth/users/batch
 * manager 이상 — 일괄 역할변경 / 활성화 / 비활성화
 */
router.put(
  "/users/batch",
  authenticate,
  authorize("manager"),
  async (req, res) => {
    try {
      const { userIds, action, role } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ success: false, error: "userIds 배열 필요" });
      }
      if (!["changeRole", "enable", "disable"].includes(action)) {
        return res.status(400).json({ success: false, error: "action: changeRole|enable|disable" });
      }
      if (action === "changeRole" && (!role || !VALID_ROLES.includes(role))) {
        return res.status(400).json({ success: false, error: "유효한 role 필요" });
      }

      const currentId = (req.user._id || req.user.id).toString();
      let updated = 0, skipped = 0;

      for (const uid of userIds) {
        if (uid === currentId) { skipped++; continue; }
        const target = await User.findById(uid);
        if (!target) { skipped++; continue; }
        if (!canManageRole(req.user.role, target.role)) { skipped++; continue; }

        if (action === "changeRole") {
          if (!canCreateRole(req.user.role, role)) { skipped++; continue; }
          await prisma.user.update({ where: { id: uid }, data: { role } });
        } else if (action === "enable") {
          await prisma.user.update({ where: { id: uid }, data: { enabled: true } });
        } else {
          await prisma.user.update({ where: { id: uid }, data: { enabled: false } });
        }
        updated++;
      }

      logger.info(`일괄 ${action}: ${updated}건 처리, ${skipped}건 건너뜀 by ${req.user.username}`);
      res.json({ success: true, data: { updated, skipped } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * DELETE /api/auth/users/batch
 * manager 이상 — 일괄 삭제
 */
router.delete(
  "/users/batch",
  authenticate,
  authorize("manager"),
  async (req, res) => {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ success: false, error: "userIds 배열 필요" });
      }

      const currentId = (req.user._id || req.user.id).toString();
      let deleted = 0, skipped = 0;

      for (const uid of userIds) {
        if (uid === currentId) { skipped++; continue; }
        const target = await User.findById(uid);
        if (!target) { skipped++; continue; }
        if (!canManageRole(req.user.role, target.role)) { skipped++; continue; }
        await User.findByIdAndDelete(uid);
        deleted++;
      }

      logger.info(`일괄 삭제: ${deleted}건 처리, ${skipped}건 건너뜀 by ${req.user.username}`);
      res.json({ success: true, data: { deleted, skipped } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
);

/**
 * PUT /api/auth/users/:userId
 * owner 이상 — 하위 역할만 수정 가능
 */
router.put(
  "/users/:userId",
  authenticate,
  authorize("owner"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { name, role, enabled, allowedHouses, password, farmId } = req.body;

      const user = await User.findById(userId);
      if (!user) {
        return res
          .status(404)
          .json({ success: false, error: "사용자를 찾을 수 없습니다" });
      }

      // 자기 자신은 이름/비밀번호만 수정 가능
      const isSelf = userId === (req.user._id || req.user.id);
      if (isSelf) {
        if (name !== undefined) user.name = name;
        if (password) user.password = password;
        await user.save();
        return res.json({ success: true, data: user.toJSON() });
      }

      // 하위 역할만 수정 가능
      if (!canManageRole(req.user.role, user.role)) {
        return res.status(403).json({
          success: false,
          error: "상위 또는 동급 역할의 사용자를 수정할 수 없습니다",
          code: "ROLE_MANAGE_DENIED",
        });
      }

      // owner는 자기 농장 사용자만 수정 가능
      if (!SYSTEM_WIDE_ROLES.includes(req.user.role) && user.farmId !== req.user.farmId) {
        return res.status(403).json({
          success: false,
          error: "다른 농장의 사용자를 수정할 수 없습니다",
          code: "FARM_MANAGE_DENIED",
        });
      }

      if (name !== undefined) user.name = name;
      if (role !== undefined && VALID_ROLES.includes(role)) {
        // 변경 대상 역할도 생성 가능한 범위인지 확인
        if (!canCreateRole(req.user.role, role)) {
          return res.status(403).json({
            success: false,
            error: "해당 역할로 변경할 권한이 없습니다",
            code: "ROLE_CHANGE_DENIED",
          });
        }
        user.role = role;
      }
      if (enabled !== undefined) user.enabled = enabled;
      if (allowedHouses !== undefined) user.allowedHouses = allowedHouses;
      if (password) user.password = password;
      if (farmId && SYSTEM_WIDE_ROLES.includes(req.user.role)) user.farmId = farmId;

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
 * owner 이상 — 하위 역할만 삭제 가능
 */
router.delete(
  "/users/:userId",
  authenticate,
  authorize("owner"),
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

      // 대상 사용자 조회
      const targetUser = await User.findById(userId);
      if (!targetUser) {
        return res
          .status(404)
          .json({ success: false, error: "사용자를 찾을 수 없습니다" });
      }

      // 하위 역할만 삭제 가능
      if (!canManageRole(req.user.role, targetUser.role)) {
        return res.status(403).json({
          success: false,
          error: "상위 또는 동급 역할의 사용자를 삭제할 수 없습니다",
          code: "ROLE_DELETE_DENIED",
        });
      }

      // owner는 자기 농장 사용자만 삭제 가능
      if (!SYSTEM_WIDE_ROLES.includes(req.user.role) && targetUser.farmId !== req.user.farmId) {
        return res.status(403).json({
          success: false,
          error: "다른 농장의 사용자를 삭제할 수 없습니다",
          code: "FARM_DELETE_DENIED",
        });
      }

      const user = await User.findByIdAndDelete(userId);
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
