/**
 * LAN + Tailscale 대역만 허용하는 미들웨어
 * - LAN: 192.168.x.x
 * - Tailscale: 100.64.0.0/10 (100.64.0.0 ~ 100.127.255.255)
 * - Localhost: 127.0.0.1, ::1
 */
const lanTailscale = (req, res, next) => {
  const raw = req.ip || req.connection.remoteAddress || '';
  const ip = raw.replace(/^::ffff:/, '');
  const isLocal = ip === '127.0.0.1' || ip === '::1';
  const isLAN = /^192\.168\.\d+\.\d+$/.test(ip);
  const isTailscale = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

  if (!isLocal && !isLAN && !isTailscale) {
    return res.status(403).json({
      success: false,
      message: 'Local/LAN/Tailscale 접근만 허용됩니다.',
      ip,
    });
  }
  next();
};

module.exports = { lanTailscale };
