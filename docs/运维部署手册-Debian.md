# Gipfel 商赛系统 — 服务端运维部署手册（Debian）

> 适用对象：在 **Debian 11/12（x86_64）** 服务器上部署、运维本系统服务端的运维人员。
> 本地开发环境为 Windows 64 位；本文档聚焦于**生产服务器（Debian）**一侧的服务端部署与运维。
> 版本配套：当前 `1.3.16`（client 与 server 版本号需一致，见 §12）。

---

## 0. 文档定位

本文档只讲**服务端（NestJS + Prisma + SQLite）**在 Debian 上的事：安装、配置、启动、守护、更新、备份、日志、排障、安全。

客户端是 **Electron 桌面程序**，打包后分发给选手/管理员，并不在服务器上运行，也不由服务器托管。客户端打包与分发见 §12。

配套脚本（均在仓库 `tools/` 下，纯 bash，UTF-8）：

| 脚本 | 作用 | 运行位置 |
|------|------|----------|
| `tools/setup_debian.sh` | 首次部署：环境检查 + 生成 `.env` + 装依赖 + 建库 + 构建 + PM2 启动 | 服务器 |
| `tools/deploy.sh` | 增量更新：拉代码 + 备份 + 装依赖 + 构建 + 迁移 + 重启 + 健康检查 | 服务器 |
| `tools/backup.sh` | 一次性备份：数据库 + 上传目录 + `.env` 打包为时间戳压缩包 | 服务器 |
| `server/ecosystem.config.js` | PM2 进程定义（供上述脚本调用） | 服务器 |

> Windows 服务器上仍可用原有 `tools/update_server.bat`；Debian 上请用本文档的 `setup_debian.sh` / `deploy.sh`。

---

## 1. 系统架构与部署拓扑

```
┌─────────────────────────── 选手/管理员机器（任意 OS） ───────────────────────────┐
│  Electron 桌面客户端（Vue3）                                                      │
│   - 启动时连接服务端地址（设置里可改，默认 http://<服务器IP>:3000）                 │
│   - REST(JSON) + Socket.IO（实时广播）均走同一端口                                 │
└───────────────────────────────┬──────────────────────────────────────────────────┘
                                  │  HTTP :3000  (REST + WebSocket 复用)
                                  ▼
┌─────────────────────────── Debian 服务器 ───────────────────────────────────────┐
│  Node.js (PM2 守护)                                                              │
│    gipfel-server  →  dist/main.js  (NestJS)                                      │
│      ├─ REST API        /api/*                                                   │
│      ├─ 健康检查         GET /api/ping   （无鉴权，返回 {"status":"ok",...}）      │
│      ├─ 版本号           GET /api/version （客户端硬封锁比对）                     │
│      ├─ 静态资源         /uploads/*   （地图背景图、消息图片，CORP=cross-origin）   │
│      └─ Socket.IO       同源 :3000                                              │
│                                                                                 │
│  SQLite 单文件   server/prisma/dev.db   （全部业务数据，含多租户隔离）             │
│  上传目录         server/uploads/         （图片文件，落盘不入库）                 │
│  日志目录         server/logs/            （Winston 按天滚动）                     │
│  配置             server/.env             （JWT_SECRET 等，不入库、不提交）        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**关键事实（排障必读）：**

- 服务端**只跑后端**。客户端是独立桌面程序，服务器不托管网页、不分发安装包（安装包由 CI 构建后线下分发，见 §12）。
- REST 与 Socket.IO **复用 3000 端口**（同源），无需额外 WS 端口。
- `app.listen(port)` 未指定 host，**默认绑定 `0.0.0.0`**（所有网卡），因此局域网内其他机器可直接访问。公网暴露请见 §10（建议加 nginx + HTTPS）。
- 数据库是 **SQLite 单文件**，无需单独的数据库服务进程；但它是**单点文件**，备份/迁移只需复制该文件（见 §7）。
- 跨源凭据（JWT）在**未配置 `CORS_ORIGIN`** 时，仅对 `localhost` / 回环 / RFC1918 私网 / `file://` / `app://` 反射放行；**公网来源一律拒绝**。桌面客户端若从私网 IP 连接，默认即可用；若从公网域名访问，必须显式配置 `CORS_ORIGIN` 且配合 HTTPS（§10）。

---

## 2. 硬件与系统要求

