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
const wifiPlan = require('./wifiPlan');

async function savedWifiProfiles() {
  const r = await nmcli(['-t', '-f', 'NAME,TYPE', 'con', 'show']);
  const names = rowsOf(r.out).filter((x) => x[1] === '802-11-wireless').map((x) => x[0]);
  const pairs = await Promise.all(
    names.map(async (name) => {
      const [g, t] = await Promise.all([
        nmcli(['-g', '802-11-wireless.ssid', 'con', 'show', name], 8000),
        nmcli(['-g', 'connection.timestamp', 'con', 'show', name], 8000),
      ]);
      // everConnected: 한 번이라도 연결에 성공했는가 (2026-09-15).
      // 틀린 비밀번호로 저장만 된 프로필을 '저장됨' 으로 착각해 비밀번호를 다시 묻지 않던 사고를 막는다.
      return { name, ssid: (g.out || name).trim() || name, everConnected: wifiPlan.isEverConnected(t.out) };
    })
  );
  return pairs;
}

async function activeWifiName() {
  const a = await nmcli(['-t', '-f', 'NAME,TYPE', 'con', 'show', '--active']);
  const row = rowsOf(a.out).find((r) => r[1] === '802-11-wireless');
  return row ? row[0] : null;
}

// 연결 결과를 장치 상태로 판정한다. 비밀번호가 틀리면 몇 초 만에 need-auth 가 이어진다.
// 예전엔 이걸 모르고 NetworkManager 가 2분 뒤 스스로 포기할 때까지 무선이 붙잡혀 있었다.
async function waitActivation(target, limitMs) {
  const start = Date.now();
  let streak = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const d = await nmcli(['-g', 'GENERAL.STATE,GENERAL.CONNECTION', 'dev', 'show', 'wlan0'], 5000);
    const lines = (d.out || '').split(NL);
    const code = wifiPlan.stateCode(lines[0] || '');
    streak = code === 60 ? streak + 1 : 0;
    const outcome = wifiPlan.classifyState({
      code, connection: (lines[1] || '').trim(), target,
      elapsedMs: Date.now() - start, needAuthStreak: streak, limitMs,
    });
    if (outcome !== 'waiting') return outcome;
  }
}

