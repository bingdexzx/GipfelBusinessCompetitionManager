# Gipfel 商赛办赛辅助系统 - Code Wiki

> 本文档为项目代码库的结构化技术文档，涵盖项目架构、模块职责、关键实现、依赖关系和运行方式。

---

## 1. 项目概述

### 1.1 项目定位
Gipfel 商赛办赛辅助系统是一个面向商业模拟竞赛（商赛）办赛方的桌面数据管理与赛事运营工具。系统采用 **Electron + Vue 3 + NestJS** 技术栈，提供比赛管理、基础数据维护、产业系统、合同引擎、股票系统、消息中心等核心功能。

### 1.2 核心特性
- **多租户隔离**：所有业务数据按 `competitionId` 完全隔离
- **配置驱动**：合同引擎、产业字段计算图等均通过配置驱动
- **实时同步**：基于 Socket.IO 的资源变更广播 + IndexedDB 本地缓存
- **版本硬封锁**：客户端与服务端版本不一致时锁定全部功能
- **细粒度权限**：3 角色 + 31 权限 key + 5 范围字段的 RBAC 体系

### 1.3 技术栈

| 层 | 技术栈 |
|---|--------|
| 客户端 | Electron 33 + Vue 3.4 + TypeScript + Element Plus 2.7 + Pinia 4 + Vue Router 5 + Axios + Vite 7 + Socket.IO Client 4 + vue-konva + ECharts 6 |
| 服务端 | NestJS 11 + Prisma 6 + SQLite + JWT + Socket.IO 4 + Winston + bcryptjs + mathjs + zod |
| 共享包 | `shared/engine-dsl` 表达式引擎 DSL |
| 数据库 | SQLite（单文件 `server/prisma/dev.db`，34 个数据模型）|

---

## 2. 项目目录结构