| 项 | 要求 | 说明 |
|----|------|------|
| 操作系统 | Debian 11 (bullseye) / 12 (bookworm)，x86_64 | arm64 亦可，但需对应 Node 与 electron 构建（客户端打包见 §12） |
| Node.js | **≥ 20 LTS，推荐 22 LTS** | CI 使用 Node 22；`@types/node` 为 26，仅类型不影响运行 |
| npm | ≥ 9（随 Node 安装） |  |
| git | 任意较新版本 | 用于 `git pull` 更新 |
| PM2 | 最新稳定版（`npm i -g pm2`） | 进程守护 + 开机自启 |
| 内存 | ≥ 1 GB（推荐 2 GB） | SQLite + Node 常驻；PM2 配置 `max_memory_restart: 512M` |
| 磁盘 | ≥ 5 GB 可用 | 依赖安装约 1–2 GB；SQLite 随数据增长 |
| 网络 | 出网可访问 `registry.npmmirror.com`（国内镜像） | 依赖安装与 electron 二进制下载走镜像，避免 GitHub 超时 |

> SQLite 为文件数据库，**不支持多进程并发写**。本系统服务端为单实例（`instances: 1`，fork 模式），请勿用 PM2 cluster 模式横向扩展写同一 SQLite 文件。

---

## 3. 目录与环境约定

推荐安装位置（二选一，下文以 `/opt/gipfel` 为例）：

```
/opt/gipfel/                 # 仓库根（git clone 目标）
├── server/                  # 服务端（PM2 实际运行目录）
│   ├── .env                 # 运行配置（setup 脚本生成，勿提交）
│   ├── dist/main.js         # 构建产物
│   ├── prisma/dev.db        # SQLite 数据库（核心，必须备份）
│   ├── uploads/             # 上传的图片（必须备份）
│   └── logs/                # Winston 日志
├── client/                  # 客户端源码（服务器上一般只需构建分发，可不部署）
├── shared/engine-dsl/       # 表达式引擎共享包（server 构建时自动编译）
└── tools/                   # 运维脚本
```

环境变量约定（详见 `server/.env.example`）：

| 变量 | 必填 | 默认 | 说明 |
|------|------|------|------|
| `PORT` | 否 | `3000` | 监听端口 |
| `DATABASE_URL` | 否 | `file:./dev.db` | SQLite 路径（相对 `server/prisma/`） |
| `JWT_SECRET` | **是** | — | JWT 签名密钥，**缺失则服务启动即退出（fail-closed）**；生产用 `openssl rand -hex 32` |
| `SEED_ADMIN_PASSWORD` | 否 | `admin123` | 仅首次自举超管密码；之后走强制改密 |
| `JWT_EXPIRES_IN` | 否 | `24h` | Token 有效期 |
| `JWT_ISSUER` / `JWT_AUDIENCE` | 否 | `gipfel-competition` / `gipfel-competition-client` | 必须与客户端一致 |
| `LOG_LEVEL` | 否 | `info` | `error/warn/info/debug` |
| `LOG_DIR` | 否 | `./logs` | 日志目录（相对 `server/`） |
| `CORS_ORIGIN` | 否 | 空 | 公网白名单（逗号分隔）；留空=仅私网/本地反射 |

> **铁律**：`.env` 被 `.gitignore` 忽略、不入库。服务器 `git clone` / `git pull` 后**不会自动有 `.env`**，必须由 `setup_debian.sh` 生成或手动 `cp .env.example .env` 并填 `JWT_SECRET`。缺失会启动失败（这是安全设计，不是 bug）。

---

## 4. 首次部署

### 4.1 安装 Node.js（推荐 nvm 方式，避免系统 apt 版本过旧）

```bash
# 以专用非 root 用户（建议 gipfel）操作；以下示例用该用户家目录
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm install 22          # 安装 Node 22 LTS
nvm alias default 22    # 设为默认
node -v                 # 期望 v22.x
npm -v
```

> 若走 apt：`curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs`。但 nvm 更灵活、不影响系统包。
> 建议**不要用 root 直接跑服务**：新建用户 `adduser gipfel`，后续均以 `gipfel` 操作（§11 安全）。

### 4.2 安装 git / PM2

```bash
sudo apt-get update
sudo apt-get install -y git curl
npm install -g pm2        # 若用 nvm，此 pm2 装在当前用户下；开机自启见 §4.8
```

### 4.3 获取代码

