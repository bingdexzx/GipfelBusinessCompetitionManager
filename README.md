# Gipfel 商赛办赛辅助系统

商业模拟竞赛（商赛）的办赛方数据管理桌面应用。办赛方通过本系统维护竞赛所需的全量标准化数据、配置比赛参数，并通过配置驱动的合同引擎与可视化编辑能力高效运作赛事。

当前版本：`1.3.16`

---

## 核心功能

- **比赛与财年管理**：创建比赛（租户根），开/关财年；所有业务数据按 `competitionId` 完全隔离（多租户）
- **基础数据管理**：原料（含按地点定价）、零件（含原料配比与科技要求）、产品（含零件配比与科技要求）、科技树（DAG 前置依赖）、地图（节点类型 / 路径类型 / 节点 / 连线 + 背景图上传）、基建（10 项属性）、燃料、载具（含路径类型适配）、仓库、生产线
- **产业系统**：产业类型模板（字段 STRING / NUMBER / BOOLEAN / DICTIONARY / LIST，支持计算字段图引擎与财年定时器字段）、公司实例、公司产业字段值（乐观锁 version 防并发覆盖）
- **合同系统**：配置驱动的合同类型模板（2~3 方参与、输入参数 schema、效果 effects 数组、前置条件 conditions、可视化图编辑器）+ 执行引擎（仅改写公司产业字段），合同生命周期 DRAFT → PENDING_EXEC → EXECUTED → TERMINATED，字段改写记录 ContractFieldEffect 支持合同删除时精确撤销（不影响后续已执行合同）
- **区域总览**：按区域分组公司 + 自定义总览卡片（绑定产业字段）、消费者需求（按区域记录产品需求数量）
- **消息中心**：站内消息发布（全体 / 指定收件人、支持图片附件）、收件箱未读状态、在线实时弹窗推送
- **股票系统**：模拟股票交易——每轮玩家下单（买入 / 卖出委托），高级管理点「下一轮」后系统撮合→按定价公式算新价→生成 K 线；支持 PE 联动（取某公司产业字段实时值）/ 随机（每轮 ±2 游走）两种模式、碳排/幸福度绑定区域总览字段实时值、低级管理（管所选公司 + 自己账户）/ 高级管理（全部权限）分级
- **仪表盘**：可自定义控件（文字 / 仪表 / 表格 / 自定义 Vue 组件），支持字段绑定与拖拽布局
- **账户与权限管理**：三角色（SUPER_ADMIN / COMPETITION_ADMIN / PLAYER）+ 31 个细粒度权限 key（18 个域，动作等级蕴含：manage ⊇ execute ⊇ audit ⊇ edit ⊇ view）+ 5 个范围约束字段（permissions / companyScopes / viewCompanyScopes / contractViewCompanyScopes / stockCompanyScopes）
- **认证授权**：JWT 令牌（24h 有效期，issuer/audience 双声明绑定）+ 单设备登录互斥（tokenVersion 自增顶号）+ 首次登录强制改密
- **实时广播**：基于 Socket.IO（复用 HTTP 端口）的通用广播基建，按比赛房间 `comp-{id}` 广播资源变更 + 用户私有房间 `user-{id}` 定向推送；支持断线重连时补发 `sync:replay`
- **本地缓存与增量同步**：IndexedDB 按账号（realm = `{username}@{competitionId}`）分库，全量副本 + 增量基线 + 断线重连对账
- **版本一致性硬封锁**：客户端 Electron `app.getVersion()` 与服务端 `GET /api/version` 不一致时锁定全部功能并弹出不可关闭提示，每 5 分钟复核
- **更新公告**：每次发版后首次启动弹窗展示公告，确认后不再自动弹出

> 完整设计、接口、权限与模块细节见 [`docs/软件文档.md`](docs/软件文档.md)。
> 系统架构图见 [`docs/系统架构图.md`](docs/系统架构图.md)。
> 权限分级与重构设计见 [`docs/权限分级与重构设计.md`](docs/权限分级与重构设计.md)。
> 数据同步与实时刷新重构设计见 [`docs/数据同步与实时刷新重构设计.md`](docs/数据同步与实时刷新重构设计.md)。
> 股票系统优化设计见 [`docs/股票系统优化设计.md`](docs/股票系统优化设计.md)。
> 后端重构设计见 [`docs/后端重构设计.md`](docs/后端重构设计.md)。
> 合同与字段表达式引擎重设计见 [`docs/合同与字段表达式引擎重设计.md`](docs/合同与字段表达式引擎重设计.md)。
> 重构方案总纲见 [`docs/重构方案.md`](docs/重构方案.md)。
> 仪表盘自定义控件开发指南见 [`docs/自定义控件开发指南.md`](docs/自定义控件开发指南.md)。
> 重构进度跟踪见 [`docs/重构进度报告.md`](docs/重构进度报告.md)。

---

## 技术架构

