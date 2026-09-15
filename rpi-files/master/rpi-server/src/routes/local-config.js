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

router.get('/ks3267/conntest', async (req, res) => {
  const unit = parseInt(req.query.unit, 10);
  res.json(await ksDaemon('GET', '/conntest?unit=' + (Number.isFinite(unit) ? unit : ''), null, 20000));
});

// §5.4.4 제어기 로컬 1분 스냅샷(SQLite) — 인터넷 없이 저장을 보인다. 읽기 전용, 쿼리 그대로 전달 (unit, idx, start, end, limit, days).
for (const kind of ['sensor-status', 'actuator-status', 'summary']) {
  router.get(`/ks3267/local-${kind}`, async (req, res) => {
    const qs = new URLSearchParams();
    for (const k of ['unit', 'idx', 'start', 'end', 'limit', 'days']) if (req.query[k] !== undefined) qs.set(k, String(req.query[k]));
    res.json(await ksDaemon('GET', `/local/${kind}${qs.toString() ? '?' + qs : ''}`, null, 20000));
  });
}

// §5.4.3 데이터 확인 — 센서 관측치·상태 변화 이력 (드라이버 폴링 해상도). 읽기 전용.
router.get('/ks3267/changes', async (req, res) => {
  const unit = parseInt(req.query.unit, 10);
  const n = Math.min(Math.max(parseInt(req.query.n, 10) || 60, 1), 300);
  res.json(await ksDaemon('GET', `/changes?n=${n}` + (Number.isFinite(unit) ? `&unit=${unit}` : '')));
});

module.exports = router;
module.exports.reconcileDisplayNetwork = reconcileDisplayNetwork;