```
GipfelBusinessCompetitionManager/
├── server/                              # NestJS 服务端
│   ├── src/
│   │   ├── main.ts                      # 启动入口
│   │   ├── app.module.ts                # 根模块（24 子模块 + 5 全局守卫）
│   │   ├── auth/                        # 认证模块（JWT + 登录/改密）
│   │   ├── users/                       # 用户/账户 CRUD
│   │   ├── permissions/                 # 权限系统（目录/守卫/角色模板）
│   │   ├── realtime/                    # WebSocket 实时广播
│   │   ├── prisma/                      # PrismaService + 审计中间件
│   │   ├── common/                      # 横切基础设施
│   │   │   ├── config/                  # 配置模块
│   │   │   ├── decorators/              # 自定义装饰器
│   │   │   ├── guards/                  # 5 个全局守卫
│   │   │   ├── interceptors/            # 响应/日志拦截器
│   │   │   ├── filters/                 # 异常过滤器
│   │   │   ├── logging/                 # 日志/审计系统
│   │   │   ├── security/                # 登录限流
│   │   │   └── validators/              # 自定义校验器
│   │   └── modules/                     # 15 个业务模块
│   │       ├── competitions/            # 比赛与财年
│   │       ├── materials/               # 原料
│   │       ├── parts/                   # 零件
│   │       ├── products/                # 产品
│   │       ├── tech-tree/               # 科技树
│   │       ├── maps/                    # 地图系统
│   │       ├── infrastructures/         # 基建
│   │       ├── fuels/                   # 燃料
│   │       ├── vehicles/                # 载具
│   │       ├── warehouses/              # 仓库
│   │       ├── production-lines/        # 生产线
│   │       ├── industry-types/          # 产业类型与字段
│   │       ├── companies/               # 公司
│   │       ├── company-fields/          # 公司产业字段值
│   │       ├── contracts/               # 合同系统
│   │       ├── regions/                 # 区域管理
│   │       ├── consumer-demands/        # 消费者需求
│   │       ├── messages/                # 消息中心
│   │       ├── stock/                   # 股票系统
│   │       └── files/                   # 文件服务
│   ├── prisma/
│   │   ├── schema.prisma                # 数据模型定义（34 个模型）
│   │   └── seed.ts                      # 种子数据
│   ├── test/                            # e2e 测试
│   └── package.json
│
├── client/                              # Electron + Vue 3 桌面客户端
│   ├── electron/                        # Electron 主进程
│   │   ├── main.ts                      # 主入口（BrowserWindow）
│   │   ├── preload.ts                   # 预加载脚本
│   │   └── utils/store.ts              # 持久化配置存储
│   └── src/
│       ├── main.ts                      # Vue 入口
│       ├── App.vue                      # 根组件
│       ├── api/                         # HTTP 层
│       │   ├── request.ts               # Axios 实例 + 拦截器 + 缓存
│       │   ├── cache.ts                 # IndexedDB 缓存层
│       │   └── index.ts                 # API 封装集合
│       ├── stores/                      # Pinia 状态管理（6 个 Store）
│       │   ├── auth.ts                  # 认证状态
│       │   ├── competition.ts           # 比赛状态
│       │   ├── config.ts                # 配置状态
│       │   ├── version.ts               # 版本状态
│       │   ├── announcement.ts          # 公告状态
│       │   └── message.ts               # 消息状态
│       ├── router/index.ts              # 路由配置（23 条）
│       ├── views/                       # 页面组件（12 类）
│       ├── components/                  # 通用组件
│       ├── realtime/                    # WebSocket 客户端
│       ├── permissions/catalog.ts       # 权限目录前端镜像
│       ├── composables/                 # 组合式函数
│       ├── utils/                       # 工具函数
│       ├── config/                      # 客户端配置
│       └── types/                       # TypeScript 类型定义
│
├── shared/engine-dsl/                   # 表达式引擎共享包
│   └── src/
│       ├── index.ts                     # 主入口
│       └── schema.ts                    # Schema 定义
│
├── docs/                                # 项目文档
│   ├── 软件文档.md                      # 完整软件文档
│   ├── 系统架构图.md                    # 架构图
│   ├── 权限分级与重构设计.md            # 权限设计
│   ├── 数据同步与实时刷新重构设计.md    # 同步设计
│   ├── 股票系统优化设计.md              # 股票系统
│   ├── 后端重构设计.md                  # 后端重构
│   ├── 合同与字段表达式引擎重设计.md    # 合同引擎
│   ├── 重构方案.md                      # 重构总纲
│   ├── 重构进度报告.md                  # 进度跟踪
│   └── 自定义控件开发指南.md            # 控件开发
│
├── tools/                               # 辅助脚本
│   ├── install_deps.bat                 # 一键安装依赖
│   ├── start_server.bat                 # 启动服务端
│   ├── start_client.bat                 # 启动客户端
│   ├── build.bat                        # 构建
│   ├── package.bat                      # 打包安装包
│   ├── update_server.bat                # 服务器更新
│   ├── logsreader/                      # 日志读取工具
│   └── updater/                         # 发版工具
│
└── .github/workflows/                   # CI/CD
    ├── build.yml                        # 构建工作流
    └── ci.yml                           # CI 工作流
```

---

## 3. 服务端架构

### 3.1 请求处理管线

```
HTTP Request
  → OperatorMiddleware    # JWT 解析 → AsyncLocalStorage 注入
  → securityHeaders       # CSP / X-Frame-Options / CORP
  → loginRateLimiter      # 登录限流（IP+用户名 10次/5分钟）
  → CORS                  # 白名单 / 本地网络反射
  → ValidationPipe        # class-validator 白名单校验
  → JwtAuthGuard          # JWT 验证 + tokenVersion 单设备互斥
  → MustChangePasswordGuard  # 强制改密拦截
  → CompetitionScopeGuard    # 多租户比赛隔离
  → OwnershipGuard           # 资源归属校验（BOLA 防御）
  → PermissionsGuard         # RBAC 细粒度权限
  → Controller → Service → PrismaService
  → ResponseInterceptor   # 统一响应包装
  → LoggingInterceptor    # 请求日志
  → HttpExceptionFilter   # 异常捕获
```