| 层 | 技术栈 |
| -- | ------ |
| 客户端 | Electron 33 + Vue 3.4 + TypeScript + Element Plus 2.7（zh-cn 语言包）+ Pinia 4 + Vue Router 5（Hash 模式）+ Axios + Vite 7 + Socket.IO Client 4 + vue-konva（地图画布）+ ECharts 6（K 线 / 仪表盘 / 科技树）+ pinyin-pro |
| 服务端 | NestJS 11 + Prisma 6 + SQLite + @nestjs/jwt + Passport-JWT + @nestjs/websockets + Socket.IO 4 + Nest-Winston + winston-daily-rotate-file + bcryptjs（密码哈希）+ mathjs（表达式求值）+ zod + class-validator + class-transformer |
| 数据库 | SQLite（Prisma ORM，单文件 `server/prisma/dev.db`，34 个数据模型） |
| 共享包 | `shared/engine-dsl` —— 表达式引擎 DSL（前后端共用，前端直接吃 TS 源码无需预构建） |
| 发版工具 | `tools/updater/`（本地 HTTP 发布页 + release-core.mjs 统一改写版本号） |
| 部署工具 | `tools/update_server.bat`（服务器一键更新：拉代码 / 装依赖 / 编译 / 迁移 / 重启） |
| 测试框架 | 后端：Jest（单元 + e2e）；服务端已有用例：`catalog.spec.ts` / `role-templates.spec.ts` / `company-fields.service.spec.ts` / `industry-calc-engine.service.spec.ts` / `safe-expression.spec.ts` / `engine.spec.ts`（股票引擎）/ `json-schema.spec.ts` |

服务端默认监听 `http://localhost:3000`，Socket.IO 与 REST **复用同一端口**（同源）；静态资源 `/uploads`（地图背景图 / 消息图片）由 Express `express.static` 托管，并放松 CORP 为 cross-origin 以便 Electron 渲染进程跨源加载。

### HTTP 请求处理管线

```
HTTP Request
  → OperatorMiddleware (从 JWT 解析操作员 → AsyncLocalStorage 注入日志上下文)
  → securityHeaders (CSP: default-src 'none' / X-Frame-Options: DENY / X-Content-Type-Options: nosniff / Referrer-Policy: no-referrer / /uploads 路径 CORP: cross-origin 其余 same-origin)
  → loginRateLimiter (POST /api/auth/login：IP+用户名 锁定 15 分钟，仅计失败)
  → CORS（未配置 CORS_ORIGIN 时：仅 localhost / 回环 / RFC1918 私网 / file:// / app:// 反射放行并带凭据；公网来源一律拒绝。配置白名单时严格命中。）
  → ValidationPipe (class-validator：whitelist + forbidNonWhitelisted + transform)
  → JwtAuthGuard (@nestjs/jwt + passport-jwt，校验 issuer/audience；tokenVersion 不一致即失效)
  → MustChangePasswordGuard (mustChangePassword=true 时除改密接口外全部拦截)
  → CompetitionScopeGuard (多租户比赛隔离：非 SUPER_ADMIN 自动注入/校验 competitionId；@NoCompetitionScope() 可跳过)
  → OwnershipGuard (资源归属校验，BOLA 防御：基于实体 → competitionId 路径匹配)
  → PermissionsGuard (RBAC：@RequirePermissions 注解 + 动作等级蕴含 + 范围字段二次校验)
  → Controller → Service → PrismaService ($allOperations 中间件 → 写操作审计日志 + 实时广播)
  → ResponseInterceptor ({ code:0, message:"成功", data } 统一包装)
  → LoggingInterceptor (请求访问日志)
  → HttpExceptionFilter (异常捕获 → 脱敏中文错误信息 + 异常上下文落 AuditLog)
```

---

## 目录结构

