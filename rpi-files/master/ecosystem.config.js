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
// clientId 는 NR 시작 시 ecosystem.config.js 가 evaluate 되는 시점의 timestamp 사용
// (NR 재시작마다 변경되어 AWS IoT 의 stale connection 충돌 회피)
const NR_MQTT_CLIENT_ID = 'MyFarmPi_' + FARM_ID + '_pi_nodered_pri_' + Date.now();

const commonEnv = {
    NODE_ENV: 'production',
    FARM_ID,
    NR_MQTT_CLIENT_ID,
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
    ],
};
