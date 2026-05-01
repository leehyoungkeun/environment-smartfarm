// /home/lhk/smartfarm/ecosystem.config.js
// PM2 자동 재시작 정책 강화 (Node-RED hang/메모리 누수 대응)
//
// 적용:
//   pm2 delete all && pm2 start /home/lhk/smartfarm/ecosystem.config.js && pm2 save

module.exports = {
    apps: [
        {
            name: "node-red",
            script: "/usr/bin/node-red",
            args: "-s /home/lhk/smartfarm/node-red/settings.js",
            cwd: "/home/lhk/smartfarm/node-red",
            interpreter: "none",
            autorestart: true,
            max_memory_restart: "500M",
            min_uptime: "30s",
            max_restarts: 20,
            exp_backoff_restart_delay: 1000,
            kill_timeout: 5000,
            env: {
                NODE_ENV: "production",
                FARM_ID: process.env.FARM_ID || 'UNSET',
            },
        },
        {
            name: "smartfarm-rpi",
            script: "/home/lhk/smartfarm/rpi-server/src/system-server.js",
            interpreter: "/usr/bin/node",
            cwd: "/home/lhk/smartfarm/rpi-server",
            autorestart: true,
            max_memory_restart: "300M",
            min_uptime: "30s",
            max_restarts: 20,
            exp_backoff_restart_delay: 1000,
            env: {
                NODE_ENV: "production",
            },
        },
        {
            name: "smartfarm-system",
            script: "/home/lhk/smartfarm/system-server/server.js",
            interpreter: "/usr/bin/node",
            cwd: "/home/lhk/smartfarm/system-server",
            autorestart: true,
            max_memory_restart: "200M",
            min_uptime: "30s",
            max_restarts: 20,
            exp_backoff_restart_delay: 1000,
            env: {
                NODE_ENV: "production",
            },
        },
    ],
};