### 3.2 核心模块说明

#### 3.2.1 认证模块 (`auth/`)

**职责**：用户登录、JWT 签发/验证、密码修改

**关键文件**：
- `auth.controller.ts`：登录/改密/获取当前用户 API
- `auth.service.ts`：验证用户、签发 JWT、修改密码
- `strategies/jwt.strategy.ts`：JWT 验证策略

**核心流程**：
```
POST /api/auth/login
  1. 检查登录限流
  2. bcrypt 比对密码
  3. 签发 JWT（含 sub, role, competitionId, tokenVersion）
  4. 返回 {accessToken, user, permissions, version}
```

#### 3.2.2 权限系统 (`permissions/`)

**职责**：RBAC 权限管理、角色模板、授予上限校验

**关键文件**：
- `catalog.ts`：权限目录权威定义（31 key / 18 域）
- `role-templates.ts`：3 角色模板（SUPER_ADMIN / COMPETITION_ADMIN / PLAYER）
- `permissions.guard.ts`：路由级权限守卫

**权限结构**：
```
31 个权限 key = 域:动作
  - 域：competition, data:material, data:part, contract, stock, ...
  - 动作：view(10), edit(20), manage(30), execute(40), audit(50)
  - 动作等级蕴含：manage ⊇ edit ⊇ view
```

**范围字段**：
- `companyScopes`：合同审核范围
- `viewCompanyScopes`：公司字段读范围
- `contractViewCompanyScopes`：合同查看范围
- `stockCompanyScopes`：股票管理范围

#### 3.2.3 实时通信 (`realtime/`)

**职责**：WebSocket 网关、资源变更广播、事件回放

**关键文件**：
- `realtime.gateway.ts`：Socket.IO 网关（鉴权 + 房间管理）
- `realtime.service.ts`：广播服务（事件缓冲 + 补发）

**房间机制**：
- `comp-{competitionId}`：比赛房间（资源变更广播）
- `user-{userId}`：用户私有房间（消息推送）

**事件类型**：
- `resource:changed`：资源变更通知
- `message:new`：新消息通知
- `sync:replay`：断线重连补发

#### 3.2.4 PrismaService (`prisma/`)

**职责**：数据库访问、审计中间件、实时广播触发

**关键实现**：
```typescript
// $allOperations 中间件
this.$use(async (params, next) => {
  // 1. 写操作前快照（用于审计 + 删除影响）
  const before = await this.queryBefore(params);
  
  // 2. 执行实际 DB 写
  const result = await next(params);
  
  // 3. 写操作后三件套
  // 3.1 审计日志
  writeAudit(params.model, params.action, id, before, result);
  
  // 3.2 实时广播
  this.realtime.broadcastResourceChange({
    competitionId, model, action, id, data: result
  });
  
  return result;
});
```

#### 3.2.5 比赛与财年 (`modules/competitions/`)

**职责**：比赛 CRUD、财年管理、多租户根

**关键功能**：
- 比赛创建/更新/删除（SUPER_ADMIN 专属）
- 财年开关（触发 IndustryField 定时器）
- 级联删除（删除比赛时删除所有子资源）

#### 3.2.6 生产链模块 (`materials/`, `parts/`, `products/`)

**职责**：原料、零件、产品三级生产链管理

**数据关系**：
```
Material ← PartMaterial → Part
Part ← ProductPart → Product
Part ← PartTechRequirement → TechNode
Product ← ProductTechRequirement → TechNode
```

**唯一约束**：`@@unique([competitionId, name])`

#### 3.2.7 科技树 (`modules/tech-tree/`)

**职责**：科技节点 DAG 管理、前置依赖

**关键功能**：
- TechNode CRUD（name, tier, researchCost）
- TechPrerequisite 多对多关系
- **成环检测**：BFS 检测添加边后是否产生循环

#### 3.2.8 地图系统 (`modules/maps/`)

