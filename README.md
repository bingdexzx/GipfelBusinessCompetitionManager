# Gipfel 商赛系统（商赛辅助系统）

商业模拟竞赛（商赛）的办赛方数据管理桌面应用。办赛方通过本系统维护竞赛所需的全量标准化数据、配置比赛参数，并通过配置驱动的合同引擎与可视化编辑能力高效运作赛事。

## 核心功能

- **比赛与财年管理**：创建比赛（租户根），开/关财年；所有业务数据按 `competitionId` 隔离
- **数据管理**：原料、零件、产品、地图（节点/边/类型/路径类型）、基建、科技树、燃料、载具、仓库、生产线、产业类型（含计算字段与财年定时器）、公司及其产业字段、区域与消费者需求
- **合同系统**：配置驱动的合同类型模板 + 执行引擎（改写公司产业字段），含前置检查、可视化图编辑器、字段改写记录（支持合同删除时精确撤销）
- **股票系统**：模拟股票交易——玩家下单（买入/卖出），高级管理推进轮次后系统撮合→定价→生成 K 线；支持 PE 联动/随机模式、区域总览字段实时绑定
- **消息中心**：办赛方可向指定账号定向发布消息（支持附带图片），接收方在线时收到实时弹窗
- **区域总览**：按区域展示公司产业字段数据框，支持消费者需求管理
- **仪表盘**：可自定义控件的仪表盘系统，支持文字/仪表/表格内置控件和自定义 Vue 组件控件，支持字段绑定和拖拽布局
- **账户与权限管理**：超级管理员 + 细粒度权限（31 个权限 key，18 个域，5 个范围约束字段）
- **认证授权**：JWT 令牌 + 单设备登录互斥（tokenVersion）+ 强制改密
- **实时广播**：基于 Socket.IO 的通用广播基建，Prisma 写操作后自动触发资源变更广播，客户端精确处理增量同步
- **本地缓存与增量同步**：IndexedDB 按账号分库，全量副本 + 增量基线 + 断线重连对账
- **版本一致性硬封锁**：客户端与服务端版本不一致时锁定全部功能
- **更新公告**：每次发版后向用户弹出更新公告，确认后不再自动弹出

> 完整设计、接口、权限与模块细节见 [`docs/软件文档.md`](docs/软件文档.md)。
> 系统架构图见 [`docs/系统架构图.md`](docs/系统架构图.md)。
> 系统设计与核心数据流见 [`docs/设计文档.md`](docs/设计文档.md)。
> 权限分级与重构设计见 [`docs/权限分级与重构设计.md`](docs/权限分级与重构设计.md)。
> 数据同步与实时机制重构设计见 [`docs/数据同步与实时机制重构设计.md`](docs/数据同步与实时机制重构设计.md)。
> 前端刷新机制重构设计见 [`docs/前端刷新机制重构设计.md`](docs/前端刷新机制重构设计.md)。
> 股票系统优化设计（消除一字涨停/跌停）见 [`docs/股票系统优化设计.md`](docs/股票系统优化设计.md)。
> 仪表盘自定义控件开发指南见 [`docs/自定义控件开发指南.md`](docs/自定义控件开发指南.md)。

## 技术架构

| 层 | 技术栈 |
| -- | ------ |
| 客户端 | Electron 33 + Vue 3.4 + TypeScript + Element Plus 2.7 + Pinia 4 + Axios + Vite 7 + Socket.IO Client + vue-konva（地图画布）+ ECharts 6（科技树/K线/仪表盘） |
| 服务端 | NestJS 11 + Prisma 6 + SQLite + JWT + Passport + Socket.IO 4 + Winston（日志）+ bcryptjs（密码哈希） |
| 数据库 | SQLite（Prisma ORM，单文件 `server/prisma/dev.db`，25 个数据模型） |
| 发版工具 | `tools/updater/`（本地发布页 + 版本改写脚本） |

服务端默认监听 `http://localhost:3000`，并为 Socket.IO 复用同一端口；REST 与 WebSocket 共享该端点。

### 请求处理管线

```
HTTP Request
  → OperatorMiddleware (JWT解析 → AsyncLocalStorage 日志上下文)
  → securityHeaders (CSP / X-Frame-Options / CORP)
  → loginRateLimiter (IP+用户名 10次/5分钟 → 锁定15分钟)
  → CORS (白名单 / 本地网络反射)
  → JwtAuthGuard (JWT验证 + tokenVersion 单设备互斥)
  → MustChangePasswordGuard (强制改密拦截)
  → CompetitionScopeGuard (多租户比赛隔离)
  → OwnershipGuard (资源归属校验 / BOLA防御)
  → ValidationPipe (class-validator 白名单 + 类型转换)
  → PermissionsGuard (RBAC 细粒度权限)
  → Controller → Service → PrismaService
  → ResponseInterceptor ({ code:0, message:"成功", data })
  → LoggingInterceptor (请求日志)
  → HttpExceptionFilter (异常捕获 → 中文错误信息)
```

