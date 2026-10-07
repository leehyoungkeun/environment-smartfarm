/**
 * 부가장치 로컬 설정 라우트
 * 클라우드 백엔드가 부가장치 설정을 제어기로 push 할 때 쓴다.
 * 파이썬 데몬은 여기서 쓴 config.json 을 매 주기 읽는다.
 *
 * ── 설정 한 칸이 OS 까지 내려가야 하는 이유 (2026-09-14) ──
 * 전광판은 농장마다 있기도 하고 없기도 하다. 그런데 예전엔 화면의 「사용」 체크가
 * config.json 까지만 닿았고, 전광판 전용 DHCP 서버(dnsmasq)와 이더넷 고정주소
 * 프로필(eth0-d16)은 설정과 무관하게 늘 켜져 있었다. 그 결과
 *   - 전광판 없는 농장: dnsmasq 가 매 부팅 "unknown interface eth0" 로 죽어
 *     실패 유닛이 쌓이고, 나중에 진짜 장애를 볼 때 눈을 흐렸다.
 *   - 그 랜포트를 농장 공유기에 꽂으면 제어기가 169.254 주소를 뿌려
 *     농장 네트워크의 DHCP 를 망가뜨릴 수 있었다.
 * 그래서 설정을 받을 때마다 네트워크 계층까지 같이 맞춘다.
 */
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const D16_CONFIG_PATH = '/home/lhk/smartfarm/d16-display/config.json';
const D16_NET_SCRIPT = '/usr/local/sbin/smartfarm-d16-net';

/**
 * 전광판 네트워크 계층을 설정에 맞춘다.
 * 여러 번 불러도 같은 결과가 되도록 스크립트 쪽을 멱등으로 만들었다.
 * 실패해도 예외를 던지지 않는다. 설정 저장 자체는 성공했는데 부수 작업 때문에
 * 500 이 나가면 화면이 "저장 실패" 로 보여 더 헷갈리기 때문이다. 대신 사유를 실어 보낸다.
 */
function applyDisplayNetwork(enabled) {
  return new Promise((resolve) => {
    const action = enabled ? 'on' : 'off';
    if (!fs.existsSync(D16_NET_SCRIPT)) {
      return resolve({ ok: false, action, error: `${D16_NET_SCRIPT} 없음 (이미지 갱신 필요)` });
    }
    execFile('sudo', ['-n', D16_NET_SCRIPT, action], { timeout: 30000 }, (err, stdout, stderr) => {
      const raw = String(stdout || '').trim();
      let state = null;
      try { state = JSON.parse(raw); } catch { /* 아래에서 원문을 그대로 싣는다 */ }
      if (err) {
        return resolve({
          ok: false,
          action,
          error: (String(stderr || '').trim() || err.message).slice(0, 300),
          state,
        });
      }
      resolve({ ok: true, action, state, raw: state ? undefined : raw.slice(0, 300) });
    });
  });
}

/** 현재 OS 상태만 읽는다. 아무것도 바꾸지 않는다. */
function readDisplayNetwork() {
  return new Promise((resolve) => {
    if (!fs.existsSync(D16_NET_SCRIPT)) return resolve(null);
    execFile('sudo', ['-n', D16_NET_SCRIPT, 'status'], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(String(stdout || '').trim())); } catch { resolve(null); }
    });
  });
}

function readConfig() {
  if (!fs.existsSync(D16_CONFIG_PATH)) return null;
  return JSON.parse(fs.readFileSync(D16_CONFIG_PATH, 'utf-8'));
}

/**
 * 부팅 때 한 번 불러 OS 상태를 config.json 에 맞춘다.
 * 클라우드 push 는 제어기가 꺼져 있으면 도달하지 못하고, 사람이 손으로
 * systemctl 을 만져 놓았을 수도 있다. 기기가 스스로 제자리를 찾게 한다.
 */
async function reconcileDisplayNetwork() {
  let cfg = null;
  try { cfg = readConfig(); } catch (e) {
    console.warn('[local-config] config.json 읽기 실패:', e.message);
  }
  // 설정 파일이 아직 없는 농장은 전광판을 안 쓰는 것으로 본다.
  // 대부분의 농장에 전광판이 없으므로 꺼진 쪽이 안전한 기본값이다.
  const enabled = !!(cfg && cfg.enabled);
  const r = await applyDisplayNetwork(enabled);
  console.log(`[local-config] 전광판 네트워크 정렬: ${enabled ? 'on' : 'off'} — ${r.ok ? 'OK' : r.error}`);
  return r;
}