```bash
sudo mkdir -p /opt && sudo chown -R gipfel:gipfel /opt/gipfel
git clone <你的仓库地址> /opt/gipfel
cd /opt/gipfel
```

> 国内 clone GitHub 慢/超时：可改用 SSH 或 Gitee 镜像，或临时 `git config --global url."https://ghproxy.com/https://github.com/".insteadOf "https://github.com/"`。

### 4.4 配置 .env（create_debian.sh 会自动做，这里给手动步骤）

```bash
cd /opt/gipfel/server
cp .env.example .env
# 生成强随机 JWT_SECRET 并写入（用编辑器或直接 sed）
JWT=$(openssl rand -hex 32)
sed -i "s#^JWT_SECRET=.*#JWT_SECRET=\"$JWT\"#" .env
# 视需要修改 PORT / CORS_ORIGIN / LOG_LEVEL 等
cat .env
```

### 4.5 安装依赖 + 初始化数据库 + 构建（create_debian.sh 一键完成）

```bash
cd /opt/gipfel/server
export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com   # 国内镜像加速
npm ci                      # 依据 package-lock.json 精确安装（要求 lockfile 存在）
npx prisma generate         # 生成 Prisma Client
npx prisma db push          # 建表/同步 schema 到 SQLite（首次即创建 dev.db）
npm run build               # 编译 shared + server → dist/
```

> `npm run build` = `tsc -p ../shared/engine-dsl/tsconfig.json && nest build`，会把共享表达式引擎包一并编译。
> 若你**改过 `schema.prisma`**：必须先停服务 → `npx prisma db push` → `npm run build` → 重启（§9.2）。

### 4.6 启动（PM2）

```bash
cd /opt/gipfel/server
pm2 start ecosystem.config.js     # 定义见 server/ecosystem.config.js（用 __dirname 自动定位目录）
pm2 save                          # 保存进程列表
```

### 4.7 开机自启

```bash
pm2 startup          # 按提示把输出的命令（含 systemd 单元）以 root 执行一次
pm2 save             # 再次保存，确保重启后自动拉起
```

### 4.8 健康检查

```bash
curl -s http://localhost:3000/api/ping
# 期望返回： {"status":"ok","timestamp":"..."}

curl -s http://localhost:3000/api/version
# 期望返回： {"code":0,"message":"成功","data":{"version":"1.3.16"}}
```

### 4.9（推荐）一键首次部署

上述 4.1–4.8 已封装为脚本，在服务器上执行：

```bash
cd /opt/gipfel
bash tools/setup_debian.sh
```

脚本会自动：检查 node≥20/npm/git/pm2 → 生成 `.env` 与强随机 `JWT_SECRET` → `npm ci`（走 npmmirror）→ `prisma generate` + `db push` → `npm run build` → `pm2 start` → `pm2 save` → 提示 `pm2 startup`。运行结束后请按脚本提示执行 `pm2 startup` 给出的命令。

---

## 5. 日常运维命令速查（PM2）

```bash
pm2 ls                     # 查看进程列表与状态
pm2 logs gipfel-server     # 实时日志（Ctrl+C 退出）
pm2 logs gipfel-server --lines 200
pm2 restart gipfel-server  # 重启
pm2 stop gipfel-server     # 停止（不停机维护时用）
pm2 reload gipfel-server   # 优雅重启（本系统为 fork 单实例，等同 restart）
pm2 delete gipfel-server   # 从 PM2 列表移除
pm2 monit                  # 资源监控（CPU/内存）
pm2 save                   # 变更后保存列表（开机自启依赖）
```

应用日志同时落在 `server/logs/`（Winston 按天滚动，见 §8），PM2 自身的 stdout/stderr 在 `server/logs/pm2-*.log`。

---

## 6. 一键更新（deploy.sh）

代码或数据库结构变更后，在服务器项目根目录执行：

```bash
cd /opt/gipfel
bash tools/deploy.sh
```

脚本执行流程（任一步失败即中断并提示，不会把服务留在半更新状态）：

1. 检查 `pm2`、`git`、`node` 是否就绪；
2. **备份** `prisma/dev.db` + `uploads/` + `.env` 到 `tools/backups/gipfel-<时间戳>.tar.gz`；
3. `pm2 stop gipfel-server`（停服，避免 db push 时 SQLite 被锁）；
4. `git pull`（失败则中止，提示检查网络/本地改动）；
5. `npm ci`（依赖变更时更新；锁文件缺失会自动回退 `npm install`）；
6. `npx prisma db push`（同步 schema；客户端已随 `npm ci` 生成）；
7. `npm run build`（shared + server 重新编译）；
8. `pm2 restart gipfel-server`（不存在则 `pm2 start`）；
9. `pm2 save`；
10. **健康检查** `curl /api/ping`，失败则告警。

