# 全量代码审查报告（前端 + 后端）

> 审查时间：2026-08-23
> 范围：GipfelBusinessCompetitionManager 前端 `client/` 与后端 `server/`
> 方法：静态审查 + 关键路径交叉核验（已实际读取源码核实，非猜测）

---

## 一、已确认的严重问题（建议优先修复）

### 1. 【严重｜前端→后端】DataManager 列表丢失 competitionId，导致跨比赛数据泄漏
- **前端**：`client/src/components/common/DataManager.vue:214`
  `const res = await (props.api as any).list({ competitionId: compStore.competitionId });`
- **后端**：`client/src/api/index.ts:90` `productsApi.list = (page=1, pageSize=50) => ...`，`partsApi` / `warehousesApi` / `productionLinesApi` / `fuelsApi` / `vehiclesApi` 等同类签名均为 `(page, pageSize)`，第一个位置参数是 `page`。
- **根因**：`{ competitionId }` 被当作 `page` 传入，后端 `competitionId` 实为 `undefined`。后端 `product.service.ts:13` `baseWhere = competitionId ? {competitionId} : {}` → 退化为查询**所有比赛**的数据。
- **影响**：经 `DataManager` 渲染的 products / parts / warehouses / production-lines / fuels / vehicles 等列表会返回跨比赛数据，构成数据越权/泄漏（任何比赛用户都能看到其他比赛数据）。
- **修复**：统一 `list` 的 `competitionId` 透传，例如 `api.get("/xxx", { params: { competitionId } })`，或让 `DataManager` 用正确签名；并让 service 在缺失 competitionId 时对非超管强制按 `user.competitionId` 兜底。

### 2. 【严重｜后端】`sync:replay` 实时事件未按比赛隔离（疑似跨租户泄露）
- **文件**：`server/src/realtime/realtime.gateway.ts:176-205`、`server/src/realtime/realtime.service.ts`（eventBuffer 混合存储所有比赛）
- **根因**：`sync:replay` 仅按 `lastSeq` 回放 `eventBuffer` 全量事件，buffer 不按 competitionId 分桶，`getEventsAfter` 也不过滤。任何已登录用户都可拿到其它比赛的 `company-fields` / `contracts` 等敏感变更事件。
- **修复**：replay 时按 `client.data.competitionId`（超管除外）过滤事件；或 eventBuffer 改为按 competitionId 分桶。

### 3. 【严重｜后端】财年接口缺少归属校验（越权读写任意比赛）
- **文件**：`server/src/modules/competitions/competition.controller.ts:75-100`
- **根因**：`@Get(":id/fiscal-years")`（仅 JwtAuthGuard）、`@Post(":id/fiscal-years"`、`@Patch`/`@Delete("fiscal-years/:fyId")` 仅 `competition:manage`，但未校验 `:id` 是否等于操作者所属比赛。`competition:manage` 用户可对任意比赛财年做增删改，进而经 `applyFiscalYearTimer` 改写对方公司产业字段。
- **修复**：加 competition 归属校验（复用 OwnershipGuard 或 service 内 `assertSameCompetition`）。

### 4. 【严重｜后端】`advance-round` 的 competitionId 由客户端传入且无归属校验
- **文件**：`server/src/modules/stock/stock.controller.ts:191`、`server/src/modules/stock/stock.service.ts:1064`
- **根因**：`advanceRound` 仅校验 `isHighManager(user)`（stock:manage/超管），`competitionId` 取自 `@Query("competitionId")`，未被 CompetitionScopeGuard（它只覆盖 body，不覆盖 query）收敛。可推进其他比赛的轮次、撮合、改价、触发做市商。
- **修复**：强制 `competitionId = user.competitionId`（超管除外），或加 `assertSameCompetition`。

### 5. 【严重｜前端】断线重连补发失效 / 子资源对账 URL 拼错
- **文件**：`client/src/realtime/resource-changed.ts:166`（`window.__gipfel_socket` 从未赋值，恒 undefined，导致 `sync:replay` 从未触发）；`client/src/api/request.ts:719` 反查 URL 对股票子资源拼错（`/stock-accounts`、`/stock-orders`、`/stock-holdings`、`/stock-candles` 等，应为 `/stocks/accounts/list` 等真实路径）。
- **影响**：断线期间被删除的股票账户/订单/持仓本地副本不会被清理（虽有 `resource:changed` 实时删除兜底，但增量对账不完整）。
- **修复**：用已导出的 `getSocketInstance()` 替代 `window.__gipfel_socket`；对账 URL 改用真实接口地址。

