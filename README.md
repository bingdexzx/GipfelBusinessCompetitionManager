# Gipfel 商赛系统（商赛辅助系统）

商业模拟竞赛（商赛）的办赛方数据管理工具。办赛方通过本系统维护竞赛所需的全量标准化数据、配置比赛参数，并通过配置驱动的合同引擎与可视化编辑能力高效运作赛事

> 完整设计、接口、权限与模块细节见 [`docs/软件文档.md`](docs/软件文档.md)。

## 技术架构

| 层 | 技术栈 |
| -- | ------ |
| 客户端 | Electron + Vue 3 + TypeScript + Element Plus + Pinia + Axios + Vite + Socket.IO Client + Konva（地图/科技树/合同画布） |
| 服务端 | NestJS（无 UI，带 Winston 日志）+ Prisma + SQLite + JWT + Passport + Socket.IO |
| 数据库 | SQLite（Prisma ORM，单文件 `server/prisma/dev.db`） |
| 发版工具 | `updater/`（本地发布页 + 版本改写脚本） |

服务端默认监听 `http://localhost:3000`，并为 Socket.IO 复用同一端口；REST 与 WebSocket 共享该端点。

## 目录结构

```
.
├── server/                 # NestJS 服务端（API + 实时 + 日志）
│   ├── src/
│   └── prisma/             # schema.prisma + seed.ts
├── client/                 # Electron + Vue3 客户端
│   └── src/
├── docs/                   # 软件文档（整合版）
├── updater/                # 本地发布页与版本改写脚本
├── build.bat               # 构建服务端 + 客户端
├── package.bat             # 打包 Windows 安装包（NSIS）
├── start_server.bat        # 启动服务端（dev）
└── start_client.bat        # 启动客户端（dev）
```

## 环境要求

- Node.js 18+（服务端 NestJS、客户端 Electron/Vite 均依赖现代 Node）
- npm

## 快速开始（开发模式）

```bash
# 1. 安装依赖（分别安装服务端、客户端）
cd server   && npm install
cd ../client && npm install

# 2. 初始化数据库（建表 + 创建默认超级管理员）
cd ../server
npx prisma db push
npx prisma db seed

# 3. 启动服务端（开发热重载，默认 3000 端口）
npm run start:dev

# 4. 启动客户端（Vite + Electron 开发模式，另开一个终端）
cd ../client
npm run dev
```

也可直接双击根目录 `start_server.bat` / `start_client.bat` 分别启动前后端。

## 默认管理员

- 用户名：`admin`
- 密码：`admin123`
- 角色：`SUPER_ADMIN`

> 首次登录后**必须修改密码**。仅 `SUPER_ADMIN` 可增删改数据与账户。

## 构建安装包

以管理员身份运行根目录 `package.bat`（Windows），会自动使用国内 npmmirror 镜像构建客户端并生成 NSIS 安装包，输出至 `client/release/`，形如 `Gipfel商赛系统 Setup 1.0.0.exe`（安装时可选择安装位置）。

> 若遇到符号链接/解压权限问题，请右键 `package.bat` → 「以管理员身份运行」。

## 版本与发版

版本号存在两处真源：`client/package.json`（`app.getVersion()`）与 `server/package.json`（`GET /api/version`）。发版由 `updater/release-core.mjs` 统一改写两处 `version`，确保二者一致。

## 安全说明

- 服务端默认 JWT 密钥从环境变量读取，部署前请设置强密钥（避免默认密钥）。
- 已内置登录限流、跨租户隔离、WebSocket 房间归属、CORS/Helmet 等加固项；详见软件文档「安全」相关章节。
- 跨租户隔离：归属比赛的账号（`competitionId` 非空，如 PLAYER/COMPETITION_ADMIN）登录后**自动锁定并显示所属比赛**，无需手动选择，也避免选错比赛触发 `无权访问该比赛的数据`（403）；超管 / 未分配账号（`competitionId` 为空）仍保留手动选择能力。
- 默认超管密码仅为初始值，务必在生产环境修改。

## 许可证

办赛辅助工具，许可证以仓库配置为准。
