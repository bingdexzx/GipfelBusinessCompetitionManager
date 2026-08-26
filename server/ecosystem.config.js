// Gipfel 商赛系统 — PM2 进程定义
// 用 __dirname 自动解析服务端目录，无论从哪个工作目录启动 PM2 都能正确定位。
// 由 tools/setup_debian.sh 与 tools/deploy.sh 调用，也可手动：
//   pm2 start ecosystem.config.js
//   pm2 save
const path = require('path');

const serverDir = __dirname;

module.exports = {
  apps: [
    {
      name: 'gipfel-server',
      cwd: serverDir,
      script: 'dist/main.js',
      instances: 1,            // SQLite 单文件，禁止 cluster 多写
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
      },
      // JWT_SECRET 等由 server/.env 经 dotenv 加载，无需在此重复写
      error_file: path.join(serverDir, 'logs', 'pm2-error.log'),
      out_file: path.join(serverDir, 'logs', 'pm2-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      min_uptime: '10s',
    },
  ],
};
