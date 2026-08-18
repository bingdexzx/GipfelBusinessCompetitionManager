# shared/engine-dsl 接入设计

> 状态：设计稿（待评审）｜2026-08-18
> 关联：消除双端 DSL 定义漂移，把 `@gipfel/engine-dsl` 真正接进 server / client。

## 1. 背景

`shared/engine-dsl` 是 M6 重构时为「合同引擎 + 产业字段引擎」规划的**双端共享 DSL 包**（单一真源），内含类型（`ValueSpec`/`Effect`/`ConditionSpec` 等）、常量（`OP_NAMES`/`OP_ARG_SPECS`/`FORMULA_FUNCTIONS`/`COMPARE_OP_LABEL` 等）与 JSON Schema。但此前它**未被任何源码 import**，前后端各维护一份本地副本，存在定义漂移风险。本设计把它真正接进两端。

## 2. 调研结论（对齐清单）

### 2.1 server 引擎与 shared 已逐字对齐（零风险可接）

逐一比对 `server/src/modules/contracts/engine/{values,effects,conditions}.ts` 与 `shared/engine-dsl/src`，以下导出**内容完全一致**：

| 类别 | 名称 |
|---|---|
| 类型 | `ValueSpec` `ValueType` `EntityType` `PartyDef` `EvalCtx` `CompareOp` `FieldEffectOp` `ConditionKind` `ConditionSpec` `CheckResult` |
| 常量 | `ENTITY_MODEL` `COMPARE_OP_LABEL` `COND_KIND_LABEL` |

这些文件还混有**逻辑函数**（`toNumber` / `applyFieldEffect` / `compareField` / `parseJsonValue` / `combineValues` / `safeParse` / `condKindLabel` 等），它们**不属于** DSL 定义，保留在 server 本地，不迁入 shared。

### 2.2 shared 有、但 server 目前不用

`Effect` 联合类型、`OP_NAMES`、`OP_ARG_SPECS`（丰富版 `{count,labels,types}`）、`FORMULA_FUNCTIONS`、全部 JSON Schema。这些本就是为**前端可视化编辑器 / 公式自动补全 / 配置校验**准备的，server 引擎不消费。接入时 server 只 import 2.1 的类，不 import 这些。

### 2.3 前端现状与分歧（关键）

- `client/src/contracts/graph-model.ts` 有本地 `OP_ARG_SPECS`：`Record<string, string[]>`（值是端口 handle 名），并配套 `OP_LABELS_FULL`（op 中文标题，如"追加元素"）、`OP_ARG_LABELS`（handle→中文，如 `list:"列表"`）、`opCategory`、`ARITH_OPS`。
- shared 的 `OP_ARG_SPECS` 是 `Record<string, {count,labels,types}>`（结构化端口元信息），**结构与语义都不同**：shared 只有端口名 `labels`，没有"op 中文标题"。
- 前端**无**公式函数词表（无 `BUILTIN_FUNCS`/`FORMULA_FUNCTIONS`），公式编辑是纯文本框。
- 前端主用 `GNode`/`GGraph` 图模型，未使用强类型 `ValueSpec`。

**结论**：server 端正适合零风险接入；前端 OP 端口表因结构/语义差异，不能与 shared 简单互换，需单独决策（见 §3.2）。

## 3. 接入方案

### 3.1 后端 server（本次必做，零风险）

1. **路径映射**：`server/tsconfig.json` 的 `paths` 增加
   ```jsonc
   "@gipfel/engine-dsl": ["../shared/engine-dsl/dist"]
   ```
   （指向已编译的 `dist`，Node 运行时不能直接 require `.ts`；`tsconfig.build.json` 继承该 paths，无需重复。）
2. **运行时解析别名**：`server/src/main.ts` 顶部加 `import 'tsconfig-paths/register';`（dev `nest start` 与 prod `node dist/main` 共用，兜底别名解析）。
3. **前置编译 shared**：`server/package.json` 的 `build`/`start`/`start:prod` 脚本前置
   ```jsonc
   "build": "npm --prefix ../shared/engine-dsl run build && nest build",
   "start": "npm --prefix ../shared/engine-dsl run build && nest start",
   "start:prod": "npm --prefix ../shared/engine-dsl run build && node dist/main"
   ```
4. **加依赖**：`tsconfig-paths` 加入 `server/package.json` devDependencies。
5. **engine 三文件改造**（删本地类型/常量，改 import）：
   - `values.ts`：删除 `ValueType`/`ValueSpec`/`EntityType`/`ENTITY_MODEL`/`PartyDef`/`EvalCtx`/`CompareOp`/`COMPARE_OP_LABEL`/`COND_KIND_LABEL` 的本地定义，顶部 `import { ... } from '@gipfel/engine-dsl';`；保留 `toNumber`/`isTruthy`/`deepEqual`/`castScalar`/`safeParse` 等逻辑函数与 `condKindLabel`。
   - `effects.ts`：删除本地 `FieldEffectOp`（shared 已有），保留 `FieldEffectResult`（shared 无，属执行结果类型）；`import { FieldEffectOp } from '@gipfel/engine-dsl';`。
   - `conditions.ts`：删除本地 `ConditionKind`/`ConditionSpec`/`CheckResult`/`COND_KIND_LABEL`，改 import from shared；保留 `condKindLabel`/`createCheckResult` 等函数。
   - `engine/index.ts`：类型/常量改 `export { ... } from '@gipfel/engine-dsl'`（或继续从 values 等 re-export，values 再 import from shared 均可）。
