// system-api.js — RPi 시스템 관리 API + setup 라우터 통합 (Express 기반)
// 포트 3100에서 독립 실행 (Node-RED와 분리)
// 위치: /home/lhk/smartfarm/rpi-server/src/system-api.js
// 의존성: express (rpi-server/node_modules/express 사용)

// Sentry(GlitchTip) — 반드시 다른 require 보다 먼저.
// 2026-08-26 추가. 그전까지 이 프로세스의 예외는 어디에도 보고되지 않았다.
// instrument.js 가 dotenv 로 GLITCHTIP_DSN 을 읽으므로 cwd 가 rpi-server 여야 한다.
require('./instrument');
const Sentry = require('@sentry/node');

const express = require('express');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');

const app = express();
const PORT = 3100;
const FARM_ID_FILE = '/home/lhk/smartfarm/.farm-id';

// ─────────── 미들웨어 ───────────
app.use(express.json({ limit: '10mb' }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─────────── 헬퍼 ───────────
function readFarmId() {
  try {
    const raw = fs.readFileSync(FARM_ID_FILE, 'utf8').trim();
    if (raw && raw !== 'UNSET') return raw;
  } catch (e) { /* 파일 없음 */ }
  return process.env.FARM_ID || null;
}

function primaryIPv4() {
  const nets = os.networkInterfaces();
  for (const name in nets) {
    for (const n of (nets[name] || [])) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}

function getPm2Status(name) {
  return new Promise((resolve) => {
    exec('pm2 jlist', (err, stdout) => {
      if (err) return resolve(null);
      try {
        const list = JSON.parse(stdout);
        const proc = list.find(p => p.name === name);
        if (!proc) return resolve(null);
        resolve({
          name: proc.name,
          status: proc.pm2_env.status,
          uptime: proc.pm2_env.pm_uptime,
          restarts: proc.pm2_env.restart_time,
          memory: proc.monit ? proc.monit.memory : 0,
          cpu: proc.monit ? proc.monit.cpu : 0,
        });
      } catch (e) { resolve(null); }
    });
  });
}

function restartPm2(name) {
  return new Promise((resolve) => {
    exec('pm2 restart ' + name, (err, stdout) => {
      if (err) return resolve({ success: false, error: err.message });
      resolve({ success: true, output: stdout.trim() });
    });
  });
}

// ─────────── 시스템 관리 라우트 ───────────

// GET /api/system/info — 농장 ID 동적 조회 (터치패널·팜로컬 자동 로그인용)
// 빌드 타임 VITE_FARM_ID 의존성 제거. 표준 이미지가 새 농장에서도 정상 동작.
app.get('/api/system/info', (req, res) => {
  const farmId = readFarmId();
  res.json({
    success: true,
    farmId,
    configured: !!farmId,             // false 이면 setup 페이지로 유도
    hostname: os.hostname(),
    ipv4: primaryIPv4(),
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/system/status — PM2 프로세스 상태
app.get('/api/system/status', async (req, res) => {
  const [nodeRed, rpiExpress] = await Promise.all([
    getPm2Status('node-red'),
    getPm2Status('smartfarm-rpi'),
  ]);
  res.json({ nodeRed, rpiExpress, timestamp: new Date().toISOString() });
});

// GET /api/system/ip — RPi LAN IP (apiSwitcher 가 RPi 헬스체크 용도)
// 트랩 20 fix (2026-05-09): App.jsx 가 RPi LAN IP 조회 시 404 → "서버 연결 실패" 박스
app.get('/api/system/ip', (req, res) => {
  res.json({ success: true, ip: primaryIPv4(), hostname: os.hostname() });
});

// GET /api/system/mode — apiSwitcher 헬스체크 용도 (RPi 살아있음 시그널)
// 트랩 20 fix (2026-05-09): apiSwitcher 가 mode 조회 → 404 → 헬스체크 실패 → 잘못된 모드 전환
app.get('/api/system/mode', (req, res) => {
  const farmId = readFarmId();
  res.json({
    success: true,
    mode: farmId && farmId !== 'UNSET' ? 'farm-local' : 'setup',
    farmId,
    timestamp: new Date().toISOString(),
  });
});

// POST /api/system/restart-nodered
app.post('/api/system/restart-nodered', async (req, res) => {
  const result = await restartPm2('node-red');
  res.status(result.success ? 200 : 500).json(result);
});

// POST /api/system/restart-express
app.post('/api/system/restart-express', async (req, res) => {
  const result = await restartPm2('smartfarm-rpi');
  res.status(result.success ? 200 : 500).json(result);
});

// ─────────── Setup 라우터 마운트 ───────────
// /setup        → setup.js router.get('/')  : 설정 웹 페이지
// /setup/apply  → setup.js router.post('/apply') : 장비코드 적용
try {
  const setupRouter = require('./setup');
  app.use('/setup', setupRouter);
  console.log('[system-api] setup 라우터 마운트 완료');
} catch (e) {
  console.error('[system-api] setup 라우터 로드 실패:', e.message);
}

// ─────────── 404 ───────────
// Express 예외 자동 캡처 — 404 핸들러보다 앞에 와야 한다
Sentry.setupExpressErrorHandler(app);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.url });
});

// ─────────── 시작 ───────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('[system-api] listening on port ' + PORT + ' (Express + setup 통합)');
});
