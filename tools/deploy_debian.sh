#!/usr/bin/env bash
# ============================================================
# Gipfel 商赛系统 — 服务端一键更新脚本（Debian）
#
# 流程（任一步失败即中断，服务不会被留在半更新状态）：
#   1. 检查 pm2 / git / node
#   2. 备份 dev.db + uploads + .env -> tools/backups/gipfel-<时间戳>.tar.gz
#   3. pm2 stop gipfel-server（避免 db push 时 SQLite 被锁）
#   4. git pull
#   5. npm ci（锁文件缺失则回退 npm install）
#   6. prisma db push（同步 schema）
#   7. npm run build（shared + server）
#   8. pm2 restart（不存在则 start）+ pm2 save
#   9. 健康检查 /api/ping
#
# 用法：
#   cd /opt/gipfel && bash tools/deploy_debian.sh
#
# 回滚：见 docs/运维部署手册-Debian.md §6「回滚」。
# ============================================================
set -euo pipefail
export LC_ALL=C.UTF-8

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
BACKUP_DIR="$SCRIPT_DIR/backups"
LOG_FILE="$SCRIPT_DIR/deploy.log"
TS="$(date +%Y%m%d-%H%M%S)"

cd "$SERVER_DIR"

log()  { echo -e "\033[32m[deploy]\033[0m $*"; echo "[$(date '+%F %T')] $*" >> "$LOG_FILE"; }
warn() { echo -e "\033[33m[WARN]\033[0m $*"; echo "[$(date '+%F %T')] WARN $*" >> "$LOG_FILE"; }
err()  { echo -e "\033[31m[ERR ]\033[0m $*"; echo "[$(date '+%F %T')] ERR $*" >> "$LOG_FILE"; }

mkdir -p "$BACKUP_DIR"

log "开始更新（日志：tools/deploy.log）"

# ---------- 1. 前置检查 ----------
command -v node >/dev/null 2>&1 || { err "未找到 node。"; exit 1; }
command -v git  >/dev/null 2>&1 || { err "未找到 git。"; exit 1; }
if ! command -v pm2 >/dev/null 2>&1; then
  warn "未找到 pm2，将跳过启停（更新后请手动 node dist/main.js 或安装 pm2）。"
  HAVE_PM2=0
else
  HAVE_PM2=1
fi

# ---------- 2. 备份 ----------
log "备份数据库 + 上传目录 + .env ..."
BACKUP_FILE="$BACKUP_DIR/gipfel-$TS.tar.gz"
# 用相对路径（相对 server/）打包，便于原地恢复：tar xzf -C "$SERVER_DIR"
REL_ITEMS=()
[ -f "$SERVER_DIR/prisma/dev.db" ] && REL_ITEMS+=(prisma/dev.db)
[ -d "$SERVER_DIR/uploads" ]        && REL_ITEMS+=(uploads)
[ -f "$SERVER_DIR/.env" ]           && REL_ITEMS+=(.env)
if [ ${#REL_ITEMS[@]} -eq 0 ]; then
  warn "无可备份项（dev.db/uploads/.env 均不存在），跳过备份。"
else
  tar czf "$BACKUP_FILE" -C "$SERVER_DIR" "${REL_ITEMS[@]}" \
    || { err "备份失败。"; exit 1; }
  log "备份完成：$BACKUP_FILE（归档内路径相对 server/，可 tar xzf -C \"$SERVER_DIR\" 恢复）"
fi

# ---------- 3. 停服 ----------
if [ "$HAVE_PM2" = "1" ]; then
  log "停止服务 (pm2 stop gipfel-server) ..."
  pm2 stop gipfel-server || warn "pm2 stop 失败（可能未运行）。"
fi

# ---------- 4. 拉代码 ----------
log "git pull ..."
git pull || { err "git pull 失败（检查网络 / 本地改动 / 冲突）。如需回滚，恢复备份包并 git checkout 旧提交。"; exit 1; }

# ---------- 5. 装依赖 ----------
log "安装依赖 (npm ci) ..."
export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
if [ -f "$SERVER_DIR/package-lock.json" ]; then
  npm ci || { err "npm ci 失败。"; exit 1; }
else
  warn "缺少 package-lock.json，回退 npm install。"
  npm install || { err "npm install 失败。"; exit 1; }
fi

# ---------- 6. 迁移 ----------
log "同步数据库结构 (prisma db push) ..."
npx prisma db push || { err "prisma db push 失败（若 SQLITE_BUSY，确认已 pm2 stop）。"; exit 1; }

# ---------- 7. 构建 ----------
log "构建服务端 (npm run build) ..."
npm run build || { err "npm run build 失败。"; exit 1; }

# ---------- 8. 重启 ----------
if [ "$HAVE_PM2" = "1" ]; then
  log "重启服务 (pm2 restart / start) ..."
  if pm2 describe gipfel-server >/dev/null 2>&1; then
    pm2 restart gipfel-server
  else
    pm2 start "$SERVER_DIR/ecosystem.config.js"
  fi
  pm2 save
fi

# ---------- 9. 健康检查 ----------
sleep 3
log "健康检查：curl http://localhost:3000/api/ping"
if curl -fsS http://localhost:3000/api/ping >/dev/null 2>&1; then
  log "更新完成，服务正常 ✅"
else
  err "健康检查未通过！请查看日志：pm2 logs gipfel-server / tools/deploy.log"
  err "如需回滚：bash tools/backup_debian.sh restore $BACKUP_FILE"
  exit 1
fi

echo
echo "============================================================"
echo " 更新成功。备份包：$BACKUP_FILE"
echo " 回滚方式见 docs/运维部署手册-Debian.md §6。"
echo "============================================================"
