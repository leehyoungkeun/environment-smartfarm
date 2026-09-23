module.exports = {
  apps: [
    {
      name: 'smartfarm-backend',
      cwd: __dirname,
      script: 'backend/src/app.js',
      interpreter: 'node',
      // --import: Sentry 는 express 가 로드되기 **전에** 초기화돼야 자동 계측이 붙는다.
      // app.js 안에서 import 하면 이미 늦다 ([Sentry] express is not instrumented 경고).
      // 경로는 cwd(=__dirname, 리포 루트) 기준. 2026-09-23 참고: backend/src/env.js
      interpreter_args: '--experimental-specifier-resolution=node --import ./backend/src/instrument.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        TZ: 'Asia/Seoul',
      },
      error_file: 'logs/backend-error.log',
      out_file: 'logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