```
.
├── server/                                    # NestJS 服务端（REST API + 实时广播 + 日志审计）
│   ├── src/
│   │   ├── main.ts                            # 启动入口：全局管线注册、默认超管自举、静态资源挂载
│   │   ├── app.module.ts                      # 根模块：24 个子模块 + 5 个全局守卫（JWT → 改密 → 比赛域 → 所有权 → RBAC）
│   │   ├── health.controller.ts               # GET /api/health 健康检查（无鉴权）
│   │   ├── version.controller.ts              # GET /api/version 版本号（用于客户端硬封锁比对）
│   │   ├── auth/                              # 认证模块：login / me / change-password，JWT 策略
│   │   │   ├── strategies/jwt.strategy.ts
│   │   │   └── dto/
│   │   ├── users/                             # 用户/账户 CRUD（增删改查 + 权限授予）
│   │   ├── permissions/                       # 权限系统：catalog（目录）/ guard（守卫）/ decorator（注解）/ role-templates（角色模板与授予上限）
│   │   ├── realtime/                          # WebSocket 实时广播：gateway（鉴权+房间）/ service（广播+补发）
│   │   ├── prisma/                            # PrismaService：含 $allOperations 审计中间件 + 实时广播触发
│   │   ├── common/                            # 横切基础设施
│   │   │   ├── config/                        # ConfigModule + ConfigService（读取 .env）
│   │   │   ├── decorators/                    # @CurrentUser / @NoCompetitionScope / @Public / @RequirePermissions
│   │   │   ├── filters/                       # HttpExceptionFilter（异常脱敏 + 审计）
│   │   │   ├── guards/                        # 5 个守卫：jwt-auth / must-change-password / competition-scope / ownership / permissions.guard
│   │   │   ├── interceptors/                  # response（统一包装）/ logging（访问日志）
│   │   │   ├── logging/                       # Winston 配置 + OperatorMiddleware + AsyncLocalStorage + 审计写入 + 脱敏工具
│   │   │   ├── security/                      # login-throttle.ts（登录限流器）
│   │   │   ├── validators/                    # password.validator（密码强度）/ json-schema.ts
│   │   │   ├── types/                         # delete-impact.ts（删除影响分析）
│   │   │   ├── exceptions/                    # field-write-conflict（乐观锁冲突）
│   │   │   ├── safe-expression.ts             # 安全表达式求值（mathjs 沙箱）+ 单元测试
│   │   │   ├── scope.ts / sync.ts             # 比赛域工具 / 同步工具
│   │   │   ├── engine-ops.ts / field-ref-cleanup.ts / json.util.ts
│   │   └── modules/                           # 15 个业务模块（见下表）
│   ├── prisma/
│   │   ├── schema.prisma                      # 数据模型：34 个模型（见 §数据模型）
│   │   └── seed.ts                            # 默认超管种子（与 main.ts 自举逻辑一致）
│   ├── test/app.e2e-spec.ts                   # e2e 测试入口
│   ├── logs/                                  # 日志输出（DailyRotateFile，gitignore）
│   ├── .env.example                           # 环境变量模板
│   ├── jest.config.ts / jest.e2e.config.ts
│   └── package.json
│
├── client/                                    # Electron + Vue 3 桌面客户端
│   ├── electron/                              # 主进程
│   │   ├── main.ts                            # Electron 主入口（BrowserWindow + preload）
│   │   ├── preload.ts                         # 预加载脚本（contextBridge 暴露安全 API）
│   │   └── utils/store.ts                     # 持久化配置存储
│   ├── build/                                 # 安装包图标（icon.ico / icns / png）
│   ├── public/app-icon.png
│   └── src/
│       ├── main.ts                            # Vue 入口：ElementPlus(zh-cn) + Pinia + Router + vue-konva；挂载前执行账号存储迁移 + 清理旧 DB
│       ├── App.vue
│       ├── api/                               # HTTP 层
│       │   ├── request.ts                     # Axios 实例（拦截器：JWT 注入 / 401 登出 / 错误提示 / 版本比对）
│       │   ├── cache.ts                       # IndexedDB 缓存层（Dexie 封装，realm 分库）+ 增量同步
│       │   └── index.ts                       # 全部 API 调用封装（按模块聚合）
│       ├── stores/                            # Pinia：auth / competition / config / version / announcement / message
│       ├── router/index.ts                    # 23 条路由（Hash 模式，meta: requiresPermission + managePermission）
│       ├── views/                             # 12 类页面
│       │   ├── login/                         # 登录页（含强制改密对话框）
│       │   ├── dashboard/                     # 仪表盘（自定义控件 + 拖拽布局）
│       │   ├── data-management/               # 数据管理通用页 + 各分类 Manager：原料 / 零件 / 产品 / 地图 / 基建 / 科技树 / 燃料 / 载具 / 仓库 / 生产线 / 产业类型 / 合同类型 / 合同
│       │   ├── companies/                     # 公司列表 + 公司详情（产业字段读写）
│       │   ├── competitions/                  # 比赛管理（仅 SUPER_ADMIN）
│       │   ├── regions/                       # 区域总览（卡片配置 + 消费者需求）
│       │   ├── messages/                      # 消息中心（收件箱 + 发布）
│       │   ├── stocks/ StockManageView.vue    # 股票行情 + 股票管理（推进轮次等）
│       │   ├── account-management/            # 账户管理（仅 SUPER_ADMIN）
│       │   └── settings/                      # 系统设置
│       ├── components/
│       │   ├── layout/                        # AppLayout + Sidebar + TopBar
│       │   ├── common/DataManager.vue         # 通用 CRUD 表格组件（支撑 11 类基础数据）
│       │   ├── dashboard/                     # 仪表盘控件框架 + registerCustomWidgets（注册入口）
│       │   ├── contracts/                     # 合同编辑器（ContractTypeGraphEditor 可视化图 + SimpleContractTypeEditor 简易模式 + FormulaBuilder + TrialCalculator）
│       │   ├── industry-types/IndustryFieldGraphEditor.vue  # 产业字段计算图编辑器
│       │   ├── formula-panel/FormulaPanel.vue
│       │   ├── AnnouncementDialog.vue + AnnouncementHistoryDialog.vue + VersionUpdateDialog.vue + MessageToastHost.vue
│       ├── realtime/                          # socket.io-client + resource-changed 事件分发 + useResourceChanged 组合式
│       ├── permissions/catalog.ts             # 权限目录前端镜像（与后端 server/src/permissions/catalog.ts 同构）
│       ├── composables/                       # useCompetitionReload / useDashboardFields / useGraphViewport
│       ├── utils/                             # accountStorage（账号命名空间迁移）/ expressionEval / safe-math / realm / pinyin / deleteConfirm
│       ├── config/                            # index.ts（DEFAULT_SERVER_URL 等）/ dataModules.ts（11 类基础数据配置）
│       ├── data/                              # announcement.ts（更新公告）/ version.ts（版本号）
│       ├── types/dashboard.ts
│       └── assets/                            # global.scss + variables.scss + logo
│
├── shared/engine-dsl/                         # 表达式引擎共享包（前后端共用，无需预构建，前端 vite.config.ts 直接 @ 别名吃 TS 源码）
│   └── src/index.ts / schema.ts
│
├── docs/                                      # 10 份文档（见文首链接列表）
│
├── tools/                                     # 辅助脚本
│   ├── install_deps.bat                       # 一键安装 server + client + shared 依赖
│   ├── start_server.bat                       # 启动服务端（dev 热重载）
│   ├── start_client.bat                       # 启动客户端（Vite + Electron dev）
│   ├── build.bat                              # 构建服务端 + 客户端
│   ├── package.bat                            # 打包 Windows NSIS 安装包（输出 client/release/）
│   ├── update_server.bat                      # 服务器远程一键更新（git pull / npm ci / 构建 / prisma migrate / pm2 重启）
│   ├── logsreader/                            # 服务端日志可视化读取工具（本地 node HTTP）
│   └── updater/                               # 本地发布页 + release-core.mjs / release.mjs 发版脚本
│
├── .github/workflows/build.yml                # CI：构建 & 测试
├── .gitignore
└── LICENSE
```

