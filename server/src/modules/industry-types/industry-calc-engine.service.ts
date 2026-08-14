import { Injectable, BadRequestException } from "@nestjs/common";
import { safeEvaluate } from "../../common/safe-expression";
import {
  applyOp,
  EXPR_HELPERS,
  toNumber,
  isTruthy,
} from "../contracts/contract-engine.service";

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
 * - `if`     节点：值返回式条件分支，求 `cond`（布尔），真→`then`、假→`else` 输入端口的值。
 * - `assign` 节点：求 `value` 输入端口的值，存入运行期变量 `data.name`（供 VAR 复用，不回写字段）。
 *
 * 作用域 fieldScope：{ [fieldKey]: 已按字段类型解析的值 }。
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
  /**
   * 解析图，返回该计算字段的最终值。
   * @param graph      GGraph（calcGraph 字段存储的 JSON 解析结果）
   * @param fieldScope 本产业类型各字段现值（fieldKey → 已解析值）
   */
  evaluate(graph: any, fieldScope: Record<string, any>): any {
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
          const val = this.evalInput(a.id, "value", nodeById, edges, scope, 0);
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
    return this.evalInput(out.id, "value", nodeById, edges, scope, 0);
  }

  // 求某个「输入端口」的值：找到连到该端口的边，求值其上游输出端口。
  private evalInput(
    targetNodeId: string,
    targetHandle: string,
    nodeById: (id: string) => any,
    edges: any[],
    scope: Record<string, any>,
    depth: number,
  ): any {
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
    return this.evalOutput(edge.source, edge.sourceHandle, nodeById, edges, scope, depth + 1);
  }

  // 求某个「输出端口」的值：根据节点类型分派。
  private evalOutput(
    nodeId: string,
    handle: string,
    nodeById: (id: string) => any,
    edges: any[],
    scope: Record<string, any>,
    depth: number,
  ): any {
    if (depth > 2000) return 0; // 防御：图意外成环时避免栈溢出
    const node = nodeById(nodeId);
    if (!node) return 0;
    if (node.type === "value") {
      const d = node.data || {};
      switch (d.kind) {
        case "FIELD":
          return Object.prototype.hasOwnProperty.call(scope, d.fieldKey)
            ? scope[d.fieldKey]
            : 0;
        case "CONST":
          return parseConst(d.value);
        case "FORMULA":
          try {
            return safeEvaluate(d.expr as string, { ...scope, ...EXPR_HELPERS });
          } catch {
            return 0;
          }
        case "OP": {
          const handles = OP_ARG_SPECS[d.op as string] || [];
          const args = handles.map((h) =>
            this.evalInput(nodeId, h, nodeById, edges, scope, depth + 1),
          );
          try {
            return applyOp(d.op as string, args, scope);
          } catch {
            return 0;
          }
        }
        case "VAR":
          return Object.prototype.hasOwnProperty.call(scope, d.name)
            ? scope[d.name]
            : 0;
        default:
          return 0;
      }
    }
    if (node.type === "if") {
      const cond = this.evalInput(nodeId, "cond", nodeById, edges, scope, depth + 1);
      const h = isTruthy(cond) ? "then" : "else";
      return this.evalInput(nodeId, h, nodeById, edges, scope, depth + 1);
    }
    return 0;
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
