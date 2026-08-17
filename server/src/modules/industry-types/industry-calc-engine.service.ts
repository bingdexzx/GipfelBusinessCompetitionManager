import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { safeEvaluate } from "../../common/safe-expression";
import { EXPR_HELPERS, applyOp } from "../../common/engine-ops";
import { toNumber, isTruthy } from "../contracts/engine/values";

/**
 * 计算图求值所需的上下文（调用方传入）：
 * - competitionId：本产业实例（公司）所属比赛，用于收敛 ConsumerDemand / MapNode 查询范围。
 * - locationNodeName：本产业实例「所在地」字段解析后的地图节点名（如 "B区节点"）；
 *   用于定位该节点所属区域，进而汇总该区域消费者需求总数。
 */
export type IndustryCalcCtx = {
  competitionId?: number | null;
  locationNodeName?: string | null;
  /** 缓存：地图节点名 → 区域集合，避免同一 recompute 周期内重复查询 */
  nodeRegionCache?: Map<string, Set<string>>;
  /** 缓存：区域集合 key → 消费者需求总数，避免同一 recompute 周期内重复聚合 */
  demandCache?: Map<string, number>;
};

/**
 * 产业计算图引擎（服务端）。
 *
 * 一张「产业计算图」即一个 GGraph（与合同可视化编辑器同源）：
 * - `output` 节点：唯一的输出，其 `value` 输入端口连接的数值源求值结果 = 该计算字段的存储值。
 * - `value`   节点：数值来源，data.kind ∈ FIELD / CONST / FORMULA / OP / VAR。
 *     - FIELD：按 fieldKey 读取作用域（公司当前产业字段现值）。
 *     - CONST：字面量（数字 / 字符串 / [] / {}）。
 *     - FORMULA：受限安全表达式（见 common/safe-expression），作用域 = 字段现值（fieldKey 作变量）+ EXPR_HELPERS。
 *     - OP：复用合同引擎的 applyOp（列表 / 字典 / 算术 / 布尔比较）。
 *     - VAR：读取运行期变量（由 assign 节点赋值）。
 *     - CONSUMER_DEMAND：自动读取本产业实例「所在地」字段对应的地图节点，
 *       取该节点所在区域，汇总本比赛该区域下全部消费者需求（ConsumerDemand.quantity）之和；
 *       无需额外参数，依赖 evaluate 的 ctx（competitionId + locationNodeName）。
 * - `if`     节点：值返回式条件分支，求 `cond`（布尔），真→`then`、假→`else` 输入端口的值。
 * - `assign` 节点：求 `value` 输入端口的值，存入运行期变量 `data.name`（供 VAR 复用，不回写字段）。
 *
 * 作用域 fieldScope：{ [fieldKey]: 已按字段类型解析的值 }。
 * 区域上下文 ctx：{ competitionId, locationNodeName }，仅 CONSUMER_DEMAND 数据源使用。
 */

// 与客户端 graph-model.ts 的 OP_ARG_SPECS 保持一致：每个 op 的参数端口 handle 与顺序。
const OP_ARG_SPECS: Record<string, string[]> = {
  LIST_APPEND: ["list", "item1", "item2"],
  LIST_CONCAT: ["a", "b"],
  LIST_LEN: ["list"],
  LIST_CONTAINS: ["list", "item"],
  LIST_INDEX_OF: ["list", "item"],
  LIST_UNIQUE: ["list"],
  LIST_FLATTEN: ["list"],
  LIST_SUM_OF: ["list"],
  LIST_JOIN: ["list", "sep"],
  LIST_SLICE: ["list", "start", "end"],
  LIST_REVERSE: ["list"],
  LIST_SORT: ["list"],
  LIST_RANGE: ["start", "stop", "step"],
  LIST_ADD: ["a", "b"],
  LIST_SUB: ["a", "b"],
  DICT_GET: ["dict", "key", "default"],
  DICT_KEYS: ["dict"],
  DICT_VALUES: ["dict"],
  DICT_ENTRIES: ["dict"],
  DICT_HAS_KEY: ["dict", "key"],
  DICT_MERGE: ["a", "b"],
  DICT_FROM_PAIRS: ["pairs"],
  DICT_FROM_KEYS: ["keys", "value"],
  DICT_INVERT: ["dict"],
  DICT_ADD: ["a", "b"],
  DICT_SUB: ["a", "b"],
  DICT_APPEND: ["dict", "key", "value"],
  LEN: ["x"],
  CONTAINS: ["coll", "item"],
  SUM_OF: ["list"],
  ADD: ["left", "right"],
  SUB: ["left", "right"],
  MUL: ["left", "right"],
  DIV: ["left", "right"],
  EXP: ["operand"],
  LOG: ["operand", "base"],
  MIN: ["left", "right"],
  MAX: ["left", "right"],
  CMP_EQ: ["left", "right"],
  CMP_NE: ["left", "right"],
  CMP_GT: ["left", "right"],
  CMP_LT: ["left", "right"],
  CMP_GTE: ["left", "right"],
  CMP_LTE: ["left", "right"],
};