### 服务端业务模块（`src/modules/`，15 个模块 + 对应 REST 前缀）

| 模块目录 | Controller 前缀 | 功能说明 |
|----------|-----------------|----------|
| `competitions/` | `/api/competitions`、`/api/fiscal-years` | 比赛与财年（租户根；删除比赛级联删除所有子资源；财年切换触发 IndustryField 定时器） |
| `materials/` | `/api/materials` | 原料（名称 / 产地 / 碳排系数 / 按地点 nodePrices / 类型） |
| `parts/` | `/api/parts` | 零件（→ PartMaterial 原料配比 + PartTechRequirement 科技前置） |
| `products/` | `/api/products` | 产品（→ ProductPart 零件配比 + ProductTechRequirement 科技前置 + ConsumerDemand） |
| `tech-tree/` | `/api/tech-nodes`、`/api/tech-prerequisites` | 科技树节点（DAG 前置依赖 TechPrerequisite） |
| `maps/` | `/api/maps`（综合）`/map-node-types` `/path-types` `/map-nodes` `/map-edges` | 地图：节点类型 / 路径类型 / 节点（x,y 坐标）/ 连线（distance）；Competition.mapBackground 背景图上传 |
| `infrastructures/` | `/api/infrastructures` | 基建（占地 / 就业率 / 人口 / 高素质人口 / 价格 / 幸福度 / 人均收入 / 碳减 / 激活价，共 10 项） |
| `fuels/` | `/api/fuels` | 燃料（元/升） |
| `vehicles/` | `/api/vehicles` | 载具（油耗 L/km / 最大载重 / 价格 / 碳排；→ VehiclePathType 适配的路径类型） |
| `warehouses/` | `/api/warehouses` | 仓库（容量 / 价格 / 类型 MATERIAL\|PART\|PRODUCT） |
| `production-lines/` | `/api/production-lines` | 生产线（价格 / 用工数 / 年最大产能） |
| `industry-types/` | `/api/industry-types`、`/api/industry-fields` | 产业类型 + 产业字段（5 种类型 + 计算字段图 GGraph + 财年定时器 FY_START/FY_END）；IndustryCalcEngine 级联重算 |
| `companies/` + `company-fields/` | `/api/companies`、`/api/company-fields` | 公司 CRUD + 产业字段值读写（CompanyFieldValue 乐观锁 version；写入时自动触发 IndustryCalcEngine 级联） |
| `contracts/` | `/api/contract-types`、`/api/contracts` | 合同类型 CRUD + 合同实例 CRUD + ContractEngineService（条件校验 → 效果执行 → 记录 ContractFieldEffect → 可撤销） |
| `regions/` | `/api/regions` | 区域管理（overviewCards JSON 配置总览卡片） |
| `consumer-demands/` | `/api/consumer-demands` | 消费者需求（按区域 + 产品记录 quantity） |
| `messages/` | `/api/messages`、`/api/message-attachments` | 消息中心（发布 / 收件箱 / 未读标记 / 图片上传 & 清理） |
| `stock/` | `/api/stocks` | 股票系统（股票 / 资金账户 / 持仓 / 订单 / K 线 / 推进轮次 → engine.ts 撮合 + 定价） |
| `files/` | `/api/files/upload`、`/api/files/map-background` | 文件服务（图片上传 → `/uploads/*`；地图背景图裁剪变换） |

