/**
 * 로컬 접근 전용 미들웨어
 * Node-RED 등 내부 서비스만 접근 가능
 */
const localOnly = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

  if (!isLocal) {
    return res.status(403).json({ success: false, message: '로컬 접근만 허용됩니다.' });
  }
  next();
};

module.exports = { localOnly };