function parseConst(v: any): any {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
      try {
        return JSON.parse(s);
      } catch {
        /* 非法 JSON 保留原始字符串 */
      }
    }
    if (s !== "" && !isNaN(Number(s))) return Number(s);
    return s;
  }
  return v;
}

@Injectable()
export class IndustryCalcEngineService {
  private readonly logger = new Logger(IndustryCalcEngineService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 解析图，返回该计算字段的最终值。
   * @param graph      GGraph（calcGraph 字段存储的 JSON 解析结果）
   * @param fieldScope 本产业类型各字段现值（fieldKey → 已解析值）
   * @param ctx        区域上下文：competitionId + locationNodeName（CONSUMER_DEMAND 数据源使用）
   */
  async evaluate(
    graph: any,
    fieldScope: Record<string, any>,
    ctx?: IndustryCalcCtx,
  ): Promise<any> {
    if (!graph || !Array.isArray(graph.nodes)) return 0;
    const nodes: any[] = graph.nodes;
    const edges: any[] = Array.isArray(graph.edges) ? graph.edges : [];
    const nodeById = (id: string) => nodes.find((n) => n.id === id);
    const scope: Record<string, any> = { ...(fieldScope || {}) };

    // —— 第一步：按 VAR 依赖拓扑求值 assign 节点（运行期中间变量）——
    const assigns = nodes.filter((n) => n.type === "assign");
    const remaining = [...assigns];
    let progress = true;
    let guard = 0;
    while (remaining.length && progress) {
      progress = false;
      const still: any[] = [];
      for (const a of remaining) {
        const deps = this.collectVarRefs(a.id, nodeById, edges);
        const ready = deps.every((name) => Object.prototype.hasOwnProperty.call(scope, name));
        if (ready) {
          const val = await this.evalInput(a.id, "value", nodeById, edges, scope, ctx, 0);
          scope[a.data?.name] = val;
          progress = true;
        } else {
          still.push(a);
        }
      }
      remaining.length = 0;
      remaining.push(...still);
      if (++guard > 10000) throw new BadRequestException("产业计算图：变量依赖存在循环");
    }
    if (remaining.length)
      throw new BadRequestException("产业计算图：assign 变量互相引用，存在循环依赖");

    // —— 第二步：求值输出节点 ——
    const out = nodes.find((n) => n.type === "output");
    if (!out) return 0;
    return await this.evalInput(out.id, "value", nodeById, edges, scope, ctx, 0);
  }

  // 求某个「输入端口」的值：找到连到该端口的边，求值其上游输出端口。
  private async evalInput(
    targetNodeId: string,
    targetHandle: string,
    nodeById: (id: string) => any,
    edges: any[],
    scope: Record<string, any>,
    ctx: IndustryCalcCtx | undefined,
    depth: number,
  ): Promise<any> {
    if (depth > 2000) return 0; // 防御：图意外成环时避免栈溢出
    const edge = edges.find(
      (e) => e.target === targetNodeId && e.targetHandle === targetHandle,
    );
    if (!edge) {
      // 未连线：OP 节点的参数端口可回退到字面量（argLiterals）；其余回退 0。
      const tgt = nodeById(targetNodeId);
      if (tgt && tgt.type === "value" && tgt.data?.kind === "OP") {
        const lit = tgt.data.argLiterals?.[targetHandle];
        if (lit !== undefined) return parseConst(lit);
      }
      return 0;
    }
    return await this.evalOutput(edge.source, edge.sourceHandle, nodeById, edges, scope, ctx, depth + 1);
  }

  // 求某个「输出端口」的值：根据节点类型分派。
  private async evalOutput(
    nodeId: string,
    handle: string,
    nodeById: (id: string) => any,
    edges: any[],
    scope: Record<string, any>,
    ctx: IndustryCalcCtx | undefined,
    depth: number,
  ): Promise<any> {
    if (depth > 2000) return 0; // 防御：图意外成环时避免栈溢出
    const node = nodeById(nodeId);
    if (!node) return 0;
    if (node.type === "value") {
      const d = node.data || {};
      switch (d.kind) {
        case "FIELD": {
          if (!Object.prototype.hasOwnProperty.call(scope, d.fieldKey)) {
            this.logger.warn(`计算图 FIELD 节点引用了不存在的字段 "${d.fieldKey}"，返回 0`);
            return 0;
          }
          return scope[d.fieldKey];
        }
        case "CONST":
          return parseConst(d.value);
        case "FORMULA":
          try {
            return safeEvaluate(d.expr as string, { ...scope, ...EXPR_HELPERS });
          } catch (e: any) {
            this.logger.warn(`计算图 FORMULA 节点求值失败: ${e?.message || e}，返回 0`);
            return 0;
          }
        case "OP": {
          const handles = OP_ARG_SPECS[d.op as string] || [];
          const args = await Promise.all(
            handles.map((h) =>
              this.evalInput(nodeId, h, nodeById, edges, scope, ctx, depth + 1),
            ),
          );
          try {
            return applyOp(d.op as string, args, scope);
          } catch (e: any) {
            this.logger.warn(`计算图 OP 节点 "${d.op}" 求值失败: ${e?.message || e}，返回 0`);
            return 0;
          }
        }
        case "VAR": {
          if (!Object.prototype.hasOwnProperty.call(scope, d.name)) {
            this.logger.warn(`计算图 VAR 节点引用了不存在的变量 "${d.name}"，返回 0`);
            return 0;
          }
          return scope[d.name];
        }
        case "CONSUMER_DEMAND":
          return await this.resolveConsumerDemandTotal(ctx);
        default:
          return 0;
      }
    }
    if (node.type === "if") {
      const cond = await this.evalInput(nodeId, "cond", nodeById, edges, scope, ctx, depth + 1);
      const h = isTruthy(cond) ? "then" : "else";
      return await this.evalInput(nodeId, h, nodeById, edges, scope, ctx, depth + 1);
    }
    return 0;
  }

  // 汇总本比赛、本产业实例所在地所属区域下的全部消费者需求数量之和。
  // 兼容两种数据约定：ConsumerDemand.region 既可能是 MapNode.region，也可能是节点名本身，
  // 故匹配 region IN (节点 region, 节点名)。所在地为空 / 找不到区域 / 无需求 → 返回 0。
  // 使用 ctx 中的缓存避免同一 recompute 周期内重复查询。
  private async resolveConsumerDemandTotal(ctx?: IndustryCalcCtx): Promise<number> {
    if (!ctx || ctx.competitionId == null || !ctx.locationNodeName) return 0;
    const nodeName = ctx.locationNodeName;

    // 初始化缓存（首次调用时创建）
    if (!ctx.nodeRegionCache) ctx.nodeRegionCache = new Map();
    if (!ctx.demandCache) ctx.demandCache = new Map();

    // 从缓存获取区域集合，或查询后缓存
    let regions = ctx.nodeRegionCache.get(nodeName);
    if (!regions) {
      const node = await this.prisma.mapNode.findFirst({
        where: {
          name: nodeName,
          ...(ctx.competitionId != null ? { competitionId: ctx.competitionId } : {}),
        },
        select: { region: true },
      });
      regions = new Set<string>([nodeName]);
      if (node?.region) regions.add(node.region);
      ctx.nodeRegionCache.set(nodeName, regions);
    }

    // 从缓存获取需求总数，或查询后缓存
    const regionsKey = [...regions].sort().join(",");
    const cacheKey = `${ctx.competitionId}:${regionsKey}`;
    if (ctx.demandCache.has(cacheKey)) {
      return ctx.demandCache.get(cacheKey)!;
    }

    const result = await this.prisma.consumerDemand.aggregate({
      where: { competitionId: ctx.competitionId, region: { in: [...regions] } },
      _sum: { quantity: true },
    });
    const total = result._sum.quantity ?? 0;
    ctx.demandCache.set(cacheKey, total);
    return total;
  }

  // 收集某节点「value 输入端口」子图中引用的 VAR 名称（用于 assign 拓扑排序）。
  private collectVarRefs(
    nodeId: string,
    nodeById: (id: string) => any,
    edges: any[],
  ): string[] {
    const out = new Set<string>();
    const visited = new Set<string>(); // 防御：子图意外成环时避免无限递归
    const walkInput = (targetNodeId: string, targetHandle: string) => {
      const key = `${targetNodeId}#${targetHandle}`;
      if (visited.has(key)) return;
      visited.add(key);
      const edge = edges.find(
        (e) => e.target === targetNodeId && e.targetHandle === targetHandle,
      );
      if (!edge) return;
      const src = nodeById(edge.source);
      if (!src) return;
      if (src.type === "value" && src.data?.kind === "VAR") {
        if (src.data.name) out.add(src.data.name);
        return;
      }
      // 递归其输出端口所连接的下游输入端口（覆盖 OP 参数、if 分支等）
      for (const h of this.outputHandlesOf(src)) walkInput(edge.source, h);
    };
    walkInput(nodeId, "value");
    return [...out];
  }

  private outputHandlesOf(node: any): string[] {
    if (node.type === "value") return ["out"];
    if (node.type === "if") return ["out"];
    return [];
  }

  /**
   * 提取图中通过 FIELD 节点读取的字段 key 列表（用于级联重算的依赖分析）。
   */
  getFieldDependencies(graph: any): string[] {
    if (!graph || !Array.isArray(graph.nodes)) return [];
    const keys = new Set<string>();
    for (const n of graph.nodes) {
      if (n.type === "value" && n.data?.kind === "FIELD" && n.data.fieldKey) {
        keys.add(n.data.fieldKey);
      }
    }
    return [...keys];
  }
}
