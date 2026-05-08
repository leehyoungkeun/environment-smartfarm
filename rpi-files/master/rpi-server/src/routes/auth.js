/**
 * 로컬 인증 라우트
 * 로그인 및 비밀번호 변경 처리
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { LocalUser } = require('../models');
const { authenticate } = require('../middleware/auth');

/**
 * POST /api/auth/login
 * 로컬 사용자 로그인
 */
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    // 필수 필드 검증
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '사용자명과 비밀번호를 입력해주세요.' });
    }

    // 사용자 조회
    const user = LocalUser.findByUsername(username);
    if (!user) {
      return res.status(401).json({ success: false, message: '사용자명 또는 비밀번호가 올바르지 않습니다.' });
    }

    // 비밀번호 확인
    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: '사용자명 또는 비밀번호가 올바르지 않습니다.' });
    }

    // JWT 토큰 생성
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username }
    });
  } catch (error) {
    console.error('로그인 처리 중 오류:', error);
    res.status(500).json({ success: false, message: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

/**
 * PUT /api/auth/change-password
 * 비밀번호 변경 (인증 필요)
 */
router.put('/change-password', authenticate, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // 필수 필드 검증
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '현재 비밀번호와 새 비밀번호를 입력해주세요.' });
    }

    // 새 비밀번호 최소 길이 검증
    if (newPassword.length < 4) {
      return res.status(400).json({ success: false, message: '새 비밀번호는 최소 4자 이상이어야 합니다.' });
    }

    // 현재 사용자 조회
    const user = LocalUser.findByUsername(req.user.username);
    if (!user) {
      return res.status(404).json({ success: false, message: '사용자를 찾을 수 없습니다.' });
    }

    // 현재 비밀번호 확인
    const isMatch = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: '현재 비밀번호가 올바르지 않습니다.' });
    }

    // 새 비밀번호 해시 생성 및 업데이트
    const newHash = bcrypt.hashSync(newPassword, 10);
    LocalUser.updatePassword(req.user.username, newHash);

    res.json({ success: true, message: '비밀번호가 변경되었습니다.' });
  } catch (error) {
    console.error('비밀번호 변경 중 오류:', error);
    res.status(500).json({ success: false, message: '비밀번호 변경 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