> 国内 `git pull` 连 GitHub 超时：脚本内部 `git pull` 失败会提示，可手动换镜像或 SSH 后重跑。
> 更新窗口建议选比赛间隙；`db push` 对已有数据默认**非破坏性**（不会删列/删数据），但重大 schema 改动前务必先确认备份（步骤 2 已自动备份）。

### 回滚

若更新后异常，可回滚：

```bash
cd /opt/gipfel
# 1) 恢复数据库与上传（从最新备份包）
bash tools/backup.sh restore tools/backups/gipfel-<时间戳>.tar.gz
# 2) 退回上一个 git 提交（按实际版本号）
git log --oneline -5
git checkout <上一个稳定commit>
# 3) 重新构建并重启
cd server && npm run build && pm2 restart gipfel-server
```

---

## 7. 备份与恢复

### 7.1 备份什么

| 路径 | 是否必须 | 说明 |
|------|----------|------|
| `server/prisma/dev.db` | **必须** | 全部业务数据（多租户隔离于此） |
| `server/uploads/` | **必须** | 地图背景图、消息图片等落盘文件（不入库） |
| `server/.env` | **必须** | 含 `JWT_SECRET`；**恢复时必须用同一份**，否则已签发的 JWT 全部失效（用户被顶号/需重登） |
| `server/logs/` | 可选 | 运维审计日志，按需保留 |

> SQLite 为单文件，备份即复制文件；**务必在停服或低峰期**复制，避免复制到写一半的库（脚本 `deploy.sh` 在 `pm2 stop` 后备份）。

### 7.2 一键备份

```bash
cd /opt/gipfel
bash tools/backup.sh
# 产物：tools/backups/gipfel-YYYYMMDD-HHMMSS.tar.gz
```

脚本内容：打包 `server/prisma/dev.db`、`server/uploads/`、`server/.env` 为时间戳压缩包；可加 `restore <包路径>` 子命令原地恢复。

### 7.3 手动恢复

```bash
pm2 stop gipfel-server
cd /opt/gipfel
tar xzf tools/backups/gipfel-<时间戳>.tar.gz -C /
pm2 start ecosystem.config.js
```

> 恢复 `.env` 后**不要**再改 `JWT_SECRET`，否则所有在线令牌失效。

---

## 8. 日志

- **应用日志（Winston）**：`server/logs/`
  - `app-YYYY-MM-DD.log`（访问/业务）、`error-YYYY-MM-DD.log`（异常），按天滚动。
  - 含 `context`、`operator`、`requestId`、IP 等字段，便于审计。
- **审计表**：写操作与异常上下文额外落 `AuditLog` 数据库表（可用 `npx prisma studio` 查看，§9.1）。
- **PM2 日志**：`server/logs/pm2-out.log`、`pm2-error.log`（进程 stdout/stderr）。
- **查看技巧**：
  ```bash
  pm2 logs gipfel-server --lines 300
  tail -f /opt/gipfel/server/logs/app-$(date +%F).log
  grep -n "401" /opt/gipfel/server/logs/app-$(date +%F).log | tail -20
  ```

---

## 9. 数据库维护

### 9.1 只读查看（Prisma Studio）

```bash
cd /opt/gipfel/server
npx prisma studio        # 本地起一个 Web UI（默认 :5555），仅查看/手动改，慎用于生产
```

> 生产环境建议临时起、用完即关；不要长期暴露 5555 端口。

### 9.2 修改 schema 的标准流程（铁律）

1. **停服务**：`pm2 stop gipfel-server`（否则 db push 时 SQLite 可能被锁，报 `SQLITE_BUSY`/`SQLITE_READONLY`）。
2. 改 `server/prisma/schema.prisma`。
3. `npx prisma db push`（同步结构；已有数据默认保留）。
4. `npm run build`（DTO/装饰器/查询改动需重新编译才生效）。
5. `pm2 start ecosystem.config.js` 或 `pm2 restart gipfel-server`。

> 切勿用 `setStatus` 之类的旁路手段直接改库状态；数据库是单一真源，一切经应用层。

