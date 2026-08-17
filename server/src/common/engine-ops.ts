/**
 * 合同引擎 - 操作运算与表达式辅助函数
 *
 * 从 contract-engine.service.ts 提取的纯函数，供合同引擎和产业计算引擎共同引用。
 * 不依赖 Prisma，可独立单测。
 */

import { toNumber, deepEqual } from "../modules/contracts/engine/values";

// ========== OP 运算名 ==========

/** OP 运算名（列表 / 字典 / 通用）。 */
export const OP_NAMES = [
  // 列表
  "LIST_APPEND",
  "LIST_CONCAT",
  "LIST_LEN",
  "LIST_CONTAINS",
  "LIST_INDEX_OF",
  "LIST_UNIQUE",
  "LIST_FLATTEN",
  "LIST_SUM_OF",
  "LIST_JOIN",
  "LIST_SLICE",
  "LIST_REVERSE",
  "LIST_SORT",
  "LIST_RANGE",
  "LIST_ADD",
  "LIST_SUB",
  // 字典
  "DICT_GET",
  "DICT_KEYS",
  "DICT_VALUES",
  "DICT_ENTRIES",
  "DICT_HAS_KEY",
  "DICT_MERGE",
  "DICT_FROM_PAIRS",
  "DICT_FROM_KEYS",
  "DICT_INVERT",
  "DICT_ADD",
  "DICT_SUB",
  "DICT_APPEND",
  "DICT_SUM",
  // 通用
  "LEN",
  "CONTAINS",
  "SUM_OF",
] as const;
export type OpName = (typeof OP_NAMES)[number];

// ========== OP_ARG_SPECS（运算节点参数规格） ==========

/**
 * 运算节点参数规格：每个 op 定义其参数数量与每个参数的类型标签。
 * 用于可视化编辑器渲染端口与校验。
 */
export const OP_ARG_SPECS: Record<string, { count: number; labels: string[]; types: string[] }> = {
  // 列表
  LIST_APPEND: { count: 2, labels: ["列表", "元素"], types: ["list", "any"] },
  LIST_CONCAT: { count: 2, labels: ["列表A", "列表B"], types: ["list", "list"] },
  LIST_LEN: { count: 1, labels: ["列表"], types: ["list"] },
  LIST_CONTAINS: { count: 2, labels: ["列表", "元素"], types: ["list", "any"] },
  LIST_INDEX_OF: { count: 2, labels: ["列表", "元素"], types: ["list", "any"] },
  LIST_UNIQUE: { count: 1, labels: ["列表"], types: ["list"] },
  LIST_FLATTEN: { count: 1, labels: ["列表"], types: ["list"] },
  LIST_SUM_OF: { count: 1, labels: ["列表"], types: ["list"] },
  LIST_JOIN: { count: 2, labels: ["列表", "分隔符"], types: ["list", "string"] },
  LIST_SLICE: { count: 3, labels: ["列表", "起始", "结束"], types: ["list", "number", "number"] },
  LIST_REVERSE: { count: 1, labels: ["列表"], types: ["list"] },
  LIST_SORT: { count: 1, labels: ["列表"], types: ["list"] },
  LIST_RANGE: { count: 3, labels: ["起始", "结束", "步长"], types: ["number", "number", "number"] },
  LIST_ADD: { count: 2, labels: ["列表A", "列表B"], types: ["list", "list"] },
  LIST_SUB: { count: 2, labels: ["列表A", "列表B"], types: ["list", "list"] },
  // 字典
  DICT_GET: { count: 3, labels: ["字典", "键", "默认值"], types: ["dict", "any", "any"] },
  DICT_KEYS: { count: 1, labels: ["字典"], types: ["dict"] },
  DICT_VALUES: { count: 1, labels: ["字典"], types: ["dict"] },
  DICT_ENTRIES: { count: 1, labels: ["字典"], types: ["dict"] },
  DICT_HAS_KEY: { count: 2, labels: ["字典", "键"], types: ["dict", "any"] },
  DICT_MERGE: { count: 2, labels: ["字典A", "字典B"], types: ["dict", "dict"] },
  DICT_FROM_PAIRS: { count: 1, labels: ["键值对列表"], types: ["list"] },
  DICT_FROM_KEYS: { count: 2, labels: ["键列表", "值"], types: ["list", "any"] },
  DICT_INVERT: { count: 1, labels: ["字典"], types: ["dict"] },
  DICT_ADD: { count: 2, labels: ["字典A", "字典B"], types: ["dict", "dict"] },
  DICT_SUB: { count: 2, labels: ["字典A", "字典B"], types: ["dict", "dict"] },
  DICT_APPEND: { count: 3, labels: ["字典", "键", "值"], types: ["dict", "any", "any"] },
  DICT_SUM: { count: 1, labels: ["字典"], types: ["dict"] },
  // 通用
  LEN: { count: 1, labels: ["值"], types: ["any"] },
  CONTAINS: { count: 2, labels: ["集合", "元素"], types: ["any", "any"] },
  SUM_OF: { count: 1, labels: ["列表"], types: ["list"] },
  // 算术
  ADD: { count: 2, labels: ["加数", "被加数"], types: ["number", "number"] },
  SUB: { count: 2, labels: ["被减数", "减数"], types: ["number", "number"] },
  MUL: { count: 2, labels: ["乘数", "被乘数"], types: ["number", "number"] },
  DIV: { count: 2, labels: ["被除数", "除数"], types: ["number", "number"] },
  EXP: { count: 1, labels: ["指数"], types: ["number"] },
  LOG: { count: 2, labels: ["真数", "底数"], types: ["number", "number"] },
  MIN: { count: 2, labels: ["值A", "值B"], types: ["number", "number"] },
  MAX: { count: 2, labels: ["值A", "值B"], types: ["number", "number"] },
  // 比较
  CMP_EQ: { count: 2, labels: ["值A", "值B"], types: ["any", "any"] },
  CMP_NE: { count: 2, labels: ["值A", "值B"], types: ["any", "any"] },
  CMP_GT: { count: 2, labels: ["值A", "值B"], types: ["number", "number"] },
  CMP_LT: { count: 2, labels: ["值A", "值B"], types: ["number", "number"] },
  CMP_GTE: { count: 2, labels: ["值A", "值B"], types: ["number", "number"] },
  CMP_LTE: { count: 2, labels: ["值A", "值B"], types: ["number", "number"] },
};