**职责**：地图节点/边/类型管理、背景图

**数据结构**：
- MapNodeType：节点类型（颜色）
- PathType：路径类型（颜色）
- MapNode：节点（x, y 坐标, region, nodeTypeId）
- MapEdge：连线（fromNodeId, toNodeId, distance, pathTypeId）

**复合接口**：
- `GET /api/maps/full`：一次性返回所有地图数据

#### 3.2.9 产业类型 (`modules/industry-types/`)

**职责**：产业类型定义、产业字段配置、计算图引擎

**字段类型**：
- `STRING`：文本
- `NUMBER`：数值
- `BOOLEAN`：布尔
- `DICTIONARY`：字典（key-value 对）
- `LIST`：列表

**计算字段**：
- `isCalculated`：是否为计算字段
- `calcGraph`：计算图 JSON（GGraph 格式）
- 触发机制：写入非计算字段时，级联重算所有依赖的计算字段

**财年定时器**：
- `timerEnabled`：是否启用
- `timerTrigger`：FY_START / FY_END
- `timerValue`：触发时写入的值

#### 3.2.10 公司与字段值 (`modules/companies/`, `modules/company-fields/`)

**职责**：公司 CRUD、产业字段值读写、乐观锁并发控制

**乐观锁实现**：
```typescript
async upsertFieldValue(companyId, industryFieldId, newValue) {
  // 1. 查询当前行（含 version）
  const current = await this.findCurrent(companyId, industryFieldId);
  
  // 2. 乐观锁更新
  const result = await this.prisma.companyFieldValue.updateMany({
    where: { companyId, industryFieldId, version: current.version },
    data: { value: newValue, version: { increment: 1 } }
  });
  
  // 3. 并发冲突检测
  if (result.count === 0) {
    throw new FieldWriteConflictException();
  }
  
  // 4. 触发计算字段级联重算
  await this.industryCalcEngine.recalculateForField(industryFieldId);
}
```

#### 3.2.11 合同系统 (`modules/contracts/`)

**职责**：合同类型配置、合同实例管理、执行引擎

**合同类型配置**：
- `partyRoles`：参与方定义（2-3 方）
- `inputSchema`：输入参数 schema
- `effects`：效果数组（FIELD 类型，改写产业字段）
- `conditions`：前置条件数组
- `graph`：可视化图结构

**执行引擎流程**：
```
executeContract(contractId)
  1. 校验前置条件（conditions）
  2. 计算效果计划（effects）
  3. 逐个执行效果（乐观锁保护）
  4. 记录 ContractFieldEffect（用于撤销）
  5. 更新合同状态为 EXECUTED
```

**合同撤销**：
- 删除已执行合同时，精确撤销其效果
- 重放后续合同的效果，保持数据一致性

#### 3.2.12 股票系统 (`modules/stock/`)

**职责**：股票管理、资金账户、委托撮合、K 线生成

**数据结构**：
- Stock：股票基础信息 + PE 模式配置
- StockFundsAccount：资金账户（可绑定产业字段）
- StockHolding：持仓
- StockOrder：委托订单
- StockCandle：K 线数据

**轮次推进流程**：
```
advanceRound(competitionId, stockId)
  1. 快照 PE 值（联动模式 / 随机模式）
  2. 撮合（双指针算法）
  3. 定价（基本面 + 供需 + ±10% 限幅）
  4. 生成 K 线
  5. 级联计算字段重算
  6. 实时广播
```

#### 3.2.13 消息中心 (`modules/messages/`)

**职责**：站内消息发布、收件箱、实时推送

**消息类型**：
- 全体消息（`targetsAll = true`）
- 定向消息（`targetUserIds` 数组）

**实时推送**：
- 发布时批量写入 MessageRecipient
- 对每个收件人发送 `message:new` 事件

---

## 4. 客户端架构

### 4.1 启动流程