> 注：`AuthModule`、`UsersModule`、`ConfigModule`、`PrismaModule`、`PermissionsController`、`RealtimeModule` 不属 `modules/` 目录，位于 `src/` 根下。

---

## 数据模型（server/prisma/schema.prisma，34 个模型）

| 分类 | 模型 | 核心字段 / 说明 |
|------|------|-----------------|
| **用户与权限** | `User` | id, username(唯一), passwordHash(bcrypt), role(SUPER_ADMIN\|COMPETITION_ADMIN\|PLAYER), competitionId, permissions(JSON), companyScopes(JSON), viewCompanyScopes(JSON), contractViewCompanyScopes(JSON), stockCompanyScopes(JSON), mustChangePassword, tokenVersion(单设备互斥) |
| | `AuditLog` | 写操作(kind=write) + 异常(kind=error)；operatorId / action: `<Model>:<op>` / model / recordId / changes(JSON 脱敏) / statusCode / errorSummary / ip / requestId |
| **比赛 & 财年** | `Competition` | name(唯一), status, mapBackground(JSON {url,filename,w,h}), stockConfig(JSON)；关联所有比赛级资源（级联删除） |
| | `FiscalYear` | competitionId+year 唯一，status(ACTIVE\|CLOSED)；切换触发 IndustryField.timerEnabled 字段 |
| **生产链主数据** | `Material` (原料) | name+competitionId 唯一；nodePrices(JSON `{mapNodeId:价格}`)；type=NORMAL\|SPECIAL |
| | `Part` (零件) + `PartMaterial` + `PartTechRequirement` | 原料配比 + 科技前置 |
| | `Product` (产品) + `ProductPart` + `ProductTechRequirement` | 零件配比 + 科技前置 |
| | `TechNode` + `TechPrerequisite` | 科技节点（层级 / 研发成本）+ DAG 前置（自关联） |
| **地图与物流** | `MapNodeType` / `PathType` | 节点类型（颜色）/ 路径类型（颜色） |
| | `MapNode` + `MapEdge` | 节点（x,y 坐标 + region + nodeTypeId）；边（from→to, distance, pathTypeId）fromNodeId+toNodeId 唯一 |
| | `Fuel` / `Vehicle` + `VehiclePathType` | 燃料（元/升）；载具（油耗 / 载重 / 价格 / 碳排 / 适配路径类型） |
| | `Infrastructure` | 10 项属性：footprint, employmentRateBonus, populationBonus, highQualityPopulationBonus, price, happinessIndexBonus, perCapitaIncomeBonus, carbonReductionBonus, activationPrice |
| | `Warehouse` / `ProductionLine` | 仓库（容量 / 价格 / 类型）；生产线（价格 / 用工 / 年产能） |
| **产业系统** | `IndustryType` + `IndustryField` | 产业类型（code 唯一）；产业字段：fieldType(STRING/NUMBER/BOOLEAN/DICTIONARY/LIST), config(JSON), isCalculated+calcGraph(GGraph), visible, timerEnabled+timerTrigger(FY_START\|FY_END)+timerValue, sortOrder |
| | `Region` | name+competitionId 唯一；overviewCards(JSON `[{id,displayName,companyId,industryFieldId}]`) |
| | `Company` + `CompanyFieldValue` | 公司（industryTypeId, regionId, status）；公司字段值（version 乐观锁，@@unique([companyId, industryFieldId])） |
| | `ConsumerDemand` | competitionId+region+productId，quantity, note |
| **合同系统** | `ContractType` | key(唯一), partyCount(2\|3), partyRoles(JSON), inputSchema(JSON), effects(JSON 数组), conditions(JSON 数组), graph(JSON 可视化图), enabled, schemaVersion |
| | `Contract` + `ContractFieldEffect` | 合同实例（parties(JSON), inputs, status=DRAFT\|PENDING_EXEC\|EXECUTED\|TERMINATED, executionLog, executionResult）；叶子效果记录（op=ADD\|SUB\|SET, valueRaw/beforeRaw/afterRaw JSON）→ 用于合同删除时撤销 |
| **消息中心** | `Message` + `MessageRecipient` | 消息（title, content, senderId, competitionId, targetsAll, targetUserIds(JSON), images(JSON)）；收件人（userId, read, readAt）@@unique([messageId, userId]) |
| **股票系统** | `Stock` | code+competitionId 唯一；基础字段：totalShares/initNetProfit/industryPE/currentCarbon/industryAvgCarbon/happiness；绑定引用：carbonFieldRef/happinessFieldRef/industryAvgCarbonRefs；PE 模式：pbCompanyId+pbFieldId(联动) 或 pbRandom(0~20 ±2 游走)；运行时：initPrice/currentPrice/round |
| | `StockFundsAccount` | ownerType(COMPANY\|USER) + companyId/userId；cashBalance；bindFieldId（绑定产业字段同步）；name+competitionId 唯一 |
| | `StockHolding` | @@unique([fundsAccountId, stockId])：shares + costPrice |
| | `StockOrder` | side(BUY\|SELL), price, quantity, amount, status(PENDING\|FILLED\|CANCELLED), round；索引 [competitionId,stockId,round,status] |
| | `StockCandle` | @@unique([stockId, round])：open/high/low/close/changePct |

