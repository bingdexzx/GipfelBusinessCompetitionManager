#!/usr/bin/env bash
# ============================================================
# Gipfel 商赛系统 — 备份 / 恢复脚本（Debian）
#
# 备份：打包 server/prisma/dev.db + server/uploads + server/.env
#       为 tools/backups/gipfel-<时间戳>.tar.gz（路径相对 server/）
# 恢复：bash tools/backup.sh restore <备份包路径>
#       停服后将备份原地解回 server/ 目录
#
# 用法：
#   cd /opt/gipfel && bash tools/backup.sh            # 备份
#   cd /opt/gipfel && bash tools/backup.sh restore tools/backups/gipfel-xxxx.tar.gz
#
# 注意：.env 含 JWT_SECRET，恢复后请勿再改 JWT_SECRET，否则已签发 JWT 全部失效。
# ============================================================
set -euo pipefail
export LC_ALL=C.UTF-8

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
BACKUP_DIR="$SCRIPT_DIR/backups"

log() { echo -e "\033[32m[backup]\033[0m $*"; }
err() { echo -e "\033[31m[ERR ]\033[0m $*"; }

mkdir -p "$BACKUP_DIR"

# 恢复模式
if [ "${1:-}" = "restore" ]; then
  SRC="${2:-}"
  [ -z "$SRC" ] && { err "用法：bash tools/backup.sh restore <备份包路径>"; exit 1; }
  [ -f "$SRC" ] || { err "备份包不存在：$SRC"; exit 1; }
  # 提示停服
  if command -v pm2 >/dev/null 2>&1 && pm2 describe gipfel-server >/dev/null 2>&1; then
    echo -e "\033[33m[WARN]\033[0m 检测到 gipfel-server 正在运行，建议先：pm2 stop gipfel-server"
    read -r -p "是否现在停止 PM2 服务并继续恢复？(y/N) " ANS
    if [ "$ANS" = "y" ] || [ "$ANS" = "Y" ]; then
      pm2 stop gipfel-server || true
    else
      err "已取消。请手动停服后再恢复。"; exit 1
    fi
  fi
  tar xzf "$SRC" -C "$SERVER_DIR"
  log "已从 $SRC 恢复 dev.db / uploads / .env 到 $SERVER_DIR"
  log "恢复后如需启动：pm2 start $SERVER_DIR/ecosystem.config.js"
  exit 0
fi

# 备份模式
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/gipfel-$TS.tar.gz"
REL_ITEMS=()
[ -f "$SERVER_DIR/prisma/dev.db" ] && REL_ITEMS+=(prisma/dev.db)
[ -d "$SERVER_DIR/uploads" ]        && REL_ITEMS+=(uploads)
[ -f "$SERVER_DIR/.env" ]           && REL_ITEMS+=(.env)

if [ ${#REL_ITEMS[@]} -eq 0 ]; then
  err "无可备份项（dev.db/uploads/.env 均不存在）。请先完成首次部署。"
  exit 1
fi

# 建议在停服或低峰期备份，避免复制到写一半的 SQLite
if command -v pm2 >/dev/null 2>&1 && pm2 describe gipfel-server >/dev/null 2>&1; then
  log "提示：服务正在运行，建议在 pm2 stop 后备份以获得一致快照。"
fi

tar czf "$BACKUP_FILE" -C "$SERVER_DIR" "${REL_ITEMS[@]}"
log "备份完成：$BACKUP_FILE"
log "归档内容（相对 server/）：${REL_ITEMS[*]}"