```
1. ensureStorageMigration()     # 本地存储迁移
2. deleteOldAccountDbs()        # 清理旧 IndexedDB
3. createApp(App)
4.   app.use(Pinia)             # 6 个 Store
5.   app.use(Router)            # 23 条路由
6.   app.use(ElementPlus, zh-cn)
7.   app.use(VueKonva)
8.   registerCustomWidgets()    # 仪表盘自定义控件
9.   app.mount('#app')
```

### 4.2 Pinia Stores

| Store | 职责 | 关键状态 |
|-------|------|----------|
| `auth.ts` | 认证状态 | token, user, needsPasswordChange |
| `competition.ts` | 比赛状态 | currentCompetition, availableCompetitions |
| `config.ts` | 配置状态 | serverUrl |
| `version.ts` | 版本状态 | clientVersion, serverVersion, isLocked |
| `announcement.ts` | 公告状态 | currentAnnouncement, dismissedVersions |
| `message.ts` | 消息状态 | unreadCount, recentMessages |

### 4.3 路由与导航守卫

**路由结构**：
```
/login                    # 登录页（无需认证）
/                         # 主框架（需认证）
├── /dashboard            # 仪表盘
├── /materials            # 原料管理
├── /parts                # 零件管理
├── /products             # 产品管理
├── /maps                 # 地图管理
├── /infrastructures      # 基建管理
├── /tech-tree            # 科技树管理
├── /fuels                # 燃料管理
├── /vehicles             # 载具管理
├── /warehouses           # 仓库管理
├── /production-lines     # 生产线管理
├── /region-overview      # 区域总览
├── /industry-types       # 产业类型
├── /messages             # 消息中心
├── /contract-types       # 合同类型
├── /contracts            # 合同管理
├── /competitions         # 比赛管理
├── /accounts             # 账户管理
├── /companies            # 公司管理
├── /companies/:id        # 公司详情
├── /stocks               # 股票行情
├── /stock-management     # 股票管理
└── /settings             # 系统设置
```

**导航守卫执行序**：
1. 强制改密检查
2. 登录状态检查
3. 角色检查（requiresSuperAdmin）
4. 权限检查（requiresPermission）

### 4.4 HTTP 层 (`api/request.ts`)

**核心功能**：
- JWT 注入（请求拦截器）
- 版本硬封锁检查
- 401 登出处理
- 乐观锁冲突提示（409）
- **本地缓存 + 增量同步**（IndexedDB）

**缓存策略**：
```
GET 请求流程：
  1. 检查内存 memo（15 秒新鲜度窗口）
  2. 检查本地全量副本（IndexedDB）
  3. 增量同步（携带 updatedAfter）
  4. 全量同步（基线过期时）
  5. 离线降级（网络失败时）
```

**写后失效**：
- POST/PUT/PATCH/DELETE 成功后
- 清空内存 memo
- 失效本地全量副本
- 标记下次 GET 强制直连服务器

### 4.5 实时通信 (`realtime/`)

**文件结构**：
- `socket.ts`：Socket.IO 客户端连接
- `resource-changed.ts`：资源变更事件分发
- `useResourceChanged.ts`：组件级 Hook

**事件监听**：
```typescript
socket.on('resource:changed', (event) => {
  // 1. 更新 IndexedDB
  cacheUpdate(event);
  
  // 2. 触发组件刷新
  if (currentViewResources.includes(event.model)) {
    triggerRefresh();
  }
});

socket.on('message:new', (message) => {
  // 1. 更新未读计数
  messageStore.unreadCount++;
  
  // 2. 弹出浮窗
  showToast(message);
});
```

### 4.6 关键组件

#### 4.6.1 DataManager.vue
通用 CRUD 表格组件，支撑 11 类基础数据管理。

**Props**：
- `type`：资源类型
- `columns`：表格列配置
- `formSchema`：表单字段配置
- `permissions`：权限配置

#### 4.6.2 ContractTypeGraphEditor.vue
合同类型可视化图编辑器，支持节点 + 连线 + vue-konva 画布。

