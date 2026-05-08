/**
 * RPi 초기 설정 라우트
 * GET /setup — 설정 웹 페이지
 * POST /setup/apply — 장비 코드로 설정 적용
 */
const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS_PATH = '/home/lhk/smartfarm/node-red/settings.js';
const FLOWS_PATH = '/home/lhk/.node-red/flows.json';
const ECOSYSTEM_PATHS = [
  '/home/lhk/smartfarm/ecosystem.config.js',
  '/home/lhk/smartfarm/scripts/ecosystem.config.js',
];
const FARM_ID_PATH = '/home/lhk/smartfarm/.farm-id';
const ENV_PATH = '/home/lhk/smartfarm/rpi-server/.env';
const SERVER_URL = 'https://api.smartgreen.kr';

function getSerial() {
  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const match = cpuinfo.match(/Serial\s*:\s*(\w+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

function getIP() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
  } catch {}
  return null;
}

// GET /setup — 설정 페이지 HTML
router.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SmartFarm 장비 설정</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: white; border-radius: 24px; padding: 40px; max-width: 420px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo span { font-size: 48px; }
    h1 { text-align: center; font-size: 22px; color: #1e293b; margin-bottom: 8px; }
    .sub { text-align: center; color: #64748b; font-size: 14px; margin-bottom: 32px; }
    label { display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 6px; }
    input { width: 100%; padding: 14px 16px; border: 2px solid #e2e8f0; border-radius: 12px; font-size: 24px; font-family: monospace; text-align: center; letter-spacing: 8px; text-transform: uppercase; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #667eea; }
    button { width: 100%; padding: 14px; border: none; border-radius: 12px; font-size: 16px; font-weight: 700; color: white; background: linear-gradient(135deg, #667eea, #764ba2); cursor: pointer; margin-top: 16px; transition: transform 0.1s; }
    button:hover { transform: scale(1.02); }
    button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .status { margin-top: 24px; }
    .step { padding: 8px 12px; margin: 4px 0; border-radius: 8px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
    .step.ok { background: #f0fdf4; color: #166534; }
    .step.error { background: #fef2f2; color: #991b1b; }
    .result { margin-top: 24px; padding: 16px; border-radius: 12px; text-align: center; }
    .result.success { background: #f0fdf4; border: 2px solid #86efac; }
    .result h3 { font-size: 18px; margin-bottom: 4px; }
    .result p { font-size: 13px; color: #64748b; }
    .info { margin-top: 16px; padding: 12px; background: #f8fafc; border-radius: 8px; font-size: 12px; color: #64748b; }
    .scan-btn { background: linear-gradient(135deg, #f59e0b, #d97706); margin-top: 8px; }
    #qr-reader { margin-top: 12px; border-radius: 12px; overflow: hidden; display: none; }
    #qr-reader video { border-radius: 12px; }
  </style>
  <script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>
</head>
<body>
  <div class="card">
    <div class="logo"><span>🌱</span></div>
    <h1>SmartFarm 장비 설정</h1>
    <p class="sub">QR 스캔 또는 장비 코드를 직접 입력하세요</p>
    <label>장비 코드</label>
    <input type="text" id="code" maxlength="6" placeholder="AF7K2M" autofocus>
    <button class="scan-btn" id="scanBtn" onclick="toggleScan()">📷 QR 코드 스캔</button>
    <div id="qr-reader"></div>
    <button id="btn" onclick="startSetup()">설정 시작</button>
    <div class="status" id="status"></div>
    <div class="info">IP: ${getIP() || '확인중'} | Serial: ${getSerial()?.slice(-8) || '-'}</div>
  </div>
  <script>
    async function startSetup() {
      const code = document.getElementById('code').value.trim().toUpperCase();
      if (code.length !== 6) return alert('6자리 코드를 입력하세요');
      const btn = document.getElementById('btn');
      const status = document.getElementById('status');
      btn.disabled = true;
      btn.textContent = '설정 중...';
      status.innerHTML = '<div class="step" style="background:#eff6ff;color:#1e40af">⏳ 서버 연결 및 설정 중...</div>';
      try {
        const res = await fetch('/setup/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceCode: code })
        });
        const data = await res.json();
        if (data.success) {
          let html = data.steps.map(s =>
            '<div class="step ' + (s.ok ? 'ok' : 'error') + '">' + (s.ok ? '✅' : '❌') + ' ' + s.text + '</div>'
          ).join('');
          html += '<div class="result success"><h3>🎉 설치 완료!</h3><p>농장: ' + (data.farmName || '-') + '</p><p>코드: ' + code + '</p></div>';
          status.innerHTML = html;
        } else {
          let html = (data.steps || []).map(s =>
            '<div class="step ' + (s.ok ? 'ok' : 'error') + '">' + (s.ok ? '✅' : '❌') + ' ' + s.text + '</div>'
          ).join('');
          html += '<div class="step error">❌ ' + (data.error || '설정 실패') + '</div>';
          status.innerHTML = html;
        }
      } catch (e) {
        status.innerHTML = '<div class="step error">❌ 연결 실패: ' + e.message + '</div>';
      }
      btn.disabled = false;
      btn.textContent = '다시 설정';
    }
    document.getElementById('code').addEventListener('keypress', e => { if (e.key === 'Enter') startSetup(); });

    let scanner = null;
    let scanning = false;

    function toggleScan() {
      if (scanning) {
        stopScan();
      } else {
        startScan();
      }
    }

    function startScan() {
      const readerDiv = document.getElementById('qr-reader');
      const scanBtn = document.getElementById('scanBtn');
      readerDiv.style.display = 'block';
      scanBtn.textContent = '⏹️ 스캔 중지';
      scanning = true;

      scanner = new Html5Qrcode('qr-reader');
      scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          // QR 내용에서 장비 코드 추출
          // URL 형식: https://smartgreen.kr/device/AF7K2M
          let code = decodedText;
          const match = decodedText.match(new RegExp('device/([A-Z0-9]{6})','i'));
          if (match) code = match[1];
          // 6자리 코드만 추출
          code = code.replace(/[^A-Z0-9]/gi, '').slice(0, 6).toUpperCase();

          if (code.length === 6) {
            document.getElementById('code').value = code;
            stopScan();
            document.getElementById('status').innerHTML =
              '<div class="step ok">✅ QR 스캔 완료: ' + code + '</div>';
          }
        },
        () => {} // 스캔 실패 (무시)
      ).catch(err => {
        readerDiv.style.display = 'none';
        scanBtn.textContent = '📷 QR 코드 스캔';
        scanning = false;
        alert('카메라 접근 실패: ' + err);
      });
    }

    function stopScan() {
      const readerDiv = document.getElementById('qr-reader');
      const scanBtn = document.getElementById('scanBtn');
      if (scanner) {
        scanner.stop().then(() => {
          scanner.clear();
          readerDiv.style.display = 'none';
        }).catch(() => {
          readerDiv.style.display = 'none';
        });
      }
      scanBtn.textContent = '📷 QR 코드 스캔';
      scanning = false;
    }
  </script>
</body>
</html>`);
});

// POST /setup/apply — 설정 적용
router.post('/apply', async (req, res) => {
  const { deviceCode } = req.body;
  if (!deviceCode || deviceCode.length !== 6) {
    return res.json({ success: false, error: '유효하지 않은 장비 코드입니다' });
  }

  const steps = [];
  let farmName = '';

  try {
    // 1. 서버에서 장비 정보 조회
    const nodeFetch = require('node-fetch');
    const setupRes = await nodeFetch(SERVER_URL + '/api/devices/' + deviceCode + '/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rpiSerial: getSerial(), ipAddress: getIP() }),
    });
    const setupData = await setupRes.json();

    if (!setupData.success || !setupData.data) {
      steps.push({ ok: false, text: '서버 응답: ' + (setupData.error || '알 수 없는 오류') });
      return res.json({ success: false, steps, error: setupData.error });
    }

    const { farmId, farm, mqttClientId, serverUrl, certificates } = setupData.data;
    farmName = farm?.farmName || farmId || '';
    steps.push({ ok: true, text: '서버 연결 확인' });
    steps.push({ ok: true, text: '농장 정보: ' + farmName + ' (' + farmId + ')' });

    if (!farmId) {
      steps.push({ ok: false, text: '이 장비에 배정된 농장이 없습니다' });
      return res.json({ success: false, steps, error: '농장 미배정' });
    }

    // 2. AWS IoT 인증서 저장
    const CERT_DIR = '/home/lhk/certs';
    if (certificates) {
      try {
        if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
        fs.writeFileSync(
          path.join(CERT_DIR, 'certificate.pem.crt'),
          Buffer.from(certificates.certPem, 'base64').toString('utf8'),
          { mode: 0o600 }
        );
        fs.writeFileSync(
          path.join(CERT_DIR, 'private.pem.key'),
          Buffer.from(certificates.privateKey, 'base64').toString('utf8'),
          { mode: 0o600 }
        );
        steps.push({ ok: true, text: 'AWS IoT 인증서 저장 완료' });
      } catch (e) {
        steps.push({ ok: false, text: '인증서 저장 실패: ' + e.message });
      }
    } else {
      steps.push({ ok: false, text: 'AWS IoT 인증서 미등록 (관리자에게 문의)' });
    }

    // 2.5 .farm-id 파일 갱신 (system-api.js GET /api/system/info 가 동적 반환)
    try {
      fs.writeFileSync(FARM_ID_PATH, farmId);
      steps.push({ ok: true, text: '.farm-id = ' + farmId });
    } catch (e) {
      steps.push({ ok: false, text: '.farm-id 수정 실패: ' + e.message });
    }

    // 3. settings.js FARM_ID 변경
    try {
      let settings = fs.readFileSync(SETTINGS_PATH, 'utf8');
      settings = settings.replace(
        /FARM_ID:\s*process\.env\.FARM_ID\s*\|\|\s*'[^']*'/,
        "FARM_ID: process.env.FARM_ID || '" + farmId + "'"
      );
      fs.writeFileSync(SETTINGS_PATH, settings);
      steps.push({ ok: true, text: 'settings.js FARM_ID = ' + farmId });
    } catch (e) {
      steps.push({ ok: false, text: 'settings.js 수정 실패: ' + e.message });
    }

    // 3.2 rpi-server/.env AWS_IOT_CLIENT_ID·MQTT_TOPIC_PREFIX 치환
    // server.js 가 dotenv 로 로드 — placeholder 'MyFarmPi_UNSET' 을 농장별로 치환
    const clientId = mqttClientId || ('MyFarmPi_' + deviceCode);
    try {
      if (fs.existsSync(ENV_PATH)) {
        let env = fs.readFileSync(ENV_PATH, 'utf8');
        env = env.replace(/^AWS_IOT_CLIENT_ID=.*/m, 'AWS_IOT_CLIENT_ID=' + clientId);
        env = env.replace(/^MQTT_TOPIC_PREFIX=.*/m, 'MQTT_TOPIC_PREFIX=farm/' + clientId);
        fs.writeFileSync(ENV_PATH, env);
        steps.push({ ok: true, text: '.env AWS_IOT_CLIENT_ID = ' + clientId });
      } else {
        steps.push({ ok: false, text: '.env 없음 (provision 미완)' });
      }
    } catch (e) {
      steps.push({ ok: false, text: '.env 수정 실패: ' + e.message });
    }

    // 3.5 PM2 ecosystem.config.js FARM_ID 변경
    // PM2 env 는 settings.js fallback 보다 우선이므로 ecosystem 도 반드시 갱신
    let ecosystemUpdated = 0;
    for (const ecoPath of ECOSYSTEM_PATHS) {
      if (!fs.existsSync(ecoPath)) continue;
      try {
        let eco = fs.readFileSync(ecoPath, 'utf8');
        eco = eco.replace(/FARM_ID:\s*'[^']*'/g, "FARM_ID: '" + farmId + "'");
        eco = eco.replace(
          /FARM_ID:\s*process\.env\.FARM_ID\s*\|\|\s*'[^']*'/g,
          "FARM_ID: process.env.FARM_ID || '" + farmId + "'"
        );
        fs.writeFileSync(ecoPath, eco);
        ecosystemUpdated++;
      } catch (e) {
        steps.push({ ok: false, text: 'ecosystem 수정 실패 (' + ecoPath + '): ' + e.message });
      }
    }
    if (ecosystemUpdated > 0) {
      steps.push({ ok: true, text: 'ecosystem.config.js FARM_ID = ' + farmId + ' (' + ecosystemUpdated + '개)' });
    }

    // 4. Node-RED flows.json 탭 환경변수 + MQTT clientid 변경
    try {
      const flows = JSON.parse(fs.readFileSync(FLOWS_PATH, 'utf8'));
      let tabCount = 0;
      flows.forEach(n => {
        if (n.type === 'tab' && n.env && Array.isArray(n.env)) {
          n.env.forEach(e => {
            if (e.name === 'FARM_ID') { e.value = farmId; tabCount++; }
            if (e.name === 'SERVER_URL') e.value = serverUrl || SERVER_URL;
          });
        }
        // MQTT 브로커 clientid 업데이트
        if (n.type === 'mqtt-broker' && n.id === 'mqtt_broker_aws') {
          n.clientid = mqttClientId || ('MyFarmPi_' + deviceCode);
        }
      });
      fs.writeFileSync(FLOWS_PATH, JSON.stringify(flows));
      steps.push({ ok: true, text: 'Node-RED 탭 환경변수 ' + tabCount + '개 업데이트' });
      steps.push({ ok: true, text: 'MQTT ClientID = ' + (mqttClientId || 'MyFarmPi_' + deviceCode) });
    } catch (e) {
      steps.push({ ok: false, text: 'flows.json 수정 실패: ' + e.message });
    }

    // 5. Node-RED context 초기화 + 재시작
    // 이전 농장의 빈 houseConfig 캐시가 남아있으면 서버에 재요청하지 않으므로 삭제
    try {
      const contextDir = '/home/lhk/.node-red/context';
      if (fs.existsSync(contextDir)) {
        fs.rmSync(contextDir, { recursive: true, force: true });
        fs.mkdirSync(contextDir, { recursive: true });
      }
    } catch (e) {}

    // 7. Tailscale 자동 등록 (setupData.tailscaleAuthKey 가 있을 때)
    // 서버 측 /api/devices/:code/setup 이 authKey 발급해야 자동 — 미발급 시 수동 안내
    if (setupData.data.tailscaleAuthKey) {
      const tailscaleHostname = 'farm-' + (farmId.replace(/^farm_/, '') || deviceCode);
      try {
        await new Promise((resolve, reject) => {
          exec(
            `tailscale up --authkey=${setupData.data.tailscaleAuthKey} --hostname=${tailscaleHostname} --ssh --reset`,
            { timeout: 60000 },
            (err) => err ? reject(err) : resolve()
          );
        });
        steps.push({ ok: true, text: 'Tailscale 등록 (' + tailscaleHostname + ')' });
      } catch (e) {
        steps.push({ ok: false, text: 'Tailscale 등록 실패: ' + e.message });
      }
    } else {
      steps.push({ ok: true, text: 'Tailscale: 서버에서 authKey 미발급 (수동 sudo tailscale up 필요)' });
    }

    // 6+8. PM2 3개 전체 재시작 — 트랩 15 fix (2026-05-09)
    // 응답을 먼저 보내고 비동기로 재시작 — pm2 delete all 이 system-api.js 자기 자신 죽이면
    // 클라이언트가 nginx 502 (HTML) 받아서 JSON.parse 실패 ("Unexpected token '<'")
    const ecoPathForRestart = ECOSYSTEM_PATHS.find(p => fs.existsSync(p));
    steps.push({ ok: true, text: 'PM2 전체 재시작 예약 (3초 후, ecosystem 단일 소스)' });
    steps.push({ ok: true, text: '센서 수집 시작 (60초 주기)' });

    // 응답 먼저 — 클라이언트가 success 받고 나서 자살
    res.json({ success: true, steps, farmName });

    // 비동기 PM2 재시작 (응답 후 3초)
    setTimeout(() => {
      const restartCmd = ecoPathForRestart
        ? `pm2 delete all 2>/dev/null; pm2 start ${ecoPathForRestart} && pm2 save --force`
        : 'pm2 restart all --update-env';
      exec(restartCmd, { timeout: 60000, shell: '/bin/bash' }, () => {});
    }, 3000);
    return;
  } catch (e) {
    steps.push({ ok: false, text: '오류: ' + e.message });
    res.json({ success: false, steps, error: e.message });
  }
});

module.exports = router;
