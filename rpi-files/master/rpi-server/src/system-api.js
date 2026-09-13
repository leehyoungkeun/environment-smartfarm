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

// ─────────── WiFi (키오스크에서 키보드 없이 농장 이동) ───────────
// 2026-09-13 추가. 농장을 옮길 때 새 WiFi 를 잡으려면 Ctrl+Alt+Del 로 키오스크를 빠져나와
// 키보드로 입력해야 했다. 터치만으로 되게 한다. 실제 작업은 NetworkManager(nmcli)가 한다.
//
// 보안
//   · SSID·비밀번호는 사용자 입력이므로 **execFile 인자 배열**로만 넘긴다 — 셸을 거치지 않아 주입이 불가능하다.
//   · 노출은 nginx 에서 127.0.0.1 로 제한한다(키오스크 브라우저는 http://localhost). LAN 의 다른 기기가
//     무선을 바꿔 제어기를 고립시키는 것을 막는다.
//   · 권한은 polkit 규칙(50-smartfarm-wifi.rules)이 netdev 그룹에 꼭 필요한 4개 동작만 준다.
const { execFile } = require('child_process');

function nmcli(args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile('nmcli', args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        out: String(stdout || '').trim(),
        err: String(stderr || (err && err.message) || '').trim(),
      });
    });
  });
}

// nmcli -t 는 ':' 로 필드를 나누고, 값 안의 ':' 는 역슬래시로 이스케이프한다.
// SSID 에 ':' 가 들어갈 수 있어 String.split(':') 으로는 SSID 가 잘린다 — 직접 훑는다.
function splitNmcli(line) {
  const ESC = String.fromCharCode(92);   // 역슬래시
  const out = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === ESC && i + 1 < line.length) { cur += line[++i]; continue; }
    if (c === ':') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

const NL = String.fromCharCode(10);
const rowsOf = (text) => text.split(NL).filter(Boolean).map(splitNmcli);

// WiFi 경로는 «패널 앞에 있는 사람»만 — 루프백에서 온 요청만 받는다.
// nginx 의 allow/deny 는 :80 경유만 막는다. 이 서비스는 0.0.0.0:3100 으로 열려 있어
// LAN 에서 포트를 직접 때리면 그 제한을 우회할 수 있다 → 서비스 자체에서 한 번 더 막는다.
// (키오스크 브라우저는 RPi 안에서 돌고, nginx 도 127.0.0.1 로 프록시하므로 둘 다 통과한다.)
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
app.use('/api/system/wifi', (req, res, next) => {
  const ip = (req.socket && req.socket.remoteAddress) || '';
  if (LOOPBACK.has(ip)) return next();
  return res.status(403).json({
    success: false,
    error: 'WiFi 설정은 제어기 패널에서만 가능합니다',
  });
});

/**
 * 저장된 WiFi 프로필을 SSID 기준으로 모은다.
 *
 * 프로필 이름과 SSID 는 대개 같지만 항상 같지는 않다. 이름으로만 비교하면
 * 이미 저장된 망을 못 알아보고 비밀번호를 다시 묻게 된다 (2026-09-14 현장 확인).
 * 그래서 프로필마다 실제 ssid 를 읽어 짝을 만든다.
 */
async function savedWifiProfiles() {
  const r = await nmcli(['-t', '-f', 'NAME,TYPE', 'con', 'show']);
  const names = rowsOf(r.out).filter((x) => x[1] === '802-11-wireless').map((x) => x[0]);
  const pairs = await Promise.all(
    names.map(async (name) => {
      const g = await nmcli(['-g', '802-11-wireless.ssid', 'con', 'show', name], 8000);
      return { name, ssid: (g.out || name).trim() || name };
    })
  );
  return pairs;
}