#### 4.6.3 IndustryFieldGraphEditor.vue
产业字段计算图编辑器，支持 DAG 节点编辑。

#### 4.6.4 FormulaBuilder.vue
表达式输入面板，支持字段/输入变量自动补全。

---

## 5. 共享模块 (`shared/engine-dsl`)

### 5.1 职责
表达式引擎 DSL 定义，前后端共用。

### 5.2 关键文件
- `src/index.ts`：主入口，导出表达式求值函数
- `src/schema.ts`：Schema 定义（Zod）

### 5.3 使用方式
- 前端：Vite 别名 `@gipfel/engine-dsl` 直接消费 TS 源码
- 后端：构建时 `tsc -p ../shared/engine-dsl/tsconfig.json`

---

## 6. 数据模型

### 6.1 核心实体关系

```
User ── competitionId ──→ Competition
  │                         ├──→ FiscalYear
  │                         ├──→ Material / Part / Product
  │                         ├──→ MapNode / MapEdge / PathType
  │                         ├──→ Infrastructure / Warehouse
  │                         ├──→ Fuel / Vehicle
  │                         ├──→ Region → ConsumerDemand
  │                         ├──→ IndustryType → IndustryField
  │                         └──→ Company → CompanyFieldValue
  │
  ├──→ Message (senderId) → MessageRecipient
  └──→ StockFundsAccount → StockOrder → StockHolding

ContractType (全局模板)
  ├── partyRoles[]
  ├── inputSchema
  ├── conditions[]
  ├── effects[]
  └── graph

Contract (比赛实例)
  ├── contractTypeId
  ├── parties
  ├── inputs
  ├── status: DRAFT / PENDING_EXEC / EXECUTED
  └── ContractFieldEffect

Stock
  ├── StockOrder
  ├── StockHolding
  └── StockCandle
```

### 6.2 关键模型说明

#### User（用户）
| 字段 | 类型 | 说明 |
|------|------|------|
| username | String | 唯一用户名 |
| passwordHash | String | bcrypt 哈希密码 |
| role | UserRole | SUPER_ADMIN / COMPETITION_ADMIN / PLAYER |
| competitionId | Int? | 所属比赛 |
| permissions | String? | JSON 权限数组 |
| companyScopes | String? | 合同审核范围 |
| viewCompanyScopes | String? | 公司字段读范围 |
| contractViewCompanyScopes | String? | 合同查看范围 |
| stockCompanyScopes | String? | 股票管理范围 |
| mustChangePassword | Boolean | 强制改密标志 |
| tokenVersion | Int | 单设备登录版本号 |

#### CompanyFieldValue（公司字段值）
| 字段 | 类型 | 说明 |
|------|------|------|
| companyId | Int | 公司 ID |
| industryFieldId | Int | 产业字段 ID |
| value | String | 字段值（JSON 序列化） |
| version | Int | 乐观锁版本号 |

#### ContractType（合同类型）
| 字段 | 类型 | 说明 |
|------|------|------|
| key | String | 唯一编码 |
| partyCount | Int | 参与方数量（2-3） |
| partyRoles | Json | 参与方角色定义 |
| inputSchema | Json | 输入参数 schema |
| effects | Json | 效果数组 |
| conditions | Json | 前置条件 |
| graph | Json | 可视化图结构 |

#### Stock（股票）
| 字段 | 类型 | 说明 |
|------|------|------|
| code | String | 股票代码 |
| totalShares | Int | 总股本 |
| initNetProfit | Float | 初始净利润 |
| industryPE | Float | 行业 PE |
| pbCompanyId | Int? | PE 联动公司 |
| pbFieldId | Int? | PE 联动字段 |
| pbRandom | Float | 随机 PE |
| currentPrice | Float | 当前价格 |
| round | Int | 当前轮次 |

---

## 7. 依赖关系

### 7.1 外部依赖