// ========== EXPR_HELPERS（表达式作用域辅助函数） ==========

/**
 * 表达式作用域里的列表/字典辅助函数（"编程语言能力"）。
 * 配合安全求值器（common/safe-expression）的受限数组能力（[1,2,3]、sum…），
 * 这里补齐不擅长的字典操作与便捷函数。
 */
export const EXPR_HELPERS: Record<string, (...a: any[]) => any> = {
  len: (x: any) =>
    Array.isArray(x)
      ? x.length
      : x && typeof x === "object"
        ? Object.keys(x).length
        : x == null
          ? 0
          : String(x).length,
  push: (arr: any, ...items: any[]) => (Array.isArray(arr) ? [...arr, ...items] : [arr, ...items]),
  concat: (a: any, b: any) => [...(Array.isArray(a) ? a : [a]), ...(Array.isArray(b) ? b : [b])],
  contains: (c: any, x: any) =>
    Array.isArray(c)
      ? c.some((i) => deepEqual(i, x))
      : c && typeof c === "object"
        ? Object.keys(c).includes(x as any) || Object.values(c).some((v) => deepEqual(v, x))
        : false,
  indexIn: (arr: any, x: any) => (Array.isArray(arr) ? arr.findIndex((i) => deepEqual(i, x)) : -1),
  keys: (o: any) => (o && typeof o === "object" ? Object.keys(o) : []),
  values: (o: any) => (o && typeof o === "object" ? Object.values(o) : []),
  get: (o: any, k: any) => (o == null ? undefined : o[k]),
  has: (o: any, k: any) => o != null && o[k] !== undefined,
  hasKey: (o: any, k: any) => o != null && typeof o === "object" && k in o,
  merge: (...objs: any[]) =>
    objs.reduce(
      (acc, o) => Object.assign(acc, o && typeof o === "object" && !Array.isArray(o) ? o : {}),
      {},
    ),
  unique: (arr: any) =>
    Array.isArray(arr) ? arr.filter((v, i) => arr.findIndex((x) => deepEqual(x, v)) === i) : arr,
  flatten: (arr: any) => (Array.isArray(arr) ? arr.flat(Infinity) : arr),
  join: (arr: any, sep = ",") => (Array.isArray(arr) ? arr.map(String).join(sep) : String(arr)),
  sumOf: (arr: any) =>
    Array.isArray(arr) ? arr.reduce((s: number, x: any) => s + toNumber(x), 0) : 0,
};