## 目录结构

```
.
├── server/                         # NestJS 服务端（API + 实时 + 日志）
│   ├── src/
│   │   ├── main.ts                 # 启动入口、全局管线、默认超管自举
│   │   ├── app.module.ts           # 根模块（24 个子模块 + 5 个全局守卫）
│   │   ├── auth/                   # 认证（login / me / change-password）
│   │   ├── users/                  # 用户/账户管理
│   │   ├── permissions/            # 细粒度权限系统（catalog / guard / decorator）
│   │   ├── realtime/               # WebSocket 实时广播（gateway / service / module）
│   │   ├── common/                 # 守卫、装饰器、拦截器、过滤器、日志、配置、安全
│   │   │   ├── config/             # 配置模块
│   │   │   ├── decorators/         # current-user / no-competition-scope / public
│   │   │   ├── filters/            # http-exception.filter（异常捕获 → 中文错误信息）
│   │   │   ├── guards/             # jwt-auth / competition-scope / must-change-password / ownership
│   │   │   ├── interceptors/       # logging / response
│   │   │   ├── logging/            # logger.config / operator.context / operator.middleware / sanitize
│   │   │   ├── security/           # login-throttle（登录限流）
│   │   │   └── validators/         # password.validator
│   │   ├── modules/                # 业务模块（见下方）
│   │   └── prisma/                 # PrismaService（含审计中间件 + 自动广播）
│   ├── prisma/
│   │   ├── schema.prisma           # 数据模型（25 个模型）
│   │   └── seed.ts                 # 默认超管种子
│   ├── logs/                       # 日志输出（gitignore）
│   └── package.json
├── client/                         # Electron + Vue 3 客户端
│   ├── electron/                   # 主进程（main.ts / preload.ts / utils）
│   └── src/
│       ├── api/                    # HTTP 层（request.ts / cache.ts / index.ts）
│       ├── config/                 # 配置（DEFAULT_SERVER_URL / dataModules.ts）
│       ├── stores/                 # Pinia 状态（auth / config / competition / version / announcement / message）
│       ├── router/                 # Vue Router（Hash 模式，23 条路由）
│       ├── views/                  # 页面（登录、仪表盘、数据管理、比赛、公司、区域、消息、股票、设置）
│       ├── components/             # 复用组件（layout / common / dashboard / contracts / 公告 / 版本 / 消息弹窗）
│       ├── realtime/               # WebSocket 客户端（socket.ts / resource-changed.ts / useResourceChanged.ts）
│       ├── permissions/            # 权限目录（前端镜像副本）
│       ├── composables/            # 组合式函数（useCompetitionReload / useDashboardFields）
│       ├── types/                  # 类型定义（dashboard.ts）
│       ├── utils/                  # 工具函数（accountStorage / expressionEval / safe-math / deleteConfirm）
│       ├── data/                   # 静态数据（announcement / version）
│       └── assets/                 # 样式、logo
├── docs/                           # 文档
│   ├── 软件文档.md                  # 完整软件文档（设计、接口、权限、模块细节）
│   ├── 系统架构图.md                # 系统架构图（10 个维度）
│   ├── 设计文档.md                  # 系统设计与核心数据流
│   ├── 权限分级与重构设计.md         # 权限分级模型、角色模板与重构方案
│   ├── 数据同步与实时机制重构设计.md  # 本地存储隔离、增量同步、实时推送与刷新机制重构方案
│   ├── 前端刷新机制重构设计.md        # 前端界面刷新机制专项重构方案（事件精确匹配/memo 竞态/对账通知）
│   ├── 股票系统优化设计.md            # 股票系统优化（定价公式/做市商/干预机制/参数配置）
│   └── 自定义控件开发指南.md         # 仪表盘自定义控件开发指南
├── tools/                          # 辅助脚本
│   ├── build.bat                   # 构建服务端 + 客户端
│   ├── package.bat                 # 打包 Windows 安装包（NSIS）
│   ├── start_server.bat            # 启动服务端（dev）
│   ├── start_client.bat            # 启动客户端（dev）
│   ├── install_deps.bat            # 安装依赖
│   ├── logsreader/                 # 服务端日志可视化读取工具（本地 HTTP）
│   └── updater/                    # 本地发布页与版本改写脚本
└── LICENSE
```

### 服务端业务模块（`src/modules/`，15 个模块）

