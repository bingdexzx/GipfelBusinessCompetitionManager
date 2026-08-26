#!/usr/bin/env bash
# ============================================================
# Gipfel 商赛系统 — 服务端首次部署脚本（Debian）
#
# 流程：
#   1. 检查 node(>=20) / npm / git / pm2
#   2. 生成 server/.env（含强随机 JWT_SECRET）
#   3. npm ci（走 npmmirror 镜像）
#   4. prisma generate + db push（建库）
#   5. npm run build（shared + server）
#   6. pm2 start（ecosystem.config.js）
#   7. pm2 save；提示 pm2 startup（开机自启）
#
# 用法：
#   cd /opt/gipfel && bash tools/setup_debian.sh
#
# 说明：
#   - 纯 bash + UTF-8；非 root 用户亦可运行（推荐专用用户 gipfel）。
#   - 不改系统设置，仅操作仓库目录；Node 请用 nvm/apt 预先装好。
# ============================================================
set -euo pipefail
export LC_ALL=C.UTF-8

# 定位目录：脚本在 tools/ 下，仓库根为其上级
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
cd "$SERVER_DIR"

log()  { echo -e "\033[32m[setup]\033[0m $*"; }
warn() { echo -e "\033[33m[WARN]\033[0m $*"; }
err()  { echo -e "\033[31m[ERR ]\033[0m $*"; }

# ---------- 1. 前置检查 ----------
log "检查前置依赖 (node / npm / git / pm2) ..."

command -v node >/dev/null 2>&1 || { err "未找到 node，请先安装 Node.js >= 20 LTS（推荐 nvm）。"; exit 1; }
command -v npm  >/dev/null 2>&1 || { err "未找到 npm。"; exit 1; }
command -v git  >/dev/null 2>&1 || { err "未找到 git。"; exit 1; }

# node 版本 >= 20
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js 版本过低（当前 v$(node -v)），要求 >= 20。请用 nvm install 22 后重跑。"
  exit 1
fi
log "node $(node -v) / npm $(npm -v) / git $(git --version | awk '{print $3}')"

if ! command -v pm2 >/dev/null 2>&1; then
  warn "未找到 pm2，尝试安装（需 npm 可写全局）。如失败请手动：npm install -g pm2"
  npm install -g pm2 || { err "pm2 安装失败，请手动安装后重跑。"; exit 1; }
fi
log "pm2 $(pm2 -v)"

# ---------- 2. 生成 .env ----------
if [ ! -f "$SERVER_DIR/.env" ]; then
  log "生成 server/.env（从 .env.example）..."
  cp "$SERVER_DIR/.env.example" "$SERVER_DIR/.env"
  if command -v openssl >/dev/null 2>&1; then
    JWT=$(openssl rand -hex 32)
    # 仅替换 JWT_SECRET 行（兼容带引号/不带引号）
    sed -i -E "s#^JWT_SECRET=.*#JWT_SECRET=\"$JWT\"#" "$SERVER_DIR/.env"
    log "已写入强随机 JWT_SECRET（openssl rand -hex 32）。"
  else
    warn "未找到 openssl，未自动设置 JWT_SECRET；请手动编辑 server/.env 的 JWT_SECRET 为强随机值。"
  fi
  # 国内镜像提示（写入 .env 注释无意义，这里仅日志）
  log "如为公网部署，请在 server/.env 配置 CORS_ORIGIN=https://你的域名。"
else
  warn "server/.env 已存在，跳过生成（保留现有 JWT_SECRET / 配置）。"
fi

# ---------- 3. 安装依赖 ----------
log "安装依赖 (npm ci, 走 npmmirror 镜像) ..."
export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
npm ci || { err "npm ci 失败（可能缺少 package-lock.json，或网络异常）。"; exit 1; }

# ---------- 4. 初始化数据库 ----------
log "生成 Prisma Client + 同步数据库结构 (prisma db push) ..."
npx prisma generate
npx prisma db push || { err "prisma db push 失败（若 SQLITE_BUSY，请确认无其他进程占用 dev.db）。"; exit 1; }

# ---------- 5. 构建 ----------
log "构建服务端 (shared + server) ..."
npm run build || { err "npm run build 失败。"; exit 1; }

# ---------- 6. PM2 启动 ----------
log "PM2 启动 gipfel-server ..."
pm2 start "$SERVER_DIR/ecosystem.config.js" || { err "pm2 start 失败。"; exit 1; }
pm2 save

# ---------- 7. 健康检查 + 开机自启提示 ----------
log "健康检查：curl http://localhost:3000/api/ping"
if curl -fsS http://localhost:3000/api/ping >/dev/null 2>&1; then
  log "服务已就绪 ✅"
else
  warn "健康检查未通过，请查看日志：pm2 logs gipfel-server"
fi

echo
echo "============================================================"
echo " 首次部署完成。"
echo " 重要：配置开机自启，请以 root 执行以下命令输出的内容："
echo "    pm2 startup"
echo "    pm2 save"
echo " 然后验证：curl http://localhost:3000/api/version"
echo " 默认超管 admin / admin123（首次登录强制改密）。"
echo "============================================================"