---

## 二、已确认的中等问题

| 级别 | 位置 | 问题 | 建议 |
|------|------|------|------|
| 中 | `server/src/app.module.ts:45` | `PermissionsGuard` 仅作为普通 provider 注册，未用 `{provide: APP_GUARD}` 全局生效，属无效声明且易误导 | 删除或改为全局注册 |
| 中 | `server/src/modules/stock/stock.service.ts:550-574` | `findAllFundsAccounts` 在查询接口内逐个 `resolveFieldValueOrDefault` 后 `update` 写 cashBalance（N+1 + 列表副作用 + 并发竞态） | 列表应为纯读，字段→余额同步收敛到单一写路径 |
| 中 | `server/src/modules/stock/stock.service.ts:1068` | `_advanceLocks` 内存锁仅单实例有效，多实例部署下并发推进同一比赛会重复撮合 | 改 DB 行锁或分布式锁 |
| 中 | `server/src/modules/stock/stock.service.ts:949` | 做市商建仓读 `this.prisma.stockHolding.findUnique` 未走事务客户端（`db`），读-改-写可能基于旧快照 | 改为 `db.stockHolding.findUnique` |
| 中 | `server/src/modules/competitions/competition.controller.ts:43-51` | `findOne` 越权 id 返回 `null`（HTTP 200），非超管可探测「该 id 对应某比赛只是不归你」 | 统一返回 404，避免 IDOR 探测 |
| 中 | `client/src/views/stocks/StockMarketView.vue:282` | `reloadStocks` 对每只股票串行/并行 `await stockApi.candles()`（N+1 请求） | 批量拉取或仅拉选中股票的 K 线 |
| 中 | `client/src/api/request.ts:629/657` | `normalizeListResponse` 把 `{items,total}` 降维成数组，下游 `res.items` 可能 undefined | 统一返回结构，或保留分页对象 |
| 中 | `server/src/modules/messages/message.service.ts:75`、`files.service.ts:194` | 上传文件名含 `Math.random()`，可被枚举预测访问 | 用 `crypto.randomBytes` 生成不可预测片段 |

---

## 三、已确认/基本无忧（已核实，不计入强制修复）

- **el-form 回车提交**：`LoginView.vue:43` 仅 `@keyup.enter="handleLogin"`，按钮非 `native-type=submit`，设计与实现一致，**无 bug**（勿把按钮改成 submit）。
- **地图背景图坐标**：`MapsManager.vue` auto 用包围盒、手动用 transform，逻辑自洽，未发现错位。
- **hasPermission 动作蕴含**、`@Ownership` 与 CompetitionScopeGuard 互补、JWT iss/aud 校验、JWT_SECRET 启动校验：均已正确实现。
- **合同删除/K线限幅/做市商事务**：上一轮已修复并通过类型检查。

---

## 四、轻微 / 待确认

- **重复代码**：`formatTime` 全局 `$formatTime` 与 `utils/format.formatTime` 两份实现并存（`ContractManageView` 与 `CompanyDetailView` 各自引用），建议统一。
- **TypeScript 风险**：多处 `any` 滥用（如 `StockManageView.vue:502` 用 any 读取 `pbCompanyId` 等后端字段，前端 `Stock` 接口未声明）。
- **DTO 边界**：`currentCarbon`/`cashBalance`/`quantity` 等缺少 `@Max/@Min` 上限校验。

---

## 五、优先级行动建议

| 优先级 | 编号 | 行动 |
|---|---|---|
| P0 | 1 | 修复 DataManager 的 competitionId 透传（跨比赛数据泄漏） |
| P0 | 2 | `sync:replay` 按比赛隔离事件缓冲 |
| P0 | 3 | 财年接口加 competition 归属校验 |
| P0 | 4 | `advance-round` 强制 competitionId = 归属比赛 |
| P1 | 5 | replay socket 实例 + 子资源对账 URL |
| P1 | 以上「中等」各项 | 按需排期修复 |

> 说明：以上均为静态代码核查结论；涉及"跨比赛是否真的返回数据"已通过读取 `product.service.ts` 确认 `competitionId===undefined → baseWhere={}`。建议下一步进入 Craft 模式逐项修复，修复后补充自动化测试覆盖越权场景。
