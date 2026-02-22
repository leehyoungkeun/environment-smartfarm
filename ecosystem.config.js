module.exports = {
  apps: [
    {
      name: 'smartfarm-backend',
      script: 'backend/src/app.js',
      interpreter: 'node',
      interpreter_args: '--experimental-specifier-resolution=node',
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
      },
      error_file: 'logs/backend-error.log',
      out_file: 'logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