---

## 环境要求

- **Node.js ≥ 18**（推荐 20 LTS）
- npm ≥ 9（随 Node 安装）
- 操作系统：Windows 10+ / macOS 11+ / Linux（x64 / arm64 均可，Electron 打包脚本已覆盖三平台）
- 磁盘空间：开发态依赖安装约 2 GB；SQLite 数据库单文件、按需增长

---

## 快速开始（开发模式）

```bash
# 1. 安装依赖（三处：shared / server / client）
# 方式 A：使用一键脚本（Windows）
tools\install_deps.bat

# 方式 B：手动
cd shared/engine-dsl && npm install
cd ../../server && npm install
cd ../client && npm install

# 2. 配置服务端环境变量
cd server
# Windows (PowerShell):  Copy-Item .env.example .env
# Windows (CMD):        copy .env.example .env
# Linux/macOS:          cp .env.example .env
# 编辑 .env：
#   - 【必填】JWT_SECRET：开发环境可用模板值，生产环境务必用 `openssl rand -hex 32` 生成强随机值
#   - 其它项（PORT、DATABASE_URL、JWT_EXPIRES_IN、CORS_ORIGIN、LOG_LEVEL 等）可留默认

# 3. 初始化 SQLite 数据库（建表）
npx prisma db push
# 首次启动服务端时会在 bootstrap() 中自动创建默认超管，无需手动 seed

# 4. 启动服务端（开发热重载，默认 http://localhost:3000）
npm run start:dev
# 或双击 tools\start_server.bat

# 5. 启动客户端（另开一个终端：Vite dev server + Electron 窗口）
cd ../client
npm run dev
# 或双击 tools\start_client.bat
```

启动成功后会弹出 Electron 桌面窗口，默认连接 `http://localhost:3000`。可在客户端「系统设置」中修改服务端地址（Electron Store 持久化）。

### 默认管理员

| 项目 | 值 |
|------|----|
| 用户名 | `admin` |
| 密码 | `admin123` |
| 角色 | `SUPER_ADMIN`（隐式拥有全部权限） |

> **强制改密**：首次登录后系统会弹出改密对话框并锁定其它所有操作，直到密码被成功修改。

### 首次使用标准流程

1. 用 `admin / admin123` 登录 → 按提示修改初始密码。
2. 进入「比赛管理」（仅 SUPER_ADMIN 可见）→ **创建一场新比赛**。
3. 顶部比赛选择器中选择刚创建的比赛 → 进入比赛上下文。
4. 「数据管理」分组中逐项录入基础数据：
   - 原料管理（含按地点定价 `nodePrices`）
   - 零件管理（关联原料配比 + 科技前置）
   - 产品管理（关联零件配比 + 科技前置）
   - 科技树管理（DAG 节点 + 前置依赖）
   - 地图管理（节点类型 / 路径类型 / 节点坐标 / 连线；可上传整张地图背景图）
   - 燃料 / 载具 / 仓库 / 生产线 / 基建
5. 「产业类型管理」→ 创建产业类型 → 配置产业字段（STRING/NUMBER/BOOLEAN/DICTIONARY/LIST，可选计算图或财年定时器）。
6. 「公司管理」→ 创建参赛公司，分配产业类型与区域，维护初始产业字段值。
7. 「区域总览」→ 配置区域及其总览卡片（绑定公司产业字段，选手 / 管理员可见）。
8. 「合同类型管理」→ 配置合同类型模板（参与方 / 输入参数 / 条件 / 效果，支持可视化图编辑器或简易模式）。
9. （可选）「股票管理」→ 创建股票、资金账户、绑定产业字段联动 PE / 碳排 / 幸福度。
10. 「账户管理」→ 创建 COMPETITION_ADMIN（比赛管理员）/ PLAYER（选手）账号，分配权限与公司范围、审核范围、查看范围、股票管理范围。
11. 「消息中心」→ 发布欢迎公告或定向通知。

---

## 构建与打包

### 构建产物（不打包安装包）

```bash
tools\build.bat
# 等价于：
#   cd shared/engine-dsl && tsc -p tsconfig.json
#   cd server && npm run build        # → server/dist/
#   cd client && npm run build        # → client/dist/ + client/dist-electron/
```

### 打包 Windows 桌面安装包（NSIS）

```bash
# 以管理员身份运行（避免符号链接 / 解压权限问题）
tools\package.bat

# 产物：client\release\Gipfel商赛系统 1.3.16-win-x64.exe 等
# 支持 x64 / ia32 双架构；安装时用户可自选安装目录
```