### 9.3 忘记 admin 密码

二选一：
- **重置整库**：停服 → 删 `server/prisma/dev.db` → 启动 → 自动自举 `admin / admin123`（首次登录强制改密）。⚠️ 会清空所有数据，仅限全新环境。
- **仅改密码**（保留数据）：用 `prisma studio` 或 `sqlite3` 找到 `User` 表 `username='admin'` 行，用 bcryptjs 生成新哈希覆盖 `passwordHash`，并把 `mustChangePassword` 置 `1`，重启。

---

## 10. 反向代理与公网暴露（可选，推荐公网部署时做）

### 何时需要

- 桌面客户端从**公网域名**访问，且需要携带 JWT 凭据跨源 → 浏览器要求 **HTTPS** 才能安全跨源；
- 想隐藏真实端口、统一 TLS、做限流/防刷。

### nginx 示例（Debian 安装 `sudo apt-get install -y nginx`）

```nginx
# /etc/nginx/sites-available/gipfel
server {
    listen 443 ssl;
    server_name gipfel.example.com;

    ssl_certificate     /etc/ssl/gipfel/fullchain.pem;
    ssl_certificate_key /etc/ssl/gipfel/privkey.pem;

    # WebSocket（Socket.IO）必须允许升级
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;   # 长连接/实时推送
    }
}
```

配套 `.env`：

```env
CORS_ORIGIN=https://gipfel.example.com
```

> 仅局域网/私网部署（客户端从 `192.168.x.x` / `10.x` 等连接）**无需** nginx，服务端默认放行私网来源；直接 `http://<服务器IP>:3000` 即可。
> 若公网但**不**配 `CORS_ORIGIN` + HTTPS：客户端跨源凭据会被 CORS 中间件拒绝（设计如此，非故障）。

---

## 11. 安全加固清单

| 项 | 做法 |
|----|------|
| 运行用户 | 用**非 root** 专用用户（如 `gipfel`）运行 Node/PM2；`/opt/gipfel` 属主归该用户 |
| 防火墙 | `sudo ufw allow 22,80,443`；若直连 3000 则 `sudo ufw allow 3000`，否则只对内网开放 |
| JWT 密钥 | `JWT_SECRET` 用 `openssl rand -hex 32`，**绝不**用默认值；备份 `.env`（§7） |
| 公网 | 必须 HTTPS + `CORS_ORIGIN` 白名单（§10）；不要放开 `*` 给公网 |
| 登录限流 | 服务端已内置：同 IP+用户名 10 次/5 分钟失败锁 15 分钟（429），无需额外配置 |
| 备份 | 定时执行 `tools/backup.sh`（可加 cron），备份包存异地/对象存储 |
| 版本一致 | 客户端与服务端版本号必须一致（§12），避免功能被硬封锁 |
| 定期更新 | 依赖漏洞：更新前先在测试环境 `npm ci && npm run build` 验证 |
| 不要暴露 | 勿公开 5555（Prisma Studio）、3000 直连（公网场景） |

---

## 12. 版本与发版 / 客户端分发

### 12.1 版本硬封锁

客户端 `app.getVersion()` 与服务端 `GET /api/version` 必须**完全一致**，否则客户端启动后弹出**不可关闭**的全屏提示，每 5 分钟复核。两处真源：

- `client/package.json` → `version`
- `server/package.json` → `version`

发版由 `tools/updater/`（本地）统一改写两处并生成公告；CI（`.github/workflows/build.yml`）在推送 `v*` tag 时跨平台构建安装包。

### 12.2 客户端打包与分发（不在服务器上做）

> 桌面客户端**不在 Debian 服务器运行**。打包在开发机或 CI 完成，产物线下分发给选手/管理员。

| 平台 | 命令（在 client/ 下） | 产物 |
|------|----------------------|------|
| Windows | `npm run electron:build` | `release/Gipfel商赛系统 1.3.16-win-<arch>.exe`（nsis，ia32+x64） |
| macOS | `npm run electron:build -- --mac` | `release/*.dmg`（x64+arm64，需 macOS/CI 构建） |
| Linux | `npm run electron:build -- --linux --x64` | `release/*.AppImage` + `*.deb`（x64+arm64） |

