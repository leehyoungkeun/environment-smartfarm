// /home/lhk/smartfarm/ecosystem.config.js
// PM2 자동 재시작 정책 + 농장 ID 환경변수 주입 (100농장 표준 이미지 대응)
//
// FARM_ID 는 /home/lhk/smartfarm/.farm-id 파일에서 읽어 모든 앱에 주입
// NR_MQTT_CLIENT_ID 는 완성형 clientId (NR mqtt-broker config 에서 env-var type 으로 참조)
// 표준 이미지 배포 시 .farm-id 파일만 농장별로 다르게 두면 자동 적용
//
// 적용:
//   pm2 delete all && pm2 start /home/lhk/smartfarm/ecosystem.config.js && pm2 save

const fs = require('fs');

function readFarmId() {
    try {
        const v = fs.readFileSync('/home/lhk/smartfarm/.farm-id', 'utf8').trim();
        return v || 'farm_unknown';
    } catch (e) {
        return 'farm_unknown';
    }
}
const FARM_ID = readFarmId();
// 농장별 API 키 (2026-08-29, B2). setup.js 가 장비코드 적용 때 쓴다. 없으면 빈 값 — 서버가
// 이행 기간엔 공통 키를 경고와 함께 받지만, NR 함수의 공통 키 폴백은 제거해 간다.
function readSensorApiKey() {
    try { return require('fs').readFileSync('/home/lhk/smartfarm/.sensor-api-key', 'utf8').trim(); } catch (e) { return ''; }
}
const SENSOR_API_KEY = readSensorApiKey();

// 시뮬레이션 모드 — /home/lhk/smartfarm/.sim-mode 파일이 있을 때만 1 (2026-08-29, B4).
// USB-485 없는 개발용 기기에서만 손으로 만든다. 없으면 NR 은 실측 없는 센서를 생략한다(값을 지어내지 않음).
const SIM_MODE = require('fs').existsSync('/home/lhk/smartfarm/.sim-mode') ? '1' : '0';

// Node-RED credentialSecret — 농장마다 다른 값 (2026-08-29, B5).
// 없으면 여기서 생성해 파일로 둔다(600). 이미지 복제 시 clone-image.sh 가 지우므로 새 농장은 새 값을 갖는다.
function readOrCreateCredSecret() {
    const fs = require('fs'); const p = '/home/lhk/smartfarm/.nr-credential-secret';
    try { const v = fs.readFileSync(p, 'utf8').trim(); if (v.length >= 32) return v; } catch (e) { /* 없음 */ }
    const v = require('crypto').randomBytes(32).toString('hex');
    try { fs.writeFileSync(p, v, { mode: 0o600 }); } catch (e) { /* 읽기 전용이면 이번 부팅만 메모리 값 */ }
    return v;
}
const NR_CREDENTIAL_SECRET = readOrCreateCredSecret();
// clientId 는 NR 시작 시 ecosystem.config.js 가 evaluate 되는 시점의 timestamp 사용
// (NR 재시작마다 변경되어 AWS IoT 의 stale connection 충돌 회피)
const NR_MQTT_CLIENT_ID = 'MyFarmPi_' + FARM_ID + '_pi_nodered_pri_' + Date.now();

const commonEnv = {
    NODE_ENV: 'production',
    FARM_ID,
    NR_MQTT_CLIENT_ID,
    SENSOR_API_KEY,
    SIM_MODE,
    NR_CREDENTIAL_SECRET,
};

module.exports = {
    apps: [
        {
            name: 'node-red',
            script: '/usr/local/bin/smartfarm-nodered-wrapper.sh',
            args: '-u /home/lhk/.node-red -s /home/lhk/smartfarm/node-red/settings.js',
            cwd: '/home/lhk/smartfarm/node-red',
            interpreter: 'none',
            autorestart: true,
            max_memory_restart: '500M',
            min_uptime: '30s',
            max_restarts: 20,
            exp_backoff_restart_delay: 1000,
            kill_timeout: 5000,
            env: commonEnv,
        },
        {
            name: 'smartfarm-rpi',
            script: '/home/lhk/smartfarm/rpi-server/src/server.js',
            interpreter: '/usr/bin/node',
            cwd: '/home/lhk/smartfarm/rpi-server',
            autorestart: true,
            max_memory_restart: '300M',
            min_uptime: '30s',
            max_restarts: 20,
            exp_backoff_restart_delay: 1000,
            env: commonEnv,
        },
        {
            name: 'smartfarm-system',
            // 2026-08-26 정정 — 설정이 없는 파일(system-server/server.js)을 가리키고 있었다.
            // 실행 중인 프로세스는 rpi-server/src/system-api.js 였고 그것이 옳다.
            // 이 상태로 재부팅하거나 pm2 delete 후 재시작하면 기동에 실패한다.
            // cwd 도 rpi-server 로 맞춘다 — dotenv 가 cwd 기준으로 .env 를 찾으므로
            // 그래야 GLITCHTIP_DSN 이 로드되어 오류 보고가 동작한다.
            script: '/home/lhk/smartfarm/rpi-server/src/system-api.js',
            interpreter: '/usr/bin/node',
            cwd: '/home/lhk/smartfarm/rpi-server',
            autorestart: true,
            max_memory_restart: '200M',
            min_uptime: '30s',
            max_restarts: 20,
            exp_backoff_restart_delay: 1000,
            env: commonEnv,
        },
        {
            // CCTV 중계 (2026-08-29 ecosystem 에 편입 — 그전엔 pm2 에만 있어 clone-image 의 delete all 후 사라졌다)
            name: 'go2rtc',
            script: '/usr/local/bin/go2rtc',
            args: '-c /home/lhk/smartfarm/go2rtc.yaml',
            cwd: '/home/lhk',
            interpreter: 'none',
            autorestart: true,
            env: commonEnv,
        },
        {
            // Huidu D16 전광판 daemon (python). 전광판 없는 농장은 config.json enabled:false
            name: 'd16-display',
            script: '/home/lhk/smartfarm/d16-display/d16_daemon.py',
            interpreter: 'python3',
            cwd: '/home/lhk',
            autorestart: true,
            env: commonEnv,
        },
    ],
};
