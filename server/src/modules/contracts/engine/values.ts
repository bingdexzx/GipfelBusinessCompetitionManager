/**
 * 合同引擎 - 值解析工具
 *
 * 从 contract-engine.service.ts 提取的纯函数，用于值类型转换和比较。
 * 不依赖 Prisma，可独立单测。
 */

// ========== 类型定义 ==========

/** 数值来源类型 */
export type ValueType =
  | "ENTITY"
  | "INPUT"
  | "CONST"
  | "FORMULA"
  | "OP"
  | "VAR"
  | "ROUTE"
  | "FIELD"
  | "INDUSTRY_IS";

/** 值规格 */
export interface ValueSpec {
  type: ValueType;
  // ENTITY
  entityType?: EntityType;
  entityRef?: string;
  attribute?: string;
  multiplyByInput?: string;
  // INPUT
  key?: string;
  // CONST
  value?: any;
  // FORMULA
  expr?: string;
  // OP
  op?: string;
  args?: ValueSpec[];
  // VAR
  name?: string;
  // ROUTE
  routeRef?: string;
  nodeIds?: number[];
  // FIELD
  party?: string;
  fieldKey?: string;
  // INDUSTRY_IS
  industryTypeId?: number;
  // 聚合端点
  aggregate?: string;
  // 路径类型过滤
  pathTypeIds?: number[];
}

/** 实体类型 */
export type EntityType =
  | "MATERIAL"
  | "PART"
  | "PRODUCT"
  | "TECH_NODE"
  | "WAREHOUSE"
  | "PRODUCTION_LINE"
  | "FUEL"
  | "VEHICLE"
  | "INFRASTRUCTURE"
  | "MAP_NODE";

/** 实体类型到 Prisma 模型名的映射 */
export const ENTITY_MODEL: Record<EntityType, string> = {
  MATERIAL: "material",
  PART: "part",
  PRODUCT: "product",
  TECH_NODE: "techNode",
  WAREHOUSE: "warehouse",
  PRODUCTION_LINE: "productionLine",
  FUEL: "fuel",
  VEHICLE: "vehicle",
  INFRASTRUCTURE: "infrastructure",
  MAP_NODE: "mapNode",
};

/** 参与方定义 */
export interface PartyDef {
  role: string;
  companyId: number | null;
  isHost?: boolean;
}

/** 求值上下文 */
export interface EvalCtx {
  competitionId?: number;
  cache?: Map<number, Map<number, { to: number; d: number }[]>>;
  parties?: Map<string, PartyDef>;
}

/** 比较操作符 */
export type CompareOp =
  | "GTE"
  | "LTE"
  | "GT"
  | "LT"
  | "EQ"
  | "CONTAINS"
  | "HAS_KEY"
  | "LEN_GTE"
  | "LEN_LTE"
  | "LEN_EQ"
  | "ELEMENT_EQ";

// ========== 纯函数工具 ==========

/** 任意值转数字（布尔/空串/非有限值兜底为 0）。 */
export function toNumber(v: any): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 真值判定：非 null、非空字符串、非零数字、非空数组 / 非空对象均视为真。 */
export function isTruthy(v: any): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

/** 把输入值规范为数字数组（支持数组、JSON 字符串数组、逗号分隔字符串）。 */
export function toNumberArray(v: any): number[] {
  const parse = (x: any) => toNumber(x);
  if (Array.isArray(v)) return v.map(parse).filter((x) => Number.isFinite(x));
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map(parse).filter((x) => Number.isFinite(x));
    } catch {
      /* 非 JSON，尝试逗号分隔 */
    }
    const parts = s
      .split(",")
      .map((t) => parse(t.trim()))
      .filter((x) => Number.isFinite(x));
    return parts;
  }
  return [];
}

/** 深度相等（数组/对象递归比较），用于 contains / 结构相等。 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/** 把标量按字段配置类型强制（NUMBER/BOOLEAN/STRING），与产业字段存储逻辑一致。 */
export function castScalar(type: string | undefined, val: any): any {
  const t = (type || "STRING").toUpperCase();
  if (t === "NUMBER") return toNumber(val);
  if (t === "BOOLEAN")
    return val === true || val === "true" || val === 1 || val === "1" || val === "是";
  if (val == null) return "";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

/** 比较操作执行 */
export function compareOp(actual: number, op: string, expected: number): boolean {
  switch (op) {
    case "GT":
      return actual > expected;
    case "LT":
      return actual < expected;
    case "EQ":
      return actual === expected;
    case "LTE":
      return actual <= expected;
    case "GTE":
    default:
      return actual >= expected;
  }
}

/** 比较算子中文标签（用于检查详情展示）。 */
export const COMPARE_OP_LABEL: Record<string, string> = {
  GTE: "≥",
  LTE: "≤",
  GT: ">",
  LT: "<",
  EQ: "=",
  CONTAINS: "包含",
  HAS_KEY: "含键",
  LEN_GTE: "长度≥",
  LEN_LTE: "长度≤",
  LEN_EQ: "长度=",
  ELEMENT_EQ: "元素相等",
};

/** 检查类型原始枚举 → 中文显示名 */
export const COND_KIND_LABEL: Record<string, string> = {
  VALUE_COMPARE: "数值比较",
  FIELD_COMPARE: "字段比较",
  INDUSTRY_IS: "产业类型核对",
  DICT_COMPARE: "字典比较",
  LIST_COMPARE: "列表比较",
  ACCOUNT_COMPARE: "账户比较",
  INVENTORY_GTE: "库存下限",
  ASSET_OWNED: "资产持有",
  VEHICLE_COUNT: "载具数量",
  VEHICLE_LOCATION: "载具位置",
  TECH_COMPLETED: "科技完成",
  INFRA_ACTIVE: "基建启用",
  INFRA_LIST_FILTER: "基建范围校验",
  VEHICLE_LIST_FILTER: "载具范围校验",
};

export function condKindLabel(kind: string): string {
  return COND_KIND_LABEL[kind] || kind;
}

/** 安全解析 JSON 字符串 */
export function safeParse(raw: string, label: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} 不是有效的 JSON`);
  }
}