> 国内网络慢：构建前设 `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/` 与 `ELECTRON_BUILDER_BINARIES_MIRROR=...` 走镜像。
> macOS 安装包**必须在 macOS 或 macOS CI** 构建；Windows/Linux 无法出 mac 包。
> 服务器端只保证 `server/package.json` 的 `version` 与分发出去的客户端一致即可。

---

## 13. 故障排查

| 现象 | 根因 / 处理 |
|------|------------|
| 启动即退出，日志 `环境变量校验失败: JWT_SECRET is required` | `.env` 缺失或 `JWT_SECRET` 为空。`cp .env.example .env` 并填强随机值（§4.4）。**这是 fail-closed 安全设计，不是 bug**。 |
| `EADDRINUSE :::3000` | 端口被占用。改 `PORT` 或停掉占用进程：`lsof -i:3000` / `pm2 delete` 残留实例。 |
| 客户端登录后提示「版本不一致」无法操作 | `client/package.json` 与 `server/package.json` 的 `version` 不一致。对齐两者后重启两端（§12.1）。 |
| 启动瞬间出现几十条 `401 anonymous` 日志 | **正常启动态现象**：未登录客户端并发增量对账（带 `updatedAfter`）所致，与服务无关；稳定后应消失。若持续 401 洪流，检查 `JWT_SECRET` 是否与客户端签发时一致（常见：服务器 `.env` 与之前不一致导致旧 token 全失效）。 |
| 登录后左上角财年显示异常 | 多为前端 `localStorage` 残留 `currentCompetition` 或 token 命名空间错乱；清客户端登录态重登即可。后端超管走跳过校验分支，返回当前比赛财年。 |
| `prisma db push` 报 `SQLITE_BUSY` / `SQLITE_READONLY` | 后端进程正在占用 `dev.db`。先 `pm2 stop gipfel-server` 再 push（§9.2）。 |
| git pull 失败（GitHub 超时） | 国内网络问题。换 SSH / Gitee 镜像，或 `git config --global url."https://ghproxy.com/..."`。 |
| npm install 卡在 electron 二进制下载 | 设 `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR` 走 npmmirror（仅客户端打包需要；服务端 `npm ci` 一般不需）。 |
| CORS 公网来源被拒 | 未配 `CORS_ORIGIN` 时公网来源一律拒绝。配 `CORS_ORIGIN=https://域名` 并配合 HTTPS（§10）。 |
| 服务起不来但无日志 | 看 PM2 日志 `pm2 logs gipfel-server`，或 `node dist/main.js` 前台直跑看报错。 |

---

## 14. 运维任务 Checklist

**上线前**
- [ ] 非 root 用户 `gipfel` 已建，目录属主正确
- [ ] Node 22 LTS（nvm 或 apt），`node -v` 确认
- [ ] `server/.env` 已生成，`JWT_SECRET` 为强随机
- [ ] `npm ci && npx prisma db push && npm run build` 通过
- [ ] `pm2 start ecosystem.config.js && pm2 save`
- [ ] `pm2 startup` 提示命令已执行（开机自启）
- [ ] `curl /api/ping` 返回 ok；`/api/version` 版本正确
- [ ] 防火墙只开必要端口
- [ ] 首次备份 `tools/backup.sh` 成功，备份包已异地留存
- [ ] 用 `admin/admin123` 登录并强制改密

**日常**
- [ ] 监控 `pm2 ls` 状态、`pm2 monit` 资源
- [ ] 关注 `server/logs/error-*.log`
- [ ] 定时（如每日）`tools/backup.sh`

**更新后**
- [ ] `tools/deploy.sh` 全流程无报错
- [ ] 健康检查 `curl /api/ping` 通过
- [ ] 客户端版本号与 `server/package.json` 一致（§12.1）
- [ ] 抽检关键功能（登录、比赛切换、数据读写）

---

## 15. 脚本索引与参考

| 文件 | 说明 |
|------|------|
| `tools/setup_debian.sh` | 首次部署（§4.9） |
| `tools/deploy.sh` | 增量更新（§6） |
| `tools/backup.sh` | 备份/恢复（§7） |
| `server/ecosystem.config.js` | PM2 进程定义 |
| `server/.env.example` | 环境变量模板 |
| `docs/软件文档.md` | 完整软件文档（接口/流程/配置） |
| `README.md` | 项目总览与开发快速开始 |

> 原始设计原则：**先文档、后改动、改完即提交**。本手册与脚本配套使用；任何脚本改动请同步更新本文档对应章节。
