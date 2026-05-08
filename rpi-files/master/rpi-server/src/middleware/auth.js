/**
 * JWT 인증 미들웨어 (로컬)
 * RPi 로컬 사용자 인증
 */
const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  try {
    // 인증 헤더 확인
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: '인증 토큰이 필요합니다.' });
    }

    // 토큰 검증
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    // 토큰 만료 처리
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: '인증 토큰이 만료되었습니다.' });
    }
    return res.status(401).json({ success: false, message: '유효하지 않은 인증 토큰입니다.' });
  }
};

module.exports = { authenticate };