| 模块 | 路径 | 说明 |
|------|------|------|
| competitions | `/competitions` | 比赛与财年（租户根，删除级联） |
| materials / parts / products | `/materials` `/parts` `/products` | 生产链：原料→零件→产品（含配比与科技需求） |
| tech-tree | `/tech-nodes` | 科技树（DAG 前置依赖） |
| maps | `/maps` `/map-node-types` `/path-types` `/map-nodes` `/map-edges` | 地图节点/路径/连线（含地图背景图） |
| infrastructures | `/infrastructures` | 基建（10 项属性） |
| fuels / vehicles | `/fuels` `/vehicles` | 燃料与载具 |
| warehouses / production-lines | `/warehouses` `/production-lines` | 仓库与生产线 |
| companies / company-fields | `/companies` `/company-fields` | 公司及其产业字段读写 |
| industry-types | `/industry-types` | 产业类型（用户自定义 CRUD） |
| contracts | `/contract-types` `/contracts` | 合同类型 + 合同实例 + 合同引擎 |
| regions | `/regions` | 区域管理 + 区域总览卡片配置 |
| consumer-demands | `/consumer-demands` | 消费者需求（按区域记录的产品需求） |
| messages | `/messages` | 消息中心（发布/收件箱/图片上传） |
| stock | `/stocks` | 股票系统（股票/资金账户/订单/持仓/K线/推进轮次） |
| files | `/files` | 文件服务（地图背景图上传/删除/变换） |

## 环境要求

- Node.js 18+（推荐 20 LTS）
- npm（随 Node 安装）
- 操作系统：Windows / macOS / Linux（服务端为跨平台 Node 应用）

## 快速开始（开发模式）

```bash
# 1. 安装依赖（分别安装服务端、客户端）
cd server   && npm install
cd ../client && npm install

# 2. 配置环境变量
cd ../server
cp .env.example .env   # 复制模板（Windows 用 copy .env.example .env）
# 编辑 .env，至少确认 JWT_SECRET 已设置（开发环境可用模板默认值）

# 3. 初始化数据库（建表 + 创建默认超级管理员）
npx prisma db push
npx prisma db seed

# 4. 启动服务端（开发热重载，默认 3000 端口）
npm run start:dev

# 5. 启动客户端（Vite + Electron 开发模式，另开一个终端）
cd ../client
npm run dev
```

也可直接双击 `tools/start_server.bat` / `tools/start_client.bat` 分别启动前后端。

## 默认管理员

- 用户名：`admin`
- 密码：`admin123`
- 角色：`SUPER_ADMIN`

> 首次登录后**必须修改密码**（系统会强制拦截直到改密完成）。

### 首次使用流程

1. 用 `admin / admin123` 登录，系统强制改密。
2. 进入「比赛管理」创建一场比赛。
3. 选择该比赛后，在「数据管理」中录入原料、零件、产品、科技树、地图、燃料、载具、仓库、生产线、基建等基础数据。
4. 在「产业类型」中配置产业类型及其字段（支持计算字段、财年定时器）。
5. 在「公司管理」中创建参赛公司，并维护其产业字段。
6. 在「账户管理」中创建管理员/选手账号，配置权限与公司范围。

## 构建安装包

以管理员身份运行 `tools/package.bat`（Windows），会自动使用国内 npmmirror 镜像构建客户端并生成 NSIS 安装包，输出至 `client/release/`，形如 `Gipfel商赛系统 Setup x.x.x.exe`（安装时可选择安装位置）。

> 若遇到符号链接/解压权限问题，请右键 `tools/package.bat` → 「以管理员身份运行」。

## 版本与发版

版本号存在两处真源：`client/package.json`（`app.getVersion()`）与 `server/package.json`（`GET /api/version`）。发版由 `tools/updater/release-core.mjs` 统一改写两处 `version`，确保二者一致。

客户端启动时校验版本一致性，不一致时**硬封锁全部功能**并弹出不可关闭的提示，每 5 分钟周期复核。

## 安全说明

- **认证**：JWT（24h 有效期，issuer/audience 绑定）+ 单设备登录互斥（tokenVersion 自增，新设备登录顶掉旧设备）+ 强制改密
- **授权**：RBAC 细粒度权限（31 个权限 key，18 个域）+ 5 个范围约束字段（permissions / companyScopes / viewCompanyScopes / contractViewCompanyScopes / stockCompanyScopes）
- **多租户隔离**：`CompetitionScopeGuard` 自动注入/校验 `competitionId`；归属比赛的账号自动锁定所属比赛
- **资源归属**：`OwnershipGuard` BOLA 防御，校验实体归属
- **传输安全**：CSP（default-src 'none'）/ X-Frame-Options: DENY / CORP / CORS 白名单（仅本地/内网来源反射）
- **输入校验**：`ValidationPipe` 白名单 + 类型转换，5xx 异常不透出细节
- **登录限流**：IP+用户名维度，10 次/5 分钟 → 锁定 15 分钟（仅计失败）
- **审计日志**：Prisma `$allOperations` 写操作记录 before/after/changes，密码/令牌脱敏
- **WebSocket 安全**：JWT 握手鉴权，房间归属校验，强制改密用户禁止连接

详见 [`docs/软件文档.md`](docs/软件文档.md)「认证与权限模型」章节。

## 许可证

办赛辅助工具，许可证以仓库配置为准。