#### 服务端核心依赖
```json
{
  "@nestjs/core": "^11.0.0",
  "@nestjs/common": "^11.0.0",
  "@nestjs/platform-express": "^11.0.0",
  "@nestjs/websockets": "^11.0.0",
  "@nestjs/jwt": "^11.0.0",
  "@nestjs/passport": "^11.0.0",
  "@prisma/client": "^6.0.0",
  "socket.io": "^4.7.0",
  "bcryptjs": "^3.0.0",
  "mathjs": "^15.2.0",
  "zod": "^4.4.0",
  "class-validator": "^0.15.0",
  "class-transformer": "^0.5.0",
  "winston": "^3.13.0",
  "nest-winston": "^1.9.0"
}
```

#### 客户端核心依赖
```json
{
  "vue": "^3.4.0",
  "vue-router": "^5.0.0",
  "pinia": "^4.0.0",
  "element-plus": "^2.7.0",
  "axios": "^1.7.0",
  "socket.io-client": "^4.7.0",
  "vue-konva": "^3.0.0",
  "echarts": "^6.0.0",
  "vue-echarts": "^8.0.0",
  "dexie": "^4.0.0",
  "electron": "^33.0.0"
}
```

### 7.2 模块依赖关系

```
auth/ → users/, permissions/
users/ → permissions/, prisma/
permissions/ → （独立）
realtime/ → prisma/
prisma/ → realtime/

modules/competitions/ → prisma/, realtime/
modules/materials/ → prisma/, realtime/
modules/parts/ → prisma/, realtime/, materials/
modules/products/ → prisma/, realtime/, parts/
modules/tech-tree/ → prisma/, realtime/
modules/maps/ → prisma/, realtime/, files/
modules/industry-types/ → prisma/, realtime/, company-fields/
modules/companies/ → prisma/, realtime/, industry-types/, company-fields/
modules/company-fields/ → prisma/, realtime/, industry-types/
modules/contracts/ → prisma/, realtime/, company-fields/, industry-types/
modules/stock/ → prisma/, realtime/, company-fields/, regions/
modules/messages/ → prisma/, realtime/, files/
modules/regions/ → prisma/, realtime/
modules/consumer-demands/ → prisma/, realtime/
modules/files/ → prisma/
```

---

## 8. 运行方式

### 8.1 环境要求
- Node.js ≥ 18（推荐 20 LTS）
- npm ≥ 9
- 操作系统：Windows 10+ / macOS 11+ / Linux

### 8.2 快速开始（开发模式）

```bash
# 1. 安装依赖
tools\install_deps.bat
# 或手动：
cd shared/engine-dsl && npm install
cd ../../server && npm install
cd ../client && npm install

# 2. 配置服务端环境变量
cd server
cp .env.example .env
# 编辑 .env：
#   JWT_SECRET=your-secret-key

# 3. 初始化数据库
npx prisma db push

# 4. 启动服务端
npm run start:dev

# 5. 启动客户端（另开终端）
cd ../client
npm run dev
```

### 8.3 默认管理员
- 用户名：`admin`
- 密码：`admin123`
- 角色：`SUPER_ADMIN`
- **首次登录强制改密**

### 8.4 构建与打包

```bash
# 构建（不打包安装包）
tools\build.bat

# 打包 Windows 安装包
tools\package.bat

# 跨平台打包
cd client && npm run electron:build        # macOS
cd client && npm run electron:build:linux  # Linux
```

### 8.5 服务端部署（生产环境）

```bash
# 1. 配置环境变量
cd server
cp .env.example .env
# 修改 JWT_SECRET 为强随机值

# 2. 初始化数据库
npm ci
npx prisma db push

# 3. 构建
npm run build

# 4. 启动（PM2）
npm install -g pm2
pm2 start dist/main.js --name gipfel-server --time
pm2 save
pm2 startup
```

### 8.6 服务器一键更新

```bash
tools\update_server.bat
# 内含：git pull → npm ci → shared tsc → server build → prisma db push → pm2 restart
```

---

## 9. 测试

### 9.1 单元测试

```bash
cd server && npm test
```