// ========== applyOp（列表/字典/通用运算） ==========

/**
 * 列表/字典/通用运算（运算节点的"编程语言能力"后端落地）。
 * 每个 arg 都是已求值的原始值（数组/对象/标量），无需再递归。
 * 名字与 OP_NAMES 对应；未知 op 抛 BadRequestException。
 */
export function applyOp(op: string, args: any[], scope?: Record<string, any>): any {
  const a = args;
  const asList = (x: any) => (Array.isArray(x) ? x : x == null ? [] : [x]);
  const asDict = (x: any) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  const num = (x: any) => toNumber(x);

  switch (op) {
    // —— 列表 ——
    case "LIST_APPEND":
      return [...asList(a[0]), ...a.slice(1)];
    case "LIST_CONCAT":
      return a.flatMap((x) => asList(x));
    case "LIST_LEN":
      return Array.isArray(a[0]) ? a[0].length : Array.from(asList(a[0])).length;
    case "LIST_CONTAINS":
      return asList(a[0]).some((i) => deepEqual(i, a[1]));
    case "LIST_INDEX_OF":
      return asList(a[0]).findIndex((i) => deepEqual(i, a[1]));
    case "LIST_UNIQUE":
      return asList(a[0]).filter((v, i) => asList(a[0]).findIndex((x) => deepEqual(x, v)) === i);
    case "LIST_FLATTEN":
      return Array.isArray(a[0]) ? a[0].flat(Infinity) : asList(a[0]);
    case "LIST_SUM_OF":
      return asList(a[0]).reduce((s: number, x: any) => s + num(x), 0);
    case "LIST_JOIN":
      return asList(a[0])
        .map((x) => (x == null ? "" : String(x)))
        .join(a[1] == null ? "," : String(a[1]));
    case "LIST_SLICE": {
      const arr = asList(a[0]);
      const start = a[1] == null ? 0 : num(a[1]);
      const end = a[2] == null ? arr.length : num(a[2]);
      return arr.slice(start, end);
    }
    case "LIST_REVERSE":
      return [...asList(a[0])].reverse();
    case "LIST_SORT":
      return [...asList(a[0])].sort((x, y) => {
        const nx = num(x);
        const ny = num(y);
        if (nx !== ny) return nx - ny;
        return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
      });
    case "LIST_RANGE": {
      const start = num(a[0]);
      const stop = a[1] == null ? start : num(a[1]);
      const step = a[2] == null ? (start <= stop ? 1 : -1) : num(a[2]);
      const out: number[] = [];
      if (step === 0) return out;
      if (step > 0) for (let i = start; i < stop; i += step) out.push(i);
      else for (let i = start; i > stop; i += step) out.push(i);
      return out;
    }
    case "LIST_ADD": {
      const merged = [...asList(a[0]), ...asList(a[1])];
      return merged.filter((v: any, i: number) => merged.findIndex((x: any) => deepEqual(x, v)) === i);
    }
    case "LIST_SUB": {
      const la = asList(a[0]);
      const lb = asList(a[1]);
      return la.filter((v: any) => !lb.some((x: any) => deepEqual(x, v)));
    }
    // —— 字典 ——
    case "DICT_GET": {
      const d = asDict(a[0]);
      const k = a[1];
      return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : a[2]; // 第三个参数为默认值
    }
    case "DICT_KEYS":
      return Object.keys(asDict(a[0]));
    case "DICT_VALUES":
      return Object.values(asDict(a[0]));
    case "DICT_ENTRIES":
      return Object.entries(asDict(a[0]));
    case "DICT_HAS_KEY":
      return Object.prototype.hasOwnProperty.call(asDict(a[0]), a[1]);
    case "DICT_MERGE":
      return Object.assign({}, ...a.map((x) => asDict(x)));
    case "DICT_FROM_PAIRS":
      return asList(a[0]).reduce((acc: any, pair: any) => {
        if (Array.isArray(pair) && pair.length >= 2) acc[pair[0]] = pair[1];
        return acc;
      }, {});
    case "DICT_FROM_KEYS": {
      const keys = asList(a[0]);
      const val = a[1];
      return keys.reduce((acc: any, k: any) => {
        acc[k] = val;
        return acc;
      }, {});
    }
    case "DICT_INVERT":
      return Object.fromEntries(Object.entries(asDict(a[0])).map(([k, v]) => [String(v), k]));
    case "DICT_ADD": {
      const da = asDict(a[0]);
      const db = asDict(a[1]);
      const out: Record<string, any> = {};
      // 共有键：值相加
      for (const k of Object.keys(da)) {
        out[k] = Object.prototype.hasOwnProperty.call(db, k)
          ? num(da[k]) + num(db[k])
          : da[k]; // 仅 a 独有：保留原值
      }
      // 仅 b 独有：加入原值
      for (const k of Object.keys(db)) {
        if (!Object.prototype.hasOwnProperty.call(da, k)) out[k] = db[k];
      }
      return out;
    }
    case "DICT_SUB": {
      const da = asDict(a[0]);
      const db = asDict(a[1]);
      const out: Record<string, any> = {};
      // 共有键：值相减（a - b）
      for (const k of Object.keys(da)) {
        out[k] = Object.prototype.hasOwnProperty.call(db, k)
          ? num(da[k]) - num(db[k])
          : da[k]; // 仅 a 独有：保留原值
      }
      // 仅 b 独有：加入其值的负数
      for (const k of Object.keys(db)) {
        if (!Object.prototype.hasOwnProperty.call(da, k)) out[k] = -num(db[k]);
      }
      return out;
    }
    case "DICT_APPEND": {
      const d = asDict(a[0]);
      const k = a[1];
      const v = a[2];
      // 字典追加元素：在原字典基础上追加一个键值对（key 已存在则覆盖）
      return { ...d, [k]: v };
    }
    case "DICT_SUM": {
      // 字典求和：把字典所有键对应的值相加，输出单个数字。
      const d = asDict(a[0]);
      return Object.values(d).reduce((s: number, v: any) => s + num(v), 0);
    }
    // —— 通用（同时覆盖 LIST 的长度/包含/求和，便于单参场景）——
    case "LEN":
      return Array.isArray(a[0])
        ? a[0].length
        : a[0] && typeof a[0] === "object"
          ? Object.keys(a[0]).length
          : a[0] == null
            ? 0
            : String(a[0]).length;
    case "CONTAINS":
      return Array.isArray(a[0])
        ? a[0].some((i) => deepEqual(i, a[1]))
        : Object.prototype.hasOwnProperty.call(asDict(a[0]), a[1]) ||
            Object.values(asDict(a[0])).some((v) => deepEqual(v, a[1]));
    case "SUM_OF":
      return asList(a[0]).reduce((s: number, x: any) => s + num(x), 0);
    // —— 算术 ——
    case "ADD":
      return num(a[0]) + num(a[1]);
    case "SUB":
      return num(a[0]) - num(a[1]);
    case "MUL":
      return num(a[0]) * num(a[1]);
    case "DIV":
      return num(a[1]) === 0 ? 0 : num(a[0]) / num(a[1]);
    // —— 高级算术 ——
    case "EXP":
      return Math.exp(num(a[0])); // e^operand（自然指数）
    case "LOG": {
      const x = num(a[0]);
      const base = num(a[1]);
      // 底数缺省（未连线 → CONST 0）或 ≤ 0 时按自然对数 e 计算；否则按 ln(x)/ln(base)
      return base > 0 ? Math.log(x) / Math.log(base) : Math.log(x);
    }
    case "MIN":
      return Math.min(num(a[0]), num(a[1]));
    case "MAX":
      return Math.max(num(a[0]), num(a[1]));
    // —— 比较（返回布尔，用于 IF 条件等"输出布尔值的条件式"）——
    case "CMP_EQ":
      return deepEqual(a[0], a[1]); // 结构相等：数值 / 列表 / 字典均可
    case "CMP_NE":
      return !deepEqual(a[0], a[1]);
    case "CMP_GT":
      return num(a[0]) > num(a[1]); // 仅数值有意义；非数返回 false
    case "CMP_LT":
      return num(a[0]) < num(a[1]);
    case "CMP_GTE":
      return num(a[0]) >= num(a[1]);
    case "CMP_LTE":
      return num(a[0]) <= num(a[1]);
    default:
      throw new Error(`未知运算: ${op}`);
  }
}