// GET /api/system/wifi — 현재 연결·저장된 프로필·IP
app.get('/api/system/wifi', async (req, res) => {
  const [active, profiles] = await Promise.all([
    nmcli(['-t', '-f', 'NAME,TYPE,DEVICE', 'con', 'show', '--active']),
    savedWifiProfiles(),
  ]);
  const cur = rowsOf(active.out).find((r) => r[1] === '802-11-wireless');
  res.json({
    success: true,
    connected: cur ? { ssid: cur[0], device: cur[2] } : null,
    // 화면은 이 목록으로 '저장됨' 을 판단하고, 저장된 망이면 비밀번호를 묻지 않는다.
    saved: profiles.map((x) => x.ssid),
    ip: primaryIPv4(),
    hostname: os.hostname(),
  });
});

// GET /api/system/wifi/scan — 주변 WiFi (신호 내림차순, 같은 SSID 는 가장 센 것만)
app.get('/api/system/wifi/scan', async (req, res) => {
  await nmcli(['dev', 'wifi', 'rescan'], 15000);   // 실패해도 아래 캐시 목록으로 진행
  const r = await nmcli(['-t', '-f', 'SSID,SIGNAL,SECURITY,IN-USE', 'dev', 'wifi', 'list']);
  if (!r.ok && !r.out) {
    return res.status(500).json({ success: false, error: r.err || 'nmcli 실행 실패' });
  }
  const best = new Map();
  for (const f of rowsOf(r.out)) {
    const ssid = f[0];
    if (!ssid) continue;                            // 숨김 SSID 는 목록에서 뺀다
    const item = {
      ssid,
      signal: Number(f[1]) || 0,
      secured: !!f[2] && f[2] !== '--',
      inUse: f[3] === '*',
    };
    const prev = best.get(ssid);
    if (!prev || item.signal > prev.signal) best.set(ssid, item);
  }
  res.json({
    success: true,
    networks: Array.from(best.values()).sort((a, b) => b.signal - a.signal),
  });
});

// POST /api/system/wifi/connect  { ssid, password? }
// 실패해도 기존 프로필은 지우지 않는다 → NetworkManager 가 원래 망으로 자동 복귀한다.
app.post('/api/system/wifi/connect', async (req, res) => {
  const ssid = String((req.body && req.body.ssid) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!ssid) return res.status(400).json({ success: false, error: 'ssid 가 필요합니다' });
  if (password && (password.length < 8 || password.length > 63)) {
    return res.status(400).json({ success: false, error: 'WPA 비밀번호는 8~63자입니다' });
  }

  // 한 번 붙었던 망이면 비밀번호를 다시 받지 않는다.
  // NetworkManager 가 이미 그 망의 비밀번호를 갖고 있으므로 저장된 프로필을 그대로 올린다.
  // 비밀번호를 같이 보내오면 (농장에서 공유기 비밀번호를 바꾼 경우) 새 값으로 다시 붙인다.
  const profiles = await savedWifiProfiles();
  const known = profiles.find((x) => x.ssid === ssid);
  const useSaved = !!known && !password;

  let r;
  if (useSaved) {
    r = await nmcli(['con', 'up', known.name], 45000);
  } else {
    const args = ['dev', 'wifi', 'connect', ssid];
    if (password) args.push('password', password);
    r = await nmcli(args, 45000);
  }
  const after = await nmcli(['-t', '-f', 'NAME,TYPE', 'con', 'show', '--active']);
  const connected = rowsOf(after.out).some((f) => f[0] === ssid && f[1] === '802-11-wireless');

  if (!connected) {
    // 200 으로 내려 화면이 사유를 그대로 보여주게 한다 (500 은 프록시 계층에서 뭉개진다)
    const why = (r.err || r.out || '연결하지 못했습니다').split(NL)[0];
    // 저장된 비밀번호로 붙다 실패했다면 공유기 비밀번호가 바뀐 경우가 흔하다.
    // 화면이 그때만 키보드를 열 수 있도록 알려준다.
    return res.json({ success: false, ssid, error: why, usedSaved: useSaved, needPassword: useSaved, ip: primaryIPv4() });
  }
  res.json({ success: true, ssid, usedSaved: useSaved, ip: primaryIPv4(), message: '연결되었습니다' });
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