**测试覆盖**：
- `catalog.spec.ts`：权限目录
- `role-templates.spec.ts`：角色模板
- `company-fields.service.spec.ts`：字段服务
- `industry-calc-engine.service.spec.ts`：计算引擎
- `safe-expression.spec.ts`：表达式安全
- `json-schema.spec.ts`：JSON Schema 校验
- `engine.spec.ts`：股票引擎

### 9.2 e2e 测试

```bash
cd server && npm run test:e2e
```

---

## 10. 安全设计

### 10.1 认证安全
- JWT（HS256，issuer/audience 双声明绑定）
- bcryptjs cost=12 密码哈希
- 单设备登录互斥（tokenVersion 自增）
- 首次登录强制改密

### 10.2 访问控制
- 5 层全局守卫（JWT → 改密 → 比赛域 → 所有权 → RBAC）
- 31 个细粒度权限 key
- 5 个范围约束字段
- 动作等级蕴含（manage ⊇ edit ⊇ view）

### 10.3 数据安全
- 多租户隔离（CompetitionScopeGuard）
- 资源归属校验（OwnershipGuard）
- 乐观锁并发控制（CompanyFieldValue.version）
- 输入校验白名单（ValidationPipe）

### 10.4 通信安全
- CORS 策略（本地网络反射 + 白名单）
- 安全响应头（CSP / XFO / XCTO / CORP）
- WebSocket JWT 鉴权

### 10.5 审计安全
- 写操作审计日志（AuditLog 表）
- 异常上下文落库
- Winston 文件日志（按日轮转）
- 敏感字段脱敏（passwordHash / token）

---

## 11. 常见问题

### Q1：启动服务端报错「JWT_SECRET 未设置」
**A**：复制 `server/.env.example` 为 `server/.env`，填入 `JWT_SECRET`。

### Q2：客户端登录后提示「版本不一致」
**A**：检查 `client/package.json` 与 `server/package.json` 的 `version` 字段是否一致。

### Q3：忘记 admin 密码
**A**：删除 `server/prisma/dev.db` 后重启服务端，会自动重新创建默认超管。

### Q4：如何开启外网访问
**A**：设置 `server/.env` 的 `CORS_ORIGIN=https://your-domain.com`，同时配置 HTTPS。

### Q5：产业字段值写入后「又自己变回去了」
**A**：该字段是 `isCalculated=true`（计算字段），随被依赖字段写入立即被级联重算覆盖。编辑 calcGraph 使其输出期望值。

---

## 12. 版本与发版

### 12.1 版本号位置
- `client/package.json` → `version`（Electron 读取）
- `server/package.json` → `version`（API 返回）

### 12.2 发版流程
1. 编辑 `tools/updater/ui.mjs`（新版本号 + 更新公告）
2. 双击 `tools/updater/run.bat` 打开发布页
3. 点击「执行发版」→ 同步改写两处 package.json + 生成公告
4. 执行 `tools/package.bat` 生成安装包

---

## 13. 文档索引

| 文档 | 内容 |
|------|------|
| [软件文档.md](软件文档.md) | 完整软件文档 |
| [系统架构图.md](系统架构图.md) | 10 张架构图 |
| [权限分级与重构设计.md](权限分级与重构设计.md) | 权限模型设计 |
| [数据同步与实时刷新重构设计.md](数据同步与实时刷新重构设计.md) | 同步机制设计 |
| [股票系统优化设计.md](股票系统优化设计.md) | 股票系统设计 |
| [后端重构设计.md](后端重构设计.md) | 后端架构治理 |
| [合同与字段表达式引擎重设计.md](合同与字段表达式引擎重设计.md) | 合同引擎设计 |
| [重构方案.md](重构方案.md) | 重构总纲 |
| [重构进度报告.md](重构进度报告.md) | 进度跟踪 |
| [自定义控件开发指南.md](自定义控件开发指南.md) | 控件开发指南 |

---

*本文档基于代码实际内容生成，与实现保持同步。如有不一致请以代码为准。*