router.get('/display', async (req, res) => {
  try {
    const data = readConfig();
    return res.json({ success: true, data, network: await readDisplayNetwork() });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

router.put('/display', async (req, res) => {
  try {
    const cfg = req.body || {};
    if (typeof cfg !== 'object' || Array.isArray(cfg)) {
      return res.status(400).json({ success: false, message: 'body must be object' });
    }
    fs.mkdirSync(path.dirname(D16_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(D16_CONFIG_PATH, JSON.stringify(cfg, null, 2));

    const applied = await applyDisplayNetwork(!!cfg.enabled);
    return res.json({ success: true, path: D16_CONFIG_PATH, network: applied });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ── 카메라 임시 사용 중단 (2026-09-14) ─────────────────────────────────
// 카메라를 사무실에 두고 제어기만 다른 농장으로 옮기자 매분 점검(smartfarm-camera-probe.sh)이 실패해
// CameraUnreachable·CameraIpDrift 경보가 계속 울렸다. 삭제하면 주소·계정을 다시 넣어야 한다.
// 사용 여부만 이 파일에 적고, 점검 스크립트가 꺼진 카메라를 건너뛴다(지표가 사라져 경보가 풀린다).
// 영상 서버(go2rtc)와 그 설정 파일은 건드리지 않는다 — 요청이 있을 때만 카메라에 붙으므로
// 꺼둔 동안 연결 시도가 없고, 주소·계정도 그대로 보존된다. 켜면 바로 다시 쓸 수 있다.
// 파일이 없거나 카메라 키가 없으면 "사용" 으로 본다(기본값).
const CAMERA_STATE_PATH = '/home/lhk/smartfarm/cameras-state.json';

function readCameraState() {
  try {
    const d = JSON.parse(fs.readFileSync(CAMERA_STATE_PATH, 'utf-8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

router.get('/camera', (req, res) => {
  res.json({ success: true, state: readCameraState() });
});

router.put('/camera', (req, res) => {
  const { camId, enabled } = req.body || {};
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(camId || ''))) {
    return res.status(400).json({ success: false, message: 'camId 형식 오류' });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, message: 'enabled 는 true/false' });
  }
  try {
    const state = readCameraState();
    state[camId] = enabled;
    fs.mkdirSync(path.dirname(CAMERA_STATE_PATH), { recursive: true });
    const tmp = CAMERA_STATE_PATH + '.tmp';          // 쓰는 도중 점검이 반쪽 파일을 읽지 않게
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, CAMERA_STATE_PATH);
    return res.json({ success: true, state });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ── 표준 노드 통신 설정·§5.4.1 연결 시험 (2026-09-15) ─────────────────────
// 표준노드 탭이 포트·속도를 바꾸고 연결 시험을 돌린다. 드라이버(ks3267d)는 127.0.0.1:3002 에만 떠 있어 여기서 넘긴다.
// Node-RED 의 KS 프록시는 읽기 전용이라 거치지 않는다.
// 읽기는 LAN·Tailscale 허용. 변경은 이 제어기 자신(패널, nginx 루프백)과 Tailscale(클라우드 백엔드가
// 관리자 역할을 확인한 뒤 부름)만 — 같은 농장 LAN 의 다른 기기가 표준 노드 버스를 바꾸지 못하게.
const http = require('http');

function ksDaemon(method, pathname, body, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1', port: 3002, method, path: pathname, timeout: timeoutMs,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
    }, (r) => {
      let raw = '';
      r.on('data', (c) => { raw += c; });
      r.on('end', () => {
        try { resolve(JSON.parse(raw || '{}')); } catch { resolve({ ok: false, error: '드라이버 응답을 읽지 못했습니다' }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('드라이버 응답 시간 초과')));
    req.on('error', (e) => resolve({ ok: false, error: '드라이버(ks3267d)에 연결하지 못했습니다: ' + e.message }));
    if (data) req.write(data);
    req.end();
  });
}

function isLoopbackOrTailscale(req) {
  const ip = String(req.ip || (req.connection && req.connection.remoteAddress) || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
}

router.get('/ks3267/comm', async (req, res) => {
  res.json(await ksDaemon('GET', '/comm'));
});

router.put('/ks3267/comm', async (req, res) => {
  if (!isLoopbackOrTailscale(req)) {
    return res.status(403).json({ ok: false, error: '통신 설정 변경은 제어기 패널 또는 관리자 원격 경로에서만 가능합니다' });
  }
  res.json(await ksDaemon('POST', '/comm', req.body || {}, 20000));
});

// 저장 주기 (2026-10-06) — 표준 노드 1분 스냅샷의 주기. 읽기는 누구나, 변경은 패널/관리자 경로만(통신 설정과 같은 규칙).
router.get('/ks3267/collect', async (req, res) => {
  res.json(await ksDaemon('GET', '/collect'));
});

router.put('/ks3267/collect', async (req, res) => {
  if (!isLoopbackOrTailscale(req)) {
    return res.status(403).json({ ok: false, error: '저장 주기 변경은 제어기 패널 또는 관리자 원격 경로에서만 가능합니다' });
  }
  res.json(await ksDaemon('POST', '/collect', req.body || {}));
});

router.get('/ks3267/conntest', async (req, res) => {
  const unit = parseInt(req.query.unit, 10);
  res.json(await ksDaemon('GET', '/conntest?unit=' + (Number.isFinite(unit) ? unit : ''), null, 20000));
});

// 드라이버 통계(예외·타임아웃·스캔 미응답) 0 으로 — 패널/관리자 경로만
router.post('/ks3267/stats-reset', async (req, res) => {
  if (!isLoopbackOrTailscale(req)) {
    return res.status(403).json({ ok: false, error: '통계 초기화는 제어기 패널 또는 관리자 원격 경로에서만 가능합니다' });
  }
  res.json(await ksDaemon('POST', '/stats/reset', {}));
});

// §5.4.4 제어기 로컬 1분 스냅샷(SQLite) — 인터넷 없이 저장을 보인다. 읽기 전용, 쿼리 그대로 전달 (unit, idx, start, end, limit, days).
// vendor-actuator-status: 비표준 구동기 1분 행 — 표준과 같은 로컬 저장 (2026-09-19 저장 정책 통일)
for (const kind of ['sensor-status', 'actuator-status', 'vendor-actuator-status', 'summary']) {
  router.get(`/ks3267/local-${kind}`, async (req, res) => {
    const qs = new URLSearchParams();
    for (const k of ['unit', 'idx', 'house', 'device', 'start', 'end', 'limit', 'days']) if (req.query[k] !== undefined) qs.set(k, String(req.query[k]));
    res.json(await ksDaemon('GET', `/local/${kind}${qs.toString() ? '?' + qs : ''}`, null, 20000));
  });
}

// §5.4.3 데이터 확인 — 센서 관측치·상태 변화 이력 (드라이버 폴링 해상도). 읽기 전용.
router.get('/ks3267/changes', async (req, res) => {
  const unit = parseInt(req.query.unit, 10);
  const n = Math.min(Math.max(parseInt(req.query.n, 10) || 60, 1), 300);
  res.json(await ksDaemon('GET', `/changes?n=${n}` + (Number.isFinite(unit) ? `&unit=${unit}` : '')));
});

// ── 실노드 증적 묶음 (2026-09-19) ──
// 입고 시험장(인터넷·SSH 없음)에서 버튼 하나로 드라이버가 지금 상태를 §5.4/5.5 순서로 판정해 report.md·results.json·frames.txt 로 남긴다.
// 목록·파일은 읽기(LAN·Tailscale), 생성·삭제는 패널/관리자 원격 경로만. 파일은 JSON {content} 로 넘기고 화면이 내려받기를 만든다.
const EVIDENCE_ID = /^realnode-\d{8}-\d{6}(-\d+)?$/;
const EVIDENCE_FILES = new Set(['report.md', 'results.json', 'frames.txt']);

router.get('/ks3267/evidence', async (req, res) => {
  res.json(await ksDaemon('GET', '/evidence'));
});

router.get('/ks3267/evidence/:id/:file', async (req, res) => {
  const { id, file } = req.params;
  if (!EVIDENCE_ID.test(id) || !EVIDENCE_FILES.has(file)) {
    return res.status(400).json({ ok: false, error: '잘못된 증적 id 또는 파일 이름' });
  }
  res.json(await ksDaemon('GET', `/evidence/${id}/${file}`, null, 20000));
});

router.post('/ks3267/evidence', async (req, res) => {
  if (!isLoopbackOrTailscale(req)) {
    return res.status(403).json({ ok: false, error: '증적 생성은 제어기 패널 또는 관리자 원격 경로에서만 가능합니다' });
  }
  const unit = parseInt(req.body && req.body.unit, 10);
  if (!Number.isFinite(unit) || unit < 1 || unit > 247) return res.status(400).json({ ok: false, error: 'unit 1~247' });
  res.json(await ksDaemon('POST', '/evidence', { unit }, 30000));   // 연결 시험(탐색)까지 하므로 넉넉히
});

router.post('/ks3267/evidence-delete', async (req, res) => {
  if (!isLoopbackOrTailscale(req)) {
    return res.status(403).json({ ok: false, error: '증적 삭제는 제어기 패널 또는 관리자 원격 경로에서만 가능합니다' });
  }
  const id = String((req.body && req.body.id) || '');
  if (!EVIDENCE_ID.test(id)) return res.status(400).json({ ok: false, error: '잘못된 증적 id' });
  res.json(await ksDaemon('POST', '/evidence/delete', { id }));
});

// ── 제어기 상태 (2026-10-07) ─────────────────────────────────────────────────
// 「서버」 화면이 제어기 안에서 도는 것들을 보여 준다: pm2 앱·systemd 유닛·자가점검(smartfarm-recovery-check.sh)·
// USB-485 포트·온도/메모리/디스크·최근 자가복구 활동. 읽기 전용, sudo 없음 (lhk 가 전부 읽을 수 있는 것만).
// 점검 스크립트는 0.5초(실측)라 매번 돌리되, 화면 여럿이 동시에 눌러도 제어기가 바쁘지 않게 10초 캐시.
const os = require('os');
const { exec } = require('child_process');

const RECOVERY_CHECK = '/usr/local/bin/smartfarm-recovery-check.sh';
const LOG_DIR = '/home/lhk/smartfarm/logs';
const STATUS_UNITS = [
  'pm2-lhk.service', 'smartfarm-pm2-guard.timer', 'smartfarm-nr-patches.service', 'smartfarm-pm2-start.service',
  'smartfarm-firewall.service', 'nginx.service', 'mosquitto.service', 'tailscaled.service', 'cloudflared.service',
  'promtail.service', 'NetworkManager.service', 'lightdm.service', 'ssh.service',
];

function sh(cmd, timeoutMs = 8000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function lastLogLine(file, dropPattern) {
  // 색 코드·pm2 저장 메시지 같은 잡음은 빼고 마지막 의미 있는 줄 하나
  const raw = readText(path.join(LOG_DIR, file));
  if (!raw) return null;
  const lines = raw.trim().split('\n').filter((l) => l.startsWith('[') && !(dropPattern && dropPattern.test(l)));
  return lines.length ? lines[lines.length - 1].slice(0, 200) : null;
}

function parsePm2(jlist) {
  try {
    return JSON.parse(jlist || '[]').map((p) => {
      const e = p.pm2_env || {};
      return {
        name: p.name, status: e.status, upSince: e.pm_uptime || null, restarts: e.restart_time || 0,
        cpu: p.monit ? p.monit.cpu : null, memory: p.monit ? p.monit.memory : null,
        script: String(e.pm_exec_path || '').replace('/home/lhk/', '~/'),
      };
    });
  } catch { return null; }
}

function parseUnits(show) {
  if (!show) return null;
  return show.trim().split(/\n\s*\n/).map((block) => {
    const o = {};
    for (const line of block.split('\n')) { const i = line.indexOf('='); if (i > 0) o[line.slice(0, i)] = line.slice(i + 1); }
    return {
      id: o.Id, active: o.ActiveState, sub: o.SubState, enabled: o.UnitFileState,
      since: o.ActiveEnterTimestamp || null, restarts: Number(o.NRestarts || 0),
    };
  }).filter((u) => u.id);
}

function parseCheck(out) {
  if (!out) return null;
  const items = []; let section = '';
  for (const line of out.split('\n')) {
    const sec = line.match(/^\[(\d)\]\s*(.+)$/); if (sec) { section = sec[2].trim(); continue; }
    const m = line.match(/^\s*(✅|❌)\s*(.+)$/); if (m) items.push({ ok: m[1] === '✅', label: m[2].trim(), section });
  }
  const sum = out.match(/통과\s*(\d+)\s*·\s*실패\s*(\d+)/);
  const age = out.match(/마지막 센서 값\s*(\d+)초 전/);
  return {
    pass: sum ? Number(sum[1]) : items.filter((i) => i.ok).length,
    fail: sum ? Number(sum[2]) : items.filter((i) => !i.ok).length,
    items, lastSensorAgeSec: age ? Number(age[1]) : null,
  };
}

function parseThrottled(out) {
  // vcgencmd get_throttled → throttled=0x50000 : 하위 4비트 = 지금, 16~19비트 = 부팅 뒤 한 번이라도
  const m = (out || '').match(/0x([0-9a-f]+)/i); if (!m) return null;
  const v = parseInt(m[1], 16);
  const names = ['저전압', 'ARM 주파수 제한', '과열 스로틀', '온도 상한(소프트)'];
  const pick = (shift) => names.filter((_, i) => v & (1 << (i + shift)));
  return { raw: '0x' + m[1], now: pick(0), past: pick(16) };
}

let controllerCache = { at: 0, data: null };
async function controllerStatus() {
  if (Date.now() - controllerCache.at < 10000 && controllerCache.data) return controllerCache.data;
  const [jlist, units, check, throttled, df, tsIp, crontab] = await Promise.all([
    sh('/usr/bin/pm2 jlist'),
    sh('systemctl show -p Id,ActiveState,SubState,UnitFileState,ActiveEnterTimestamp,NRestarts ' + STATUS_UNITS.join(' ')),
    sh('bash ' + RECOVERY_CHECK, 25000),
    sh('vcgencmd get_throttled'),
    sh('df -B1 --output=size,used,avail / | tail -1'),
    sh('tailscale ip -4'),
    sh('crontab -l'),
  ]);
  const up = parseFloat((readText('/proc/uptime') || '0').split(' ')[0]) || 0;
  const meminfo = readText('/proc/meminfo') || '';
  const kb = (k) => { const m = meminfo.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')); return m ? Number(m[1]) * 1024 : null; };
  const tempRaw = readText('/sys/class/thermal/thermal_zone0/temp');
  const dfv = (df || '').trim().split(/\s+/).map(Number);
  const link = (p) => { try { return fs.readlinkSync(p); } catch { return null; } };
  const data = {
    ok: true,
    at: new Date().toISOString(),
    controller: {
      hostname: os.hostname(),
      model: (readText('/proc/device-tree/model') || '').replace(/\0/g, '') || null,
      farmId: (readText('/home/lhk/smartfarm/.farm-id') || '').trim() || null,
      ipv4: (() => { for (const n of Object.values(os.networkInterfaces())) for (const a of n || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('100.')) return a.address; return null; })(),
      tailscaleIp: (tsIp || '').trim() || null,
      uptimeSec: Math.round(up),
      bootAt: new Date(Date.now() - up * 1000).toISOString(),
      load: os.loadavg().map((x) => Math.round(x * 100) / 100),
      cpus: os.cpus().length,
      mem: { total: kb('MemTotal'), available: kb('MemAvailable') },
      disk: dfv.length === 3 && dfv.every(Number.isFinite) ? { size: dfv[0], used: dfv[1], avail: dfv[2] } : null,
      tempC: tempRaw ? Math.round(Number(tempRaw) / 100) / 10 : null,
      throttled: parseThrottled(throttled),
    },
    pm2: parsePm2(jlist),
    units: parseUnits(units),
    check: parseCheck(check),
    ports: { vendor: link('/dev/smartfarm-485'), standard: link('/dev/smartfarm-485-std') },
    recent: {
      healthcheck: lastLogLine('modbus-healthcheck.log'),
      guard: lastLogLine('pm2-guard.log', /구성 변경 감지/),
      usb: lastLogLine('usb-events.log'),
    },
    cron: (crontab || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')),
  };
  controllerCache = { at: Date.now(), data };
  return data;
}

router.get('/controller/status', async (req, res) => {
  try { res.json(await controllerStatus()); }
  catch (e) { res.json({ ok: false, error: '제어기 상태를 읽지 못했습니다: ' + e.message }); }
});

module.exports = router;
module.exports.reconcileDisplayNetwork = reconcileDisplayNetwork;