6. **校验逻辑函数不受影响**：所有逻辑函数仍引用同文件内类型（现在来自 shared import），编译语义不变。

### 3.2 前端 client（决策点）

- **vite alias 本次加上**（`client/vite.config.ts`）：
  ```ts
  '@gipfel/engine-dsl': resolve(__dirname, '../shared/engine-dsl/src'),
  ```
  前端 Vite 直接吃 TS 源码，无需先 build shared。
- **OP 端口表迁移**给出两选项：
  - **A（彻底单一真源）**：前端改从 shared import `OP_ARG_SPECS`（丰富版），把所有消费点（`graph-model.ts` 的 `nodeInputs`、`OP_ARG_LABELS` 合并、两个 GraphEditor 的端口渲染、`listOps`/`dictOps` 推导）从 `OP_ARG_SPECS[op]`(string[]) 改为 `OP_ARG_SPECS[op].labels`；并把 `OP_LABELS_FULL`（op 中文标题）补进 shared 或保留本地。**需扩展 shared + 适配多消费点，回归风险中。**
  - **B（务实，默认推荐）**：`OP_ARG_SPECS`/`OP_LABELS_FULL`/`OP_ARG_LABELS`/`opCategory`/`ARITH_OPS` **保留前端本地**，标记为「已知残留漂移点」，作为独立后续任务评估是否统一。理由：server 引擎类型是最该单一真源处（影响落账正确性）且已对齐零风险；前端 OP 端口表与 shared 设计意图不同，强行合并收益低、回归风险高。**本次仅加 vite alias 铺路，不迁移 OP 端口表。**

## 4. 实施步骤

| 步骤 | 文件 | 动作 |
|---|---|---|
| 1 | `server/tsconfig.json` | paths 增加 `@gipfel/engine-dsl` |
| 2 | `server/src/main.ts` | 顶部 `import 'tsconfig-paths/register'` |
| 3 | `server/package.json` | 加 `tsconfig-paths` devDep；build/start/start:prod 前置 build shared |
| 4 | `server/src/modules/contracts/engine/values.ts` | 删本地类型/常量，import from shared |
| 5 | `server/src/modules/contracts/engine/effects.ts` | 删本地 `FieldEffectOp`，import from shared |
| 6 | `server/src/modules/contracts/engine/conditions.ts` | 删本地 `ConditionKind`/`ConditionSpec`/`CheckResult`/`COND_KIND_LABEL`，import from shared |
| 7 | `server/src/modules/contracts/engine/index.ts` | 类型/常量 re-export 改指向 shared |
| 8 | `client/vite.config.ts` | 加 `@gipfel/engine-dsl` alias（按 B 方案，仅铺路） |

> shared 本身**无需改动**（server 用的类型它已全部具备）；`FieldEffectResult` 等非 DSL 结果类型不共享。

## 5. 验证

- 后端：`npm --prefix ../shared/engine-dsl run build` → `cd server && tsc --noEmit` 0 错误；`jest` 全过（确保引擎逻辑函数未受影响）。
- 前端：`cd client && vue-tsc --noEmit -p tsconfig.json` 0 错误；`vite build` 通过。
- 手动：启动后端 `npm run start:dev`，确认 contract/产业字段相关接口正常（落账、precheck）。

## 6. 风险与开放点

1. **前端 OP 端口表**（§3.2）：默认 B 保留本地，属已知残留漂移点；若选 A 需扩展 shared 并适配多消费点。
2. **shared 中 server 不用的部分**（`Effect`/`OP_NAMES`/`OP_ARG_SPECS`丰富版/`FORMULA_FUNCTIONS`/JSON Schema）保留，待前端统一时启用。
3. **tsconfig-paths 运行时解析**依赖 `shared/dist` 已生成；脚本已前置 build shared 兜底，但若 dev 断点调试单独 `node dist/main` 需先 build shared。
4. `nest build` 走 webpack 时会把别名解析为磁盘真实路径（产物无需 tsconfig-paths），而 `tsc`/prod 路径下靠 `tsconfig-paths/register` 兜底——两者并存无冲突。

## 7. 提交与记忆

- git 提交（中文消息）：`feat(shared): 接入 engine-dsl 共享包，后端引擎复用单一真源`
- 更新 `.workbuddy/memory/2026-08-18.md`。