跨平台打包（需在对应操作系统执行）：

```bash
# macOS（生成 x64 + arm64 的 .dmg）
cd client && npm run electron:build

# Linux（生成 .AppImage + .deb，x64 + arm64）
cd client && npm run electron:build:linux
```

---

## 服务端部署（生产环境）

推荐：Node.js ≥ 20 LTS + PM2 进程守护 + SQLite。

```bash
# 0. 准备配置（首次）
cd server
cp .env.example .env
# 修改：
#   JWT_SECRET=强随机值
#   JWT_EXPIRES_IN=24h （按需调整）
#   CORS_ORIGIN=*                       # 桌面客户端可留默认（仅本地/私网反射，公网一律拒绝）
#   CORS_ORIGIN=https://your-web.com    # 若同时有 Web 前端访问，必须显式加入白名单

# 1. 初始化 / 迁移数据库
npm ci
npx prisma db push

# 2. 构建
npm run build

# 3. 启动（PM2）
npm install -g pm2
pm2 start dist/main.js --name gipfel-server --time
pm2 save
pm2 startup          # 开机自启（按 PM2 提示执行输出命令）
```

**服务器一键更新**（代码 & DB 变更后）：在服务器项目根目录执行

```bash
tools\update_server.bat
# 内含：git pull → npm ci → shared tsc → server build → prisma db push → pm2 restart
```

健康检查：`curl http://localhost:3000/api/health` → 200 OK。

---

## 版本与发版机制

版本号两处**真源**必须完全一致（硬封锁校验）：
- `client/package.json` → `version`（Electron 主进程 `app.getVersion()` 客户端读此）
- `server/package.json` → `version`（`GET /api/version` 客户端比对此）

**发版流程**（由 `tools/updater/` 完成）：
1. 编辑 `tools/updater/ui.mjs` 顶部的新版本号 + 更新公告文字（announcement）。
2. 双击 `tools/updater/run.bat` 打开本地发布页。
3. 点击「执行发版」→ 调用 `release-core.mjs` 同步改写两处 package.json、重写 `client/src/data/announcement.ts` 与 `client/src/data/version.ts`、生成 CHANGELOG。
4. CI / 人工执行 `tools/package.bat` 生成安装包、上传分发。

客户端启动时版本比对结果：
- ✅ 一致 → 正常进入。
- ❌ 不一致 → 弹出**不可关闭**的全屏提示（所有路由被导航守卫拦截回 `/login`），每 5 分钟自动轮询复核一次服务端 `/api/version`。

---

## 安全设计清单

| 维度 | 实现 | 代码位置 |
|------|------|----------|
| 认证 | JWT（HS256，issuer=`gipfel-competition`，audience=`gipfel-competition-client`，exp 默认 24h）；bcryptjs cost=12 哈希密码 | `auth/strategies/jwt.strategy.ts`、`main.ts L94` |
| 单设备互斥 | `User.tokenVersion`，每次成功登录自增；JWT 内携带 `tokenVersion` 校验，不一致即 401 顶号 | `auth/auth.service.ts`、`JwtStrategy.validate` |
| 强制改密 | `User.mustChangePassword` + `MustChangePasswordGuard`；首次登录默认超管该值=true，除改密接口外全部拦截 | `common/guards/must-change-password.guard.ts`、`main.ts` bootstrap |
| 登录限流 | `isLoginLocked(ip, username)`：失败累计（成功时清零），10 次 / 5 分钟 → 锁定 15 分钟，返回 429 | `common/security/login-throttle.ts`、`main.ts L49` |
| RBAC 细粒度权限 | 31 个权限 key 分 18 域；动作等级蕴含（rank 比较：持有更高等级动作即满足）；`@RequirePermissions()` 注解 | `permissions/catalog.ts` `hasPermission()`、`permissions.guard.ts` |
| 授予上限 | 角色模板 `grantCeiling` + `grantExtras`；非 SUPER_ADMIN 禁止写权限；`assertGrantAllowed` 校验 | `permissions/role-templates.ts` |
| 范围约束（5 字段） | permissions 权限列表；companyScopes（contract:audit 审核公司）；viewCompanyScopes（company:view 读范围）；contractViewCompanyScopes（contract:view 可见范围）；stockCompanyScopes（stock:edit 低级管理范围） | `User` 模型 5 个 JSON 字段 + `canReadCompanyAllFields()`、`companyListScopes()` 等 |
| 多租户隔离 | `CompetitionScopeGuard`：读自动 AND competitionId，写自动注入；非 SUPER_ADMIN 比赛归属锁死；`@NoCompetitionScope()` 标记例外路由 | `common/guards/competition-scope.guard.ts`、`common/decorators/no-competition-scope.decorator.ts` |
| 资源归属 (BOLA) | `OwnershipGuard`：基于实体 competitionId 反射路径匹配，禁止跨比赛读取实体 | `common/guards/ownership.guard.ts` |
| CORS 策略 | 默认：仅 localhost / 回环 / RFC1918 私网 / file:// / app:// 反射放行带凭据；公网一律拒绝。显式配置 `CORS_ORIGIN` 时严格白名单命中 | `main.ts` `isLocalOrPrivateOrigin()` + `app.enableCors()` |
| 安全响应头 | CSP `default-src 'none'`（彻底阻断脚本执行）+ `frame-ancestors 'none'`；XFO DENY；XCTO nosniff；Referrer-Policy no-referrer；CORP（/uploads 为 cross-origin 其余 same-origin） | `main.ts` `securityHeaders()` |
| 输入校验白名单 | `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` | `main.ts L157` |
| 异常脱敏 | `HttpExceptionFilter`：5xx 返回通用中文提示，不暴露堆栈；异常上下文入 AuditLog；密码/令牌等字段变更在审计 changes 中脱敏 | `common/filters/http-exception.filter.ts`、`common/logging/sanitize.ts`、`common/logging/audit.ts` |
| 乐观锁并发 | `CompanyFieldValue.version`，写时 `where:{id, version}` + `version++`；冲突抛 FieldWriteConflictException（409） | `modules/company-fields/company-fields.service.ts`、`common/exceptions/field-write-conflict.exception.ts` |
| 合同可撤销 | 每次执行写入叶子记录 `ContractFieldEffect`（before/after/value/op）；删除合同按 executedAt 重放其余合同增量，精确撤销本合同影响 | `modules/contracts/contract-engine.service.ts`、`ContractFieldEffect` 模型 |
| WebSocket 安全 | 握手必须 JWT（与 HTTP 侧同 issuer/audience）；强制改密用户禁连；房间归属校验（非 SUPER_ADMIN 只能订阅自己比赛房间） | `realtime/realtime.gateway.ts` |
| 登录日志 | 所有 HTTP 请求经 LoggingInterceptor；写操作 + 异常上下文落 AuditLog 数据库表（含 operatorId、ip、requestId、changes 脱敏） | `common/interceptors/logging.interceptor.ts`、`common/logging/audit.ts`、`prisma/prisma.service.ts` $allOperations |

