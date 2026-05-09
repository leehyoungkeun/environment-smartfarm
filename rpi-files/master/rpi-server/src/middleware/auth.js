/**
 * JWT 인증 미들웨어 (로컬)
 * RPi 로컬 사용자 인증
 *
 * 트랩 19 fix (2026-05-09): farm-local 키오스크 (chromium http://localhost) 가
 * /api/sensors·control·programs 등 server.js 보호 endpoint 호출 시 401 발생 →
 * 자동 로그인 직후 "인증 오류" 박스. nginx 가 X-Real-IP 로 진짜 클라이언트 IP 전달.
 * 127.0.0.1 / ::1 / ::ffff:127.0.0.1 (loopback) 호출은 RPi 자체 키오스크 이므로 인증 우회.
 */
const jwt = require('jsonwebtoken');

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLocalRequest(req) {
  // nginx 가 proxy_set_header X-Real-IP $remote_addr 로 전달
  const realIp = req.headers['x-real-ip'];
  const forwardedFor = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const remoteIp = req.connection?.remoteAddress || req.socket?.remoteAddress;
  // X-Real-IP 우선, 다음 X-Forwarded-For, 마지막 직접 연결 IP
  const clientIp = realIp || forwardedFor || remoteIp;
  return LOOPBACK_IPS.has(clientIp);
}

const authenticate = (req, res, next) => {
  // localhost (RPi 자체 키오스크) 호출은 인증 우회 — admin 권한 자동 부여
  if (isLocalRequest(req)) {
    req.user = { id: 1, username: 'admin', source: 'farm-local' };
    return next();
  }

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
