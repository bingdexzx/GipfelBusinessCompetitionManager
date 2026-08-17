/**
 * Gipfel 商赛系统 - 合同与产业字段 DSL 共享包
 *
 * 本包提供合同引擎和产业计算引擎共享的：
 * - 类型定义（ValueSpec, Effect, ConditionSpec 等）
 * - 配置常量（OP_ARG_SPECS, EXPR_HELPERS 等）
 * - JSON Schema（用于校验）
 *
 * 前端（Vue + Vite）和后端（NestJS）均可直接 import 本包。
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

/** 字段效果操作类型 */
export type FieldEffectOp = "ADD" | "SUB" | "SET";

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

/** 效果类型 */
export interface FieldEffect {
  kind: "FIELD";
  party: string;
  fieldKey: string;
  op: FieldEffectOp;
  value: ValueSpec;
}

export interface IfEffect {
  kind: "IF";
  cond: ValueSpec;
  then: Effect[];
  else?: Effect[];
}

export interface ForEachEffect {
  kind: "FOREACH";
  items: ValueSpec;
  var: string;
  body: Effect[];
}

export interface AssignEffect {
  kind: "ASSIGN";
  name: string;
  value: ValueSpec;
}

export type Effect = FieldEffect | IfEffect | ForEachEffect | AssignEffect;

/** 条件检查类型 */
export type ConditionKind =
  | "FIELD_COMPARE"
  | "VALUE_COMPARE"
  | "INDUSTRY_IS"
  | "DICT_COMPARE"
  | "LIST_COMPARE";

export interface ConditionSpec {
  id?: string;
  label?: string;
  errorMessage?: string;
  kind: ConditionKind;
  party?: string;
  fieldKey?: string;
  industryTypeId?: number;
  op?: CompareOp;
  value?: ValueSpec;
  value1?: ValueSpec;
  value2?: ValueSpec;
  branch?: { when: "then" | "else"; cond: ValueSpec };
}

/** 检查结果 */
export interface CheckResult {
  kind: string;
  party: string;
  label?: string;
  passed: boolean;
  actual?: any;
  expected?: any;
  detail: string;
  customError?: boolean;
  skipped?: boolean;
}

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
  // 算术
  "ADD",
  "SUB",
  "MUL",
  "DIV",
  "EXP",
  "LOG",
  "MIN",
  "MAX",
  // 比较
  "CMP_EQ",
  "CMP_NE",
  "CMP_GT",
  "CMP_LT",
  "CMP_GTE",
  "CMP_LTE",
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

// ========== 公式函数词表 ==========

/**
 * 公式编辑器支持的函数词表（用于自动补全和帮助文档）。
 * 与 safe-expression.ts 的 BUILTIN_FUNCS 对齐。
 */
export const FORMULA_FUNCTIONS = [
  { name: "abs", label: "绝对值", description: "abs(x)" },
  { name: "sqrt", label: "平方根", description: "sqrt(x)" },
  { name: "cbrt", label: "立方根", description: "cbrt(x)" },
  { name: "sign", label: "符号", description: "sign(x)" },
  { name: "floor", label: "向下取整", description: "floor(x)" },
  { name: "ceil", label: "向上取整", description: "ceil(x)" },
  { name: "round", label: "四舍五入", description: "round(x)" },
  { name: "trunc", label: "截断取整", description: "trunc(x)" },
  { name: "pow", label: "幂", description: "pow(base, exp)" },
  { name: "exp", label: "自然指数", description: "exp(x)" },
  { name: "log", label: "自然对数", description: "log(x)" },
  { name: "log2", label: "以2为底对数", description: "log2(x)" },
  { name: "log10", label: "以10为底对数", description: "log10(x)" },
  { name: "sin", label: "正弦", description: "sin(x)" },
  { name: "cos", label: "余弦", description: "cos(x)" },
  { name: "tan", label: "正切", description: "tan(x)" },
  { name: "asin", label: "反正弦", description: "asin(x)" },
  { name: "acos", label: "反余弦", description: "acos(x)" },
  { name: "atan", label: "反正切", description: "atan(x)" },
  { name: "atan2", label: "双参数反正切", description: "atan2(y, x)" },
  { name: "sinh", label: "双曲正弦", description: "sinh(x)" },
  { name: "cosh", label: "双曲余弦", description: "cosh(x)" },
  { name: "tanh", label: "双曲正切", description: "tanh(x)" },
  { name: "hypot", label: "欧几里得距离", description: "hypot(...values)" },
  { name: "mod", label: "取模", description: "mod(a, b)" },
  { name: "clamp", label: "限制范围", description: "clamp(x, lo, hi)" },
  { name: "min", label: "最小值", description: "min(...values)" },
  { name: "max", label: "最大值", description: "max(...values)" },
  { name: "sum", label: "求和", description: "sum(...values)" },
  { name: "avg", label: "平均值", description: "avg(...values)" },
];

// ========== 比较算子标签 ==========

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

/** 检查类型中文标签 */
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

// ========== JSON Schema ==========
export {
  ValueSpecSchema,
  EffectSchema,
  ConditionSpecSchema,
  PartyRoleSchema,
  InputFieldSchema,
  GraphSchema,
  ContractTypeSchema,
} from "./schema";