---

## 测试

```bash
# 后端单元测试（Jest，覆盖权限目录、角色模板、字段服务、产业计算引擎、股票引擎、表达式安全、JSON Schema）
cd server && npm test

# 单元测试（watch 模式）
npm run test:watch

# 覆盖率
npm run test:cov

# e2e 测试
npm run test:e2e
```

---

## 常见问题

**Q：启动服务端报错「JWT_SECRET 未设置」？**
A：复制 `server/.env.example` 为 `server/.env`，填入 `JWT_SECRET`（任意字符串，生产请用强随机值）。

**Q：客户端登录后提示「版本不一致」无法操作？**
A：检查 client/package.json 与 server/package.json 的 `version` 字段是否一致。若不一致请执行 `tools/updater/` 的发版脚本同步，或手动改成相同值后重启两端。

**Q：忘记 admin 密码？**
A：删除 `server/prisma/dev.db` 后重启服务端 → 重新自举 `admin / admin123`；或在 SQLite 中用 bcryptjs 生成新哈希直接替换 `passwordHash` 列、并设 `mustChangePassword=1`。

**Q：如何开启外网访问？**
A：设置 `server/.env` 的 `CORS_ORIGIN=https://your-domain.com`（多个用英文逗号分隔）；同时必须配置 HTTPS，JWT 凭据才能被浏览器跨源携带。

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [软件文档.md](docs/软件文档.md) | 完整软件文档：接口、流程、配置全量说明 |
| [系统架构图.md](docs/系统架构图.md) | 10 张架构图：总体、端侧、服务端管线、数据模型 ER 等 |
| [权限分级与重构设计.md](docs/权限分级与重构设计.md) | 权限模型、31 key 分级、角色模板与授予上限、范围字段设计 |
| [数据同步与实时刷新重构设计.md](docs/数据同步与实时刷新重构设计.md) | IndexedDB realm 分库、增量基线算法、Socket.IO 广播、前端刷新机制 |
| [股票系统优化设计.md](docs/股票系统优化设计.md) | 消除一字板的定价公式、撮合流程、PE 联动 / 随机模式、干预配置 |
| [后端重构设计.md](docs/后端重构设计.md) | 服务端架构治理：模块拆分、数据模型加固、可观测、测试 & CI |
| [合同与字段表达式引擎重设计.md](docs/合同与字段表达式引擎重设计.md) | 合同引擎 + 计算字段统一 DSL / 双模式编辑 / 校验闭环 |
| [重构方案.md](docs/重构方案.md) | 问题地图、依赖拓扑、关键决策、六份蓝图整合路线图 |
| [重构进度报告.md](docs/重构进度报告.md) | 里程碑完成情况、测试统计、遗留项 |
| [自定义控件开发指南.md](docs/自定义控件开发指南.md) | 仪表盘自定义 Vue 控件开发：注册 / props / 字段绑定 / 示例 |

---

## 许可证

以仓库 `LICENSE` 文件为准。