// GET /api/system/wifi — 현재 연결·저장된 프로필·IP
//
// 2026-09-15: '현재 연결' 을 장치 상태로 판정한다. 예전엔 활성 연결 목록(con show --active)의 첫 무선을 썼는데,
// 그 목록에는 연결 중·끊기는 중인 연결도 들어 있어 실패한 703HO 가 끊기는 순간 '현재 연결' 로 찍혔다.
// 화면이 한눈에 확인하도록 신호·대역·채널·보안·주소·공유기·인터넷 상태를 함께 준다 (판정은 wifiPlan.describeLink).
app.get('/api/system/wifi', async (req, res) => {
  const [devs, aps, ipinfo, conn, profiles] = await Promise.all([
    nmcli(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'dev']),
    nmcli(['-t', '-f', 'IN-USE,SSID,SIGNAL,FREQ,CHAN,RATE,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'no']),
    nmcli(['-g', 'IP4.ADDRESS,IP4.GATEWAY', 'dev', 'show', 'wlan0']),
    nmcli(['networking', 'connectivity']),
    savedWifiProfiles(),
  ]);
  const link = wifiPlan.describeLink({
    device: rowsOf(devs.out).find((r) => r[0] === 'wlan0'),
    apRows: rowsOf(aps.out),
    ipText: ipinfo.out,
    connectivity: conn.out,
  });
  res.json({
    success: true,
    connected: link.state === 'connected' ? { ssid: link.ssid, device: 'wlan0' } : null,
    link,
    // 화면은 이 목록으로 '저장됨' 을 판단하고, 저장된 망이면 비밀번호를 묻지 않는다.
    // 실제로 연결에 성공한 적 있는 망만 넣는다 — 틀린 비밀번호로 저장만 된 망은 빠진다.
    saved: profiles.filter((x) => x.everConnected).map((x) => x.ssid),
    ip: link.ip || primaryIPv4(),
    hostname: os.hostname(),
    checkedAt: Date.now(),
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
//
// 2026-09-15 재작성. 판단은 wifiPlan.js(순수·시험), 여기서는 실행과 정리만 한다.
//   - 저장만 되고 성공한 적 없는 프로필은 쓰지 않고 지운 뒤 비밀번호를 받는다.
//   - 새 비밀번호는 저장된 프로필에 명시적으로 넣고 올린다.
//   - 결과는 장치 상태로 몇 초 안에 판정하고, 실패하면 붙잡힌 활성화를 내린다.
//   - 실패한 새 프로필은 지우고, 잘 되던 프로필은 원래 비밀번호로 되돌린 뒤 원래 망으로 복귀시킨다.
// 응답은 늘 200 — 500 은 프록시 계층에서 뭉개져 화면이 사유를 못 보여준다.
app.post('/api/system/wifi/connect', async (req, res) => {
  const ssid = String((req.body && req.body.ssid) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!ssid) return res.status(400).json({ success: false, error: 'ssid 가 필요합니다' });
  if (password && (password.length < 8 || password.length > 63)) {
    return res.status(400).json({ success: false, error: 'WPA 비밀번호는 8~63자입니다' });
  }

  const LIMIT_MS = 30000;
  const prevActive = await activeWifiName();
  const profiles = await savedWifiProfiles();
  const profile = profiles.find((x) => x.ssid === ssid) || null;
  const plan = wifiPlan.planConnect({ password, profile });

  if (plan.action === 'need-password') {
    if (plan.deleteStale) await nmcli(['con', 'delete', profile.name]);
    return res.json({
      success: false, ssid, needPassword: true, reason: 'need_password',
      error: '이 WiFi 는 아직 연결에 성공한 적이 없어 비밀번호가 필요합니다. 비밀번호를 입력하세요.',
      ip: primaryIPv4(),
    });
  }

  let started;
  let oldPsk = null;
  let targetName = profile ? profile.name : ssid;
  if (plan.action === 'up-saved') {
    started = await nmcli(['-w', '0', 'con', 'up', profile.name], 10000);
  } else if (plan.action === 'modify-then-up') {
    if (plan.restorePskOnFail) {
      const g = await nmcli(['-s', '-g', '802-11-wireless-security.psk', 'con', 'show', profile.name], 8000);
      oldPsk = g.ok ? g.out : null;
    }
    const m = await nmcli(['con', 'modify', profile.name, 'wifi-sec.psk', password], 10000);
    started = m.ok ? await nmcli(['-w', '0', 'con', 'up', profile.name], 10000) : m;
  } else {
    const args = ['-w', '0', 'dev', 'wifi', 'connect', ssid];
    if (password) args.push('password', password);
    started = await nmcli(args, 15000);
  }

  let outcome = 'failed';
  if (started.ok) {
    if (plan.action === 'add-connect') {
      const created = (await savedWifiProfiles()).find((x) => x.ssid === ssid);
      if (created) targetName = created.name;
    }
    outcome = await waitActivation(targetName, LIMIT_MS);
  }

  if (outcome === 'connected') {
    return res.json({ success: true, ssid, usedSaved: plan.action === 'up-saved', ip: primaryIPv4(), message: '연결되었습니다' });
  }

  // 실패 정리: 무선을 붙잡은 활성화를 내리고, 틀린 흔적을 남기지 않는다
  const cur = (await savedWifiProfiles()).find((x) => x.ssid === ssid);
  if (cur) {
    if (plan.deleteOnFail && !cur.everConnected) {
      await nmcli(['con', 'delete', cur.name]);
    } else {
      await nmcli(['con', 'down', cur.name]);
      if (plan.restorePskOnFail && oldPsk) await nmcli(['con', 'modify', cur.name, 'wifi-sec.psk', oldPsk]);
    }
  }
  const returnedTo = prevActive && prevActive !== (cur && cur.name) ? prevActive : null;
  if (returnedTo) nmcli(['con', 'up', returnedTo], 45000);   // 원래 쓰던 망으로 복귀 — 기다리지 않는다

  const why = wifiPlan.failureMessage(outcome, started.err || started.out);
  return res.json({
    success: false, ssid, reason: why.reason, error: why.message,
    needPassword: why.reason === 'wrong_password' || plan.action === 'up-saved',
    usedSaved: plan.action === 'up-saved',
    returnedTo, ip: primaryIPv4(),
  });
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
