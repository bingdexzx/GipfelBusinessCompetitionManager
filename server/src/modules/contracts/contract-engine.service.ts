import { Injectable, BadRequestException } from "@nestjs/common";
import { safeEvaluate } from "../../common/safe-expression";
import { PrismaService } from "../../prisma/prisma.service";

// 数据管理实体类型 → Prisma 模型名（用于 ENTITY 取值时按 id 读取真实属性）。
// 仅保留可被「产业字段效果」引用的主数据实体（数值来源），不再涉及任何公司子资源表。
type EntityType =
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

const ENTITY_MODEL: Record<EntityType, string> = {
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

interface PartyDef {
  role: string;
  companyId: number | null;
  isHost?: boolean;
}

// 数值来源：
//  - ENTITY：从数据管理实体读取真实属性（如 Material.nodePrices），可再乘以某输入字段
//  - INPUT：用户创建合同时手动填写
//  - CONST：常量（可为数字、字符串，或数组/对象——JSON 字符串会自动解析）
//  - FORMULA：受限安全表达式（见 common/safe-expression），作用域为 inputs
//  - OP：列表/字典运算（递归表达 op + args，每个 arg 又是一个 ValueSpec）
//  - VAR：变量引用（取自运行期 scope，如 FOREACH 循环变量 / ASSIGN 赋值结果）
//  - ROUTE：地图路程（按创建合同时用户选择的节点路径求相邻节点最短路之和）
//  - FIELD：产业字段现值（读取某参与方公司当前的 CompanyFieldValue，与 FIELD 效果互为读写两端）
interface ValueSpec {
  type: "ENTITY" | "INPUT" | "CONST" | "FORMULA" | "OP" | "VAR" | "ROUTE" | "FIELD" | "INDUSTRY_IS";
  // ENTITY
  entityType?: EntityType;
  entityRef?: string; // inputs 中存放实体 id 的字段 key
  attribute?: string; // 读取实体的哪个属性，如 price / researchCost / pricePerLiter
  multiplyByInput?: string; // 可选：再乘以某输入字段（如 quantity）
  // INPUT
  key?: string;
  // CONST（可为数字、字符串，或数组/对象——JSON 字符串会自动解析）
  value?: any;
  // FORMULA
  expr?: string;
  // OP（列表/字典运算）
  op?: string; // 运算名，见 applyOp
  args?: ValueSpec[]; // 递归参数，每个又是一个 ValueSpec
  // VAR（变量引用）
  name?: string; // 变量名，取自运行期 scope（回退 inputs）
  // ROUTE（地图路程，输入源）：节点路径来自创建合同时用户选择的输入项（type=nodeRoute）
  routeRef?: string; // inputs 中存放节点 id 有序列表的字段 key
  nodeIds?: number[]; // 兼容旧数据：设计期固定的节点 id（已废弃，改用 routeRef）
  // FIELD（产业字段现值，数据源）：读取某参与方公司当前的产业字段值
  party?: string; // 参与方角色（对应 contract.parties 中的 role）
  fieldKey?: string; // IndustryField.fieldKey
  // INDUSTRY_IS（产业类型判断，布尔值源）：company.industryTypeId === industryTypeId
  industryTypeId?: number;
}

// 求值的运行期上下文：
//  - 地图路程（ROUTE）：按比赛隔离地图，并缓存邻接表避免重复查询
//  - 产业字段现值（FIELD）：需要按参与方角色定位公司
interface EvalCtx {
  competitionId?: number;
  cache?: Map<number, Map<number, { to: number; d: number }[]>>;
  parties?: Map<string, PartyDef>; // role -> 参与方（FIELD 取值用）
}

// OP 运算名（列表 / 字典 / 通用）。
// 这些名字同时作为可视化编辑器运算节点的下拉选项（字符串稳定，勿改大小写语义）。
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

// 产业字段效果：改写公司在其产业类型下的自定义字段值（CompanyFieldValue）。
// 字段以 fieldKey 定位，公司所属产业类型决定实际的 IndustryField 记录。
// 这是合同引擎唯一允许改写的目标（账户/库存/科技/资产等已全部移除）。
interface FieldEffect {
  kind: "FIELD";
  party: string;
  fieldKey: string; // IndustryField.fieldKey
  op: "ADD" | "SUB" | "SET";
  value: ValueSpec;
}
// 控制流效果：让 effects 从扁平列表升级为可嵌套的结构化程序。
//  - IF：按条件在 then / else 两条分支中选择执行
//  - FOREACH：遍历列表，每次迭代把元素写入循环变量后执行 body
//  - ASSIGN：把某 ValueSpec 求值结果写入运行期变量（供 VAR 引用）
interface IfEffect {
  kind: "IF";
  cond: ValueSpec;
  then: Effect[];
  else?: Effect[];
}
interface ForEachEffect {
  kind: "FOREACH";
  items: ValueSpec; // 求值为数组
  var: string; // 循环变量名（在 body 内用 VAR 引用）
  body: Effect[];
}
interface AssignEffect {
  kind: "ASSIGN";
  name: string; // 变量名
  value: ValueSpec;
}
type Effect = FieldEffect | IfEffect | ForEachEffect | AssignEffect;

// 前置检查类型：合同执行前对公司状态的核验（仅产业字段 / 产业类型）。
// 任一检查不过则中止执行。
type CompareOp =
  | "GTE"
  | "LTE"
  | "GT"
  | "LT"
  | "EQ"
  | "CONTAINS" // 列表含元素 / 字典含键值
  | "HAS_KEY" // 字典含指定键
  | "LEN_GTE"
  | "LEN_LTE"
  | "LEN_EQ"
  | "ELEMENT_EQ"; // 列表元素结构相等（仅 LIST_COMPARE 用）
export interface ConditionSpec {
  id?: string;
  label?: string;
  errorMessage?: string; // 检查不通过时展示给用户的错误信息（留空则用系统默认说明）
  kind:
    | "FIELD_COMPARE" // 产业字段比较：fieldKey + op + value（兼容旧版，左操作数固定为某参与方字段）
    | "VALUE_COMPARE" // 数值互相比较：value1 op value2，两操作数都是自由数值源
    | "INDUSTRY_IS" // 参与方是否属于指定产业类型：industryTypeId
    | "DICT_COMPARE" // 两个字典互相比较：value1 的键须全部∈ value2 的键；满足后逐键 value1[k] op value2[k]
    | "LIST_COMPARE"; // 两个列表互相比较：value1/value2 均为列表，op∈{ELEMENT_EQ,CONTAINS,GT,GTE,EQ}
  party?: string; // 参与方角色（FIELD_COMPARE / INDUSTRY_IS 用；VALUE_COMPARE / DICT_COMPARE 无参与方）
  fieldKey?: string;
  industryTypeId?: number;
  op?: CompareOp;
  value?: ValueSpec; // FIELD_COMPARE 的右操作数
  value1?: ValueSpec; // VALUE_COMPARE / DICT_COMPARE / LIST_COMPARE 左操作数
  value2?: ValueSpec; // VALUE_COMPARE / DICT_COMPARE / LIST_COMPARE 右操作数
  // 控制流：若本检查挂在某个 IF 分支之下，仅当该分支条件成立时才执行；
  // when = "then" 表示 IF 条件为真时执行，"else" 表示 IF 条件为假时执行。cond 为 IF 的条件值源。
  branch?: { when: "then" | "else"; cond: ValueSpec };
}

export interface CheckResult {
  kind: string;
  party: string;
  label?: string;
  passed: boolean;
  actual?: any;
  expected?: any;
  detail: string;
  customError?: boolean; // 是否使用了该检查自定义的错误信息（展示时不再拼接 label 前缀）
  skipped?: boolean; // 因所属 IF 分支未触发而被跳过（不阻塞执行）
}

function compareOp(actual: number, op: CompareOp, expected: number): boolean {
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
const COMPARE_OP_LABEL: Record<string, string> = {
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

/** 检查类型原始枚举 → 中文显示名（避免错误提示/结果表中直接出现 VALUE_COMPARE 等原始 kind）。 */
const COND_KIND_LABEL: Record<string, string> = {
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
function condKindLabel(kind: string): string {
  return COND_KIND_LABEL[kind] || kind;
}

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
function castScalar(type: string | undefined, val: any): any {
  const t = (type || "STRING").toUpperCase();
  if (t === "NUMBER") return toNumber(val);
  if (t === "BOOLEAN")
    return val === true || val === "true" || val === 1 || val === "1" || val === "是";
  if (val == null) return "";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

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

/**
 * 统一的数值来源求值（替代 execute/runConditions 中重复的两份实现）。
 * 返回 any：数字场景用 toNumber 兜底；列表/字典场景直接返回数组/对象。
 * @param scope 运行期变量表（供 VAR 引用 / OP 内部解析），缺省时回退 inputs。
 */
export async function evalValueSpec(
  spec: ValueSpec,
  inputs: Record<string, any>,
  prisma: any,
  scope?: Record<string, any>,
  ctx?: EvalCtx,
): Promise<any> {
  if (!spec || typeof spec !== "object") return toNumber(spec);
  if (spec.type === "CONST") {
    let v: any = spec.value;
    if (typeof v === "string") {
      const s = v.trim();
      if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
        try {
          v = JSON.parse(s);
        } catch {
          /* 保留原字符串 */
        }
      }
    }
    return v === undefined ? null : v;
  }
  if (spec.type === "INPUT") {
    const raw = inputs[spec.key as string];
    // 原料清单输入源的「碳排放合计」端点：按比赛查每种原料碳排放系数 × 数量 求和。
    if ((spec as any).aggregate === "CARBON") {
      return computeMaterialListCarbon(raw, ctx?.competitionId, prisma);
    }
    // 节点列表输入源的「路程」端点：按比赛查相邻节点最短路距离之和。
    if ((spec as any).aggregate === "ROUTE_DISTANCE") {
      return computeRouteDistance(
        toNumberArray(raw),
        ctx?.competitionId,
        ctx?.cache,
        prisma,
      );
    }
    // 节点列表输入源的「存在的路径类型」端点：按比赛查与任一路点相连的边，
    // 取这些边所用路径类型名称，组成去重后的字符串列表。
    if ((spec as any).aggregate === "ROUTE_PATH_TYPES") {
      return computeRoutePathTypes(toNumberArray(raw), ctx?.competitionId, prisma);
    }
    // 零件清单输入源的「所需原料」端点：按比赛展开每个零件配比 → {原料: 总数量} 字典。
    if ((spec as any).aggregate === "PART_MATERIALS") {
      return computePartMaterials(raw, ctx?.competitionId, prisma);
    }
    // 产品清单输入源的「需要的零件」端点：按比赛展开每个产品配比 → {零件: 总数量} 字典。
    if ((spec as any).aggregate === "PRODUCT_PARTS") {
      return computeProductParts(raw, ctx?.competitionId, prisma);
    }
    // 零件清单输入源的「所需的科技节点」端点：按比赛查清单中每个零件的科技需求节点名，去重返回列表。
    if ((spec as any).aggregate === "PART_TECH_NODES") {
      return computePartTechNodes(raw, ctx?.competitionId, prisma);
    }
    // 产品清单输入源的「所需的科技节点」端点：按比赛查清单中每个产品的科技需求节点名，去重返回列表。
    if ((spec as any).aggregate === "PRODUCT_TECH_NODES") {
      return computeProductTechNodes(raw, ctx?.competitionId, prisma);
    }
    // 原料清单输入源的「原料总价格」端点：按比赛查每种原料 价格 × 数量 求和。
    // 若 spec.party 指定了参与方，则按该参与方产业类型的「所在地」节点价格筛选（地点价优先，缺则回退基础价）。
    if ((spec as any).aggregate === "PRICE") {
      const locNode = spec.party
        ? await resolvePartyLocationNodeId(spec.party as string, ctx, prisma)
        : null;
      return computeMaterialListPrice(raw, ctx?.competitionId, prisma, locNode ?? undefined);
    }
    // 原料清单输入源的「原料总数量」端点：直接把清单字典各原料的数量相加求和。
    if ((spec as any).aggregate === "MATERIAL_TOTAL_QTY") {
      return computeTotalQty(raw);
    }
    // 零件清单输入源的「零件总件数」端点：直接把清单字典各零件的数量相加求和。
    if ((spec as any).aggregate === "PART_TOTAL_QTY") {
      return computeTotalQty(raw);
    }
    // 产品清单输入源的「产品总件数」端点：直接把清单字典各产品的数量相加求和。
    if ((spec as any).aggregate === "PRODUCT_TOTAL_QTY") {
      return computeTotalQty(raw);
    }
    // 燃料清单输入源的「燃料总数量」端点：直接把清单字典各燃料的数量相加求和。
    if ((spec as any).aggregate === "FUEL_TOTAL_QTY") {
      return computeTotalQty(raw);
    }
    // 载具清单输入源的「载具总价格」端点：按比赛查每种载具 price × 数量 求和。
    if ((spec as any).aggregate === "VEHICLE_TOTAL_PRICE") {
      return computeVehicleTotalPrice(raw, ctx?.competitionId, prisma);
    }
    // 载具清单输入源的「载具总载货量」端点：按比赛查每种载具 maxCargo × 数量 求和。
    if ((spec as any).aggregate === "VEHICLE_CARGO") {
      return computeVehicleTotalCargo(raw, ctx?.competitionId, prisma);
    }
    // 载具清单输入源的「总每公里油耗」端点：按比赛查每种载具 fuelConsumptionPerKm × 数量 求和。
    if ((spec as any).aggregate === "VEHICLE_FUEL_PER_KM") {
      return computeVehicleTotalFuelPerKm(raw, ctx?.competitionId, prisma);
    }
    // 载具清单输入源的「总碳排数」端点：按比赛查每种载具 carbonEmission × 数量 求和（不乘每公里油耗）。
    if ((spec as any).aggregate === "VEHICLE_CARBON") {
      return computeVehicleTotalCarbon(raw, ctx?.competitionId, prisma);
    }
    // 燃料清单输入源的「燃料总价格」端点：按比赛查每种燃料 pricePerLiter × 数量 求和。
    if ((spec as any).aggregate === "FUEL_TOTAL_PRICE") {
      return computeFuelTotalPrice(raw, ctx?.competitionId, prisma);
    }
    // 仓库清单输入源的「每种种类的仓库总存储量」端点：按 type 聚合 Σ(capacity × 数量)。
    if ((spec as any).aggregate === "WAREHOUSE_STORAGE") {
      return computeWarehouseTotalStorage(raw, ctx?.competitionId, prisma);
    }
    // 仓库清单输入源的「仓库总价格」端点：按比赛查每种仓库 price × 数量 求和。
    if ((spec as any).aggregate === "WAREHOUSE_TOTAL_PRICE") {
      return computeWarehouseTotalPrice(raw, ctx?.competitionId, prisma);
    }
    // 基建清单输入源的 8 个聚合端点：各为 Σ(数值字段 × 数量) 的浮点数。
    if ((spec as any).aggregate === "INFRA_PRICE")
      return computeInfraTotal(raw, ctx?.competitionId, prisma, "price");
    if ((spec as any).aggregate === "INFRA_FOOTPRINT")
      return computeInfraTotal(raw, ctx?.competitionId, prisma, "footprint");
    if ((spec as any).aggregate === "INFRA_EMPLOYMENT")
      return computeInfraTotal(raw, ctx?.competitionId, prisma, "employmentRateBonus");
    if ((spec as any).aggregate === "INFRA_POPULATION")
      return computeInfraTotal(raw, ctx?.competitionId, prisma, "populationBonus");
    if ((spec as any).aggregate === "INFRA_HIGHQUALITY")
      return computeInfraTotal(raw, ctx?.competitionId, prisma, "highQualityPopulationBonus");
    if ((spec as any).aggregate === "INFRA_HAPPINESS")
      return computeInfraTotal(raw, ctx?.competitionId, prisma, "happinessIndexBonus");
    if ((spec as any).aggregate === "INFRA_INCOME")
      return computeInfraTotal(raw, ctx?.competitionId, prisma, "perCapitaIncomeBonus");
    if ((spec as any).aggregate === "INFRA_CARBON")
      return computeInfraTotal(raw, ctx?.competitionId, prisma, "carbonReductionBonus");
    // 基建清单输入源的「基建启用总费用」端点：按比赛查每种基建 activationPrice × 数量 求和。
    if ((spec as any).aggregate === "INFRA_ACTIVATION_PRICE")
      return computeInfraTotal(raw, ctx?.competitionId, prisma, "activationPrice");
    // 科技树节点输入源的「前置节点」端点：按比赛查该科技节点的前置依赖节点名列表。
    if ((spec as any).aggregate === "TECH_PREREQUISITES")
      return computeTechPrerequisites(raw, ctx?.competitionId, prisma);
    // 科技树节点输入源的「研发费用」端点：按比赛查该科技节点的 researchCost。
    if ((spec as any).aggregate === "TECH_RESEARCH_COST")
      return computeTechResearchCost(raw, ctx?.competitionId, prisma);
    return raw === undefined ? ((spec as any).default ?? null) : raw;
  }
  if (spec.type === "VAR") {
    const name = spec.name as string;
    if (scope && Object.prototype.hasOwnProperty.call(scope, name)) return scope[name];
    const v = inputs[name];
    return v === undefined ? null : v;
  }
  if (spec.type === "OP") {
    const args = await Promise.all(
      (spec.args || []).map((a) => evalValueSpec(a, inputs, prisma, scope, ctx)),
    );
    return applyOp(spec.op as string, args, scope);
  }
  if (spec.type === "FORMULA") {
    const scope2 = { ...inputs, ...EXPR_HELPERS, ...(scope || {}) };
    try {
      return safeEvaluate(spec.expr as string, scope2);
    } catch (e) {
      throw new BadRequestException(`公式求值失败: ${(e as Error).message}`);
    }
  }
  if (spec.type === "ROUTE") {
    const ids = toNumberArray(inputs[spec.routeRef as string]);
    return computeRouteDistance(ids, ctx?.competitionId, ctx?.cache, prisma);
  }
  if (spec.type === "FIELD") {
    return readCompanyFieldValue(spec.party as string, spec.fieldKey as string, ctx, prisma);
  }
  if (spec.type === "INDUSTRY_IS") {
    // 布尔值源：判断某参与方公司所属产业类型是否等于 industryTypeId。
    // 与"前置检查 INDUSTRY_IS"语义一致，但此处返回布尔，供 IF.cond 等组合使用。
    const party = ctx?.parties?.get(spec.party as string);
    if (!party) return false; // 合同中不存在该参与方 → 视为不满足
    if (party.isHost || party.companyId == null) return false; // 主办方/未绑定公司 → 不满足
    const company = await prisma.company.findUnique({
      where: { id: party.companyId },
      select: { industryTypeId: true },
    });
    return !!company?.industryTypeId && company.industryTypeId === Number(spec.industryTypeId);
  }
  if (spec.type === "ENTITY") {
    const id = toNumber(inputs[spec.entityRef as string]);
    if (!id) return 0;
    const model = ENTITY_MODEL[spec.entityType as EntityType];
    if (!model) throw new BadRequestException(`未知实体类型: ${spec.entityType}`);
    const ent = await prisma[model].findUnique({ where: { id } });
    if (!ent) throw new BadRequestException(`实体不存在(${spec.entityType}#${id})`);
    let v = toNumber(ent[spec.attribute as string]);
    if (spec.multiplyByInput) v = v * toNumber(inputs[spec.multiplyByInput]);
    return v;
  }
  return 0;
}

/**
 * 原料清单碳排放合计：给定 {"原料名称": 数量} 字典，按比赛查询每种原料的
 * carbonEmissionCoefficient，返回 Σ(系数 × 数量)。
 * - 字典为空 / 非对象：返回 0（避免合同算错，也兼容未填清单）。
 * - competitionId 缺失：抛错（无法按名隔离查询原料）。
 * - 字典中名称在当前比赛找不到对应原料：该原料系数按 0 计（不报错，数量仍可计入 0）。
 */
async function computeMaterialListCarbon(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算原料清单碳排放缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const materials: any[] = await prisma.material.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, carbonEmissionCoefficient: true },
  });
  const coeffByName = new Map(
    materials.map((m) => [m.name as string, Number(m.carbonEmissionCoefficient) || 0]),
  );
  let total = 0;
  for (const [name, q] of entries) {
    total += (coeffByName.get(name) ?? 0) * Number(q);
  }
  return total;
}

/**
 * 原料清单总价格：给定 {"原料名称": 数量} 字典，按比赛查询每种原料的「价格(price)」，
 * 将「价格 × 数量」求和，返回单个浮点数（总价格）。
 * - locationNodeId 提供时：优先采用该原料在 Material.nodePrices 中对应节点的「地点价」，
 *   该节点无记录则回退基础 price（若连基础价也没有则按 0 计）。
 * - 字典为空 / 非对象：返回 0。
 * - competitionId 缺失：抛错（无法按名隔离查询原料）。
 * - 字典中名称在当前比赛找不到对应原料：该原料价格按 0 计（不报错，数量不计）。
 */
async function computeMaterialListPrice(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
  locationNodeId?: number,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算原料清单总价格缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const materials: any[] = await prisma.material.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, nodePrices: true },
  });
  const byName = new Map(materials.map((m) => [m.name as string, m]));
  // 预解析地点价表（一次解析，循环内复用）
  const nodePricesMap: Record<string, number> = {};
  if (locationNodeId != null) {
    for (const m of materials) {
      let np: any = {};
      try {
        np = m.nodePrices ? JSON.parse(m.nodePrices) : {};
      } catch {
        np = {};
      }
      const loc = np[String(locationNodeId)];
      if (typeof loc === "number") nodePricesMap[m.name as string] = loc;
    }
  }
  let total = 0;
  for (const [name, q] of entries) {
    const m = byName.get(name);
    const price =
      m != null && locationNodeId != null && name in nodePricesMap
        ? nodePricesMap[name]
        : 0;
    total += price * Number(q);
  }
  return total;
}

/**
 * 清单总数量：给定 {"名称": 数量} 字典，直接把各条目数量相加求和，返回单个浮点数。
 * 原料清单「原料总数量」/ 零件清单「零件总件数」/ 产品清单「产品总件数」三个端口共用。
 * - 字典为空 / 非对象：返回 0。
 * - 数量统一用 toNumber 兜底（非数字按 0），负数量也会如实累加（与价格/碳排放等一致）。
 */
function computeTotalQty(raw: any): number {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  let total = 0;
  for (const v of Object.values(raw)) {
    total += toNumber(v);
  }
  return total;
}

/**
 * 解析某参与方所在节点的 ID：参与方角色 → 公司 → 产业类型 → 「所在地」字段(companyFieldValue) → 地图节点。
 * 「所在地」字段存的是地图节点名称（字符串），再按当前比赛匹配 MapNode 得到其 id。
 * 主办方(isHost)、未绑定公司、产业类型无「所在地」字段、字段未填写、或找不到对应节点：返回 null
 * （调用方回退为 0：无基础价格，地点价缺失即按 0 计）。
 */
async function resolvePartyLocationNodeId(
  role: string,
  ctx: EvalCtx | undefined,
  prisma: any,
): Promise<number | null> {
  const party = ctx?.parties?.get(role);
  if (!party || party.isHost || party.companyId == null) return null;
  const company = await prisma.company.findUnique({
    where: { id: party.companyId },
    select: { industryTypeId: true },
  });
  if (!company?.industryTypeId) return null;
  const field = await prisma.industryField.findUnique({
    where: {
      industryTypeId_fieldKey: { industryTypeId: company.industryTypeId, fieldKey: "location" },
    },
    select: { id: true },
  });
  if (!field) return null;
  const cfv = await prisma.companyFieldValue.findUnique({
    where: { companyId_industryFieldId: { companyId: party.companyId, industryFieldId: field.id } },
  });
  const nodeName = cfv?.value;
  if (!nodeName) return null;
  const node = await prisma.mapNode.findFirst({
    where: { competitionId: ctx?.competitionId, name: nodeName },
    select: { id: true },
  });
  return node?.id ?? null;
}

/**
 * 零件清单所需原料字典：给定 {"零件名称": 数量} 字典，按比赛查询每个零件的配比
 * (PartMaterial: material → ratio)，将「数量 × ratio」按原料累加，返回
 * {"原料名称": 总数量} 字典。
 * - 字典为空 / 非对象：返回空字典 {}（无原料需求）。
 * - competitionId 缺失：抛错（无法按名隔离查询零件/原料）。
 * - 字典中名称在当前比赛找不到对应零件：该零件跳过（不报错，数量不计）。
 * - 某零件配比里引用的原料名称查不到：该条目跳过（不报错）。
 */
async function computePartMaterials(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<Record<string, number>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return {};
  if (!competitionId) {
    throw new BadRequestException("计算零件所需原料缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const parts: any[] = await prisma.part.findMany({
    where: { competitionId, name: { in: names } },
    select: {
      name: true,
      partMaterials: {
        select: { ratio: true, material: { select: { name: true } } },
      },
    },
  });
  const partByName = new Map(parts.map((p) => [p.name as string, p]));
  const result: Record<string, number> = {};
  for (const [pname, q] of entries) {
    const part = partByName.get(pname);
    if (!part) continue;
    const qty = Number(q);
    for (const pm of part.partMaterials || []) {
      const mname = pm.material?.name;
      if (!mname) continue;
      result[mname] = (result[mname] || 0) + (Number(pm.ratio) || 0) * qty;
    }
  }
  return result;
}

/**
 * 产品清单所需零件：给定 {"产品名称": 数量} 字典，按比赛查询每个产品的
 * productParts（ratio + 零件名），将「数量 × ratio」按零件名累加，输出 {零件名称: 总数量}。
 * 与 computePartMaterials 对称（零件→原料），本函数为 产品→零件。
 */
async function computeProductParts(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<Record<string, number>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return {};
  if (!competitionId) {
    throw new BadRequestException("计算产品所需零件缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const products: any[] = await prisma.product.findMany({
    where: { competitionId, name: { in: names } },
    select: {
      name: true,
      productParts: {
        select: { ratio: true, part: { select: { name: true } } },
      },
    },
  });
  const productByName = new Map(products.map((p) => [p.name as string, p]));
  const result: Record<string, number> = {};
  for (const [pname, q] of entries) {
    const prod = productByName.get(pname);
    if (!prod) continue;
    const qty = Number(q);
    for (const pp of prod.productParts || []) {
      const partName = pp.part?.name;
      if (!partName) continue;
      result[partName] = (result[partName] || 0) + (Number(pp.ratio) || 0) * qty;
    }
  }
  return result;
}

/**
 * 零件清单所需科技节点：给定 {"零件名称": 数量} 字典，按比赛查询每个零件的
 * 科技需求（PartTechRequirement.techNode），收集这些科技节点的名称，
 * 去重后返回字符串数组（保持首次出现顺序）。
 * - 字典为空 / 非对象：返回空数组 []。
 * - competitionId 缺失：抛错（无法按名隔离查询零件）。
 * - 字典中名称在当前比赛找不到对应零件：该零件跳过（不报错）。
 */
async function computePartTechNodes(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const names = Object.keys(raw).filter((n) => Number(raw[n]) > 0);
  if (!names.length) return [];
  if (!competitionId) {
    throw new BadRequestException("计算零件所需科技节点缺少比赛上下文（competitionId）");
  }
  const parts: any[] = await prisma.part.findMany({
    where: { competitionId, name: { in: names } },
    select: {
      techRequirements: { select: { techNode: { select: { name: true } } } },
    },
  });
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    for (const tr of part.techRequirements || []) {
      const tn = tr?.techNode?.name;
      if (tn && !seen.has(tn)) {
        seen.add(tn);
        result.push(tn);
      }
    }
  }
  return result;
}

/**
 * 产品清单所需科技节点：给定 {"产品名称": 数量} 字典，按比赛查询每个产品的
 * 科技需求（ProductTechRequirement.techNode），收集这些科技节点的名称，
 * 去重后返回字符串数组（保持首次出现顺序）。
 * 与 computePartTechNodes 对称（零件→科技节点 / 产品→科技节点）。
 */
async function computeProductTechNodes(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const names = Object.keys(raw).filter((n) => Number(raw[n]) > 0);
  if (!names.length) return [];
  if (!competitionId) {
    throw new BadRequestException("计算产品所需科技节点缺少比赛上下文（competitionId）");
  }
  const products: any[] = await prisma.product.findMany({
    where: { competitionId, name: { in: names } },
    select: {
      techRequirements: { select: { techNode: { select: { name: true } } } },
    },
  });
  const seen = new Set<string>();
  const result: string[] = [];
  for (const prod of products) {
    for (const tr of prod.techRequirements || []) {
      const tn = tr?.techNode?.name;
      if (tn && !seen.has(tn)) {
        seen.add(tn);
        result.push(tn);
      }
    }
  }
  return result;
}

/**
 * 基建清单聚合：给定 {"基建名称": 数量} 字典，按比赛查询每种基建的指定数值字段，
 * 返回 Σ(字段值 × 数量) 的浮点数（总价格 / 总占地 / 各加成等）。
 * - 字典为空 / 非对象：返回 0。
 * - competitionId 缺失：抛错（无法按名隔离查询基建）。
 * - 字典中名称在当前比赛找不到对应基建：该项按 0 计（不报错，数量不计）。
 * field 为 Infrastructure 模型上的数值字段名（如 price / footprint / employmentRateBonus …）。
 */
async function computeInfraTotal(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
  field: string,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算基建清单聚合缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const infrastructures: any[] = await prisma.infrastructure.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, [field]: true },
  });
  const valueByName = new Map(
    infrastructures.map((x) => [x.name as string, Number(x[field]) || 0]),
  );
  let total = 0;
  for (const [name, q] of entries) {
    total += (valueByName.get(name) ?? 0) * Number(q);
  }
  return total;
}

/**
 * 载具清单「载具总价格」聚合：Σ(载具价格[Float] × 数量)，逻辑与 computeInfraTotal 对称，
 * 只是查询 vehicle 模型的 price 字段。
 * - raw：清单字典 {载具名称: 数量}；仅数量 > 0 的条目参与。
 * - competitionId 缺失：抛错（无法按名隔离查询载具）。
 * - 字典中名称在当前比赛找不到对应载具：该项按 0 计（不报错，数量不计）。
 */
async function computeVehicleTotalPrice(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算载具清单总价格缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const vehicles: any[] = await prisma.vehicle.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, price: true },
  });
  const priceByName = new Map(
    vehicles.map((x) => [x.name as string, Number(x.price) || 0]),
  );
  let total = 0;
  for (const [name, q] of entries) {
    total += (priceByName.get(name) ?? 0) * Number(q);
  }
  return total;
}

/**
 * 载具清单「载具总载货量」聚合：Σ(载具载货量[maxCargo] × 数量)，逻辑与 computeVehicleTotalPrice 对称，
 * 只是查询 vehicle 模型的 maxCargo 字段。
 * - raw：清单字典 {载具名称: 数量}；仅数量 > 0 的条目参与。
 * - competitionId 缺失：抛错（无法按名隔离查询载具）。
 * - 字典中名称在当前比赛找不到对应载具：该项按 0 计（不报错，数量不计）。
 */
async function computeVehicleTotalCargo(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算载具清单总载货量缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const vehicles: any[] = await prisma.vehicle.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, maxCargo: true },
  });
  const cargoByName = new Map(
    vehicles.map((x) => [x.name as string, Number(x.maxCargo) || 0]),
  );
  let total = 0;
  for (const [name, q] of entries) {
    total += (cargoByName.get(name) ?? 0) * Number(q);
  }
  return total;
}

/**
 * 载具清单「总每公里油耗」聚合：Σ(载具每公里油耗[fuelConsumptionPerKm] × 数量)，逻辑与 computeVehicleTotalPrice 对称，
 * 只是查询 vehicle 模型的 fuelConsumptionPerKm 字段。
 * - raw：清单字典 {载具名称: 数量}；仅数量 > 0 的条目参与。
 * - competitionId 缺失：抛错（无法按名隔离查询载具）。
 * - 字典中名称在当前比赛找不到对应载具：该项按 0 计（不报错，数量不计）。
 */
async function computeVehicleTotalFuelPerKm(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算载具清单总每公里油耗缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const vehicles: any[] = await prisma.vehicle.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, fuelConsumptionPerKm: true },
  });
  const fuelByName = new Map(
    vehicles.map((x) => [x.name as string, Number(x.fuelConsumptionPerKm) || 0]),
  );
  let total = 0;
  for (const [name, q] of entries) {
    total += (fuelByName.get(name) ?? 0) * Number(q);
  }
  return total;
}

/**
 * 载具清单「总碳排数」聚合：Σ(载具碳排放系数[carbonEmission] × 数量)（不乘每公里油耗），
 * 逻辑与 computeVehicleTotalPrice 对称，只是查询 vehicle 模型的 carbonEmission 字段。
 * - raw：清单字典 {载具名称: 数量}；仅数量 > 0 的条目参与。
 * - competitionId 缺失：抛错（无法按名隔离查询载具）。
 * - 字典中名称在当前比赛找不到对应载具：该项按 0 计（不报错，数量不计）。
 */
async function computeVehicleTotalCarbon(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算载具清单总碳排数缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const vehicles: any[] = await prisma.vehicle.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, carbonEmission: true },
  });
  const carbonByName = new Map(
    vehicles.map((x) => [x.name as string, Number(x.carbonEmission) || 0]),
  );
  let total = 0;
  for (const [name, q] of entries) {
    total += (carbonByName.get(name) ?? 0) * Number(q);
  }
  return total;
}

/**
 * 燃料清单「燃料总价格」聚合：Σ(燃料每升价格[pricePerLiter] × 数量)，逻辑与 computeVehicleTotalPrice 对称，
 * 只是查询 fuel 模型的 pricePerLiter 字段。
 * - raw：清单字典 {燃料名称: 数量}；仅数量 > 0 的条目参与。
 * - competitionId 缺失：抛错（无法按名隔离查询燃料）。
 * - 字典中名称在当前比赛找不到对应燃料：该项按 0 计（不报错，数量不计）。
 */
async function computeFuelTotalPrice(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算燃料清单总价格缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const fuels: any[] = await prisma.fuel.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, pricePerLiter: true },
  });
  const priceByName = new Map(
    fuels.map((x) => [x.name as string, Number(x.pricePerLiter) || 0]),
  );
  let total = 0;
  for (const [name, q] of entries) {
    total += (priceByName.get(name) ?? 0) * Number(q);
  }
  return total;
}

/**
 * 仓库清单「每种种类的仓库总存储量」聚合：Σ(仓库容量[capacity] × 数量)，按仓库种类(type)分组合并，
 * 返回 {type: 总存储量} 字典（如 {MATERIAL: 1200, PRODUCT: 800}）。
 * - raw：清单字典 {仓库名称: 数量}；仅数量 > 0 的条目参与。
 * - competitionId 缺失：抛错（无法按名隔离查询仓库）。
 * - 字典中名称在当前比赛找不到对应仓库：该项按 0 计（不报错，数量不计）。
 */
async function computeWarehouseTotalStorage(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<Record<string, number>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return {};
  if (!competitionId) {
    throw new BadRequestException("计算仓库清单总存储量缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const warehouses: any[] = await prisma.warehouse.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, type: true, capacity: true },
  });
  const infoByName = new Map(
    warehouses.map((x) => [x.name as string, { type: x.type as string, capacity: Number(x.capacity) || 0 }]),
  );
  const byType: Record<string, number> = {};
  for (const [name, q] of entries) {
    const info = infoByName.get(name);
    if (!info) continue;
    const key = info.type || "UNKNOWN";
    byType[key] = (byType[key] || 0) + info.capacity * Number(q);
  }
  return byType;
}

/**
 * 仓库清单「仓库总价格」聚合：Σ(仓库价格[price] × 数量)，逻辑与 computeFuelTotalPrice 对称，
 * 只是查询 warehouse 模型的 price 字段。
 * - raw：清单字典 {仓库名称: 数量}；仅数量 > 0 的条目参与。
 * - competitionId 缺失：抛错（无法按名隔离查询仓库）。
 * - 字典中名称在当前比赛找不到对应仓库：该项按 0 计（不报错，数量不计）。
 */
async function computeWarehouseTotalPrice(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算仓库清单总价格缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const warehouses: any[] = await prisma.warehouse.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, price: true },
  });
  const priceByName = new Map(
    warehouses.map((x) => [x.name as string, Number(x.price) || 0]),
  );
  let total = 0;
  for (const [name, q] of entries) {
    total += (priceByName.get(name) ?? 0) * Number(q);
  }
  return total;
}

/**
 * 科技树节点输入源「前置节点」聚合：按比赛查选中科技树节点的全部前置依赖节点名称，
 * 返回去重后的字符串数组（保持前置声明顺序）。
 */
async function computeTechPrerequisites(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<string[]> {
  const name = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  if (!name) return [];
  if (!competitionId) {
    throw new BadRequestException("计算科技树前置节点缺少比赛上下文（competitionId）");
  }
  const node: any = await prisma.techNode.findFirst({
    where: { competitionId, name },
    select: {
      prerequisites: { select: { prerequisite: { select: { name: true } } } },
    },
  });
  if (!node) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of node.prerequisites || []) {
    const pn = p?.prerequisite?.name;
    if (pn && !seen.has(pn)) {
      seen.add(pn);
      result.push(pn);
    }
  }
  return result;
}

/**
 * 科技树节点输入源「研发费用」聚合：按比赛查选中科技树节点的 researchCost（Float），返回浮点数。
 */
async function computeTechResearchCost(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  const name = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  if (!name) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算科技树研发费用缺少比赛上下文（competitionId）");
  }
  const node: any = await prisma.techNode.findFirst({
    where: { competitionId, name },
    select: { researchCost: true },
  });
  return node ? Number(node.researchCost) || 0 : 0;
}

/**
 * 产业字段现值（FIELD）求值：读取某参与方公司当前的产业字段值。
 * 与 FIELD 效果（写）互为读写两端，定位链路完全一致：
 *   party(role) → companyId → company.industryTypeId → IndustryField(fieldKey) → CompanyFieldValue
 * - 主办方（isHost=true）或未绑定公司的参与方：返回 0（与效果侧"跳过"语义对齐）。
 *   注：经济管理中心为普通参与方（isHost=false），需绑定公司并正常计产业字段。
 * - 公司未设产业类型 / 该产业下无此字段：报错中止（不静默取 0，避免合同算错）。
 * - 无字段值记录时回落 IndustryField.defaultValue。
 */
async function readCompanyFieldValue(
  role: string,
  fieldKey: string,
  ctx: EvalCtx | undefined,
  prisma: any,
): Promise<any> {
  if (!fieldKey) throw new BadRequestException("产业字段取值缺少 fieldKey");
  const party = ctx?.parties?.get(role);
  if (!party) throw new BadRequestException(`产业字段取值失败：合同中不存在参与方「${role}」`);
  if (party.isHost || party.companyId == null) return 0;
  const company = await prisma.company.findUnique({ where: { id: party.companyId } });
  if (!company) throw new BadRequestException(`公司不存在(#${party.companyId})`);
  if (!company.industryTypeId)
    throw new BadRequestException(
      `公司「${company.name}」未设置产业类型，无法读取产业字段「${fieldKey}」`,
    );
  const def = await prisma.industryField.findUnique({
    where: {
      industryTypeId_fieldKey: { industryTypeId: company.industryTypeId, fieldKey },
    } as any,
  });
  if (!def)
    throw new BadRequestException(`公司「${company.name}」所属产业下不存在字段「${fieldKey}」`);
  const cfv = await prisma.companyFieldValue.findUnique({
    where: {
      companyId_industryFieldId: {
        companyId: party.companyId,
        industryFieldId: def.id,
      },
    } as any,
  });
  return parseStoredFieldValue(cfv?.value ?? def.defaultValue, def.fieldType);
}

/**
 * 解析 CompanyFieldValue.value（存储为 JSON 字符串）为运行期值。
 * LIST→数组、DICTIONARY→对象、BOOLEAN→布尔、STRING→字符串，其余按数字。
 */
export function parseStoredFieldValue(raw: any, fieldType: string): any {
  let v: any = raw;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") v = null;
    else {
      try {
        v = JSON.parse(s);
      } catch {
        /* 非 JSON，保留原字符串 */
      }
    }
  }
  if (fieldType === "LIST") return Array.isArray(v) ? v : v == null ? [] : [v];
  if (fieldType === "DICTIONARY") return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  if (fieldType === "BOOLEAN") return v === true || v === 1 || v === "true";
  if (fieldType === "STRING") return v == null ? "" : String(v);
  return toNumber(v);
}

/**
 * 地图路程（ROUTE）求值：给定有序节点 id 列表，求相邻节点间最短路径距离之和。
 * - 地图边视为无向（from/to 双向可达），距离为 edge.distance 之和。
 * - 按 competitionId 隔离地图（不传则用全部边）；同一 competitionId 的邻接表缓存复用。
 * - 相邻两节点间若不可达，抛 BadRequestException。
 */
async function computeRouteDistance(
  nodeIds: number[],
  competitionId: number | undefined,
  cache: Map<number, Map<number, { to: number; d: number }[]>> | undefined,
  prisma: any,
): Promise<number> {
  if (!nodeIds || nodeIds.length < 2) return 0;
  const cacheKey = competitionId ?? -1;
  let adj = cache?.get(cacheKey);
  if (!adj) {
    const where: any = {};
    if (competitionId) where.competitionId = competitionId;
    const edges: any[] = await prisma.mapEdge.findMany({
      where,
      select: { fromNodeId: true, toNodeId: true, distance: true },
    });
    adj = new Map<number, { to: number; d: number }[]>();
    for (const e of edges) {
      const d = Number(e.distance) || 0;
      if (!adj.has(e.fromNodeId)) adj.set(e.fromNodeId, []);
      adj.get(e.fromNodeId)!.push({ to: e.toNodeId, d });
      if (!adj.has(e.toNodeId)) adj.set(e.toNodeId, []);
      adj.get(e.toNodeId)!.push({ to: e.fromNodeId, d });
    }
    cache?.set(cacheKey, adj);
  }
  let total = 0;
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const dist = dijkstra(adj, nodeIds[i], nodeIds[i + 1]);
    if (!Number.isFinite(dist)) {
      throw new BadRequestException(
        `地图路程计算失败：节点 ${nodeIds[i]} 与 ${nodeIds[i + 1]} 之间无可达路径`,
      );
    }
    total += dist;
  }
  return total;
}

/**
 * 节点列表「存在的路径类型」求值：给定节点 id 列表，按比赛查询与其中任一路点
 * （fromNodeId 或 toNodeId 命中）相连的边，收集这些边所用路径类型的名称，
 * 去重后返回字符串数组（保持按首次出现顺序）。
 * - 节点列表为空：返回空数组 []。
 * - competitionId 缺失：以全部边参与匹配（不隔离比赛）。
 */
async function computeRoutePathTypes(
  nodeIds: number[],
  competitionId: number | undefined,
  prisma: any,
): Promise<string[]> {
  if (!nodeIds || nodeIds.length === 0) return [];
  const where: any = {
    OR: [{ fromNodeId: { in: nodeIds } }, { toNodeId: { in: nodeIds } }],
  };
  if (competitionId) where.competitionId = competitionId;
  const edges: any[] = await prisma.mapEdge.findMany({
    where,
    select: { pathType: { select: { name: true } } },
  });
  const seen = new Set<string>();
  const result: string[] = [];
  for (const e of edges) {
    const name = e?.pathType?.name;
    if (name && !seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

/** 无权/带权最短路（Dijkstra）。邻接表节点 -> [{to, d}]。返回距离，无可达返回 Infinity。 */
function dijkstra(
  adj: Map<number, { to: number; d: number }[]>,
  start: number,
  goal: number,
): number {
  if (start === goal) return 0;
  const dist = new Map<number, number>();
  dist.set(start, 0);
  const visited = new Set<number>();
  // 简单数组实现优先队列（节点规模小，足够）
  const pq: { d: number; u: number }[] = [{ d: 0, u: start }];
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const { d, u } = pq.shift()!;
    if (u === goal) return d;
    if (visited.has(u)) continue;
    visited.add(u);
    for (const e of adj.get(u) || []) {
      const nd = d + e.d;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        pq.push({ d: nd, u: e.to });
      }
    }
  }
  return Infinity;
}

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
      throw new BadRequestException(`未知运算: ${op}`);
  }
}
export function applyFieldEffect(
  currentRaw: string | null | undefined,
  fieldType: string,
  config: any,
  op: "ADD" | "SUB" | "SET",
  newValue: any,
): { store: string; before: any; after: any } {
  const isList = fieldType === "LIST";
  const isDict = fieldType === "DICTIONARY";
  const itemType = config?.itemType || config?.valueType || "STRING";

  const parseCurrent = (): any => {
    if (isList) {
      if (Array.isArray(currentRaw)) return currentRaw;
      if (typeof currentRaw === "string" && currentRaw) {
        try {
          const p = JSON.parse(currentRaw);
          return Array.isArray(p) ? p : [];
        } catch {
          return [];
        }
      }
      return [];
    }
    if (isDict) {
      if (currentRaw && typeof currentRaw === "object" && !Array.isArray(currentRaw))
        return currentRaw;
      if (typeof currentRaw === "string" && currentRaw) {
        try {
          const p = JSON.parse(currentRaw);
          return p && typeof p === "object" && !Array.isArray(p) ? p : {};
        } catch {
          return {};
        }
      }
      return {};
    }
    return toNumber(currentRaw);
  };

  const before = parseCurrent();
  let after: any;

  if (isList) {
    const base: any[] = Array.isArray(before) ? before : [];
    const items: any[] = Array.isArray(newValue)
      ? newValue
      : newValue === undefined || newValue === null
        ? []
        : [newValue];
    if (op === "SET") after = items;
    else if (op === "SUB") after = base.filter((i) => !items.some((x) => deepEqual(x, i)));
    else after = [...base, ...items];
    after = after.map((it) => castScalar(itemType, it));
  } else if (isDict) {
    const base: any = before && typeof before === "object" && !Array.isArray(before) ? before : {};
    const obj: any =
      newValue && typeof newValue === "object" && !Array.isArray(newValue)
        ? newValue
        : typeof newValue === "string" && newValue
          ? { [newValue]: true }
          : {};
    if (op === "SET") after = obj;
    else if (op === "SUB") {
      const removeKeys = Array.isArray(newValue)
        ? newValue.map(String)
        : newValue && typeof newValue === "object"
          ? Object.keys(newValue)
          : [String(newValue)];
      after = { ...base };
      for (const k of removeKeys) delete after[k];
    } else after = { ...base, ...obj };
    const valueType = config?.valueType || "STRING";
    after = Object.fromEntries(
      Object.entries(after).map(([k, v]) => [k, castScalar(valueType, v)]),
    );
  } else {
    const nBefore = toNumber(before);
    const nVal = toNumber(newValue);
    if (op === "SET") after = nVal;
    else if (op === "SUB") after = nBefore - nVal;
    else after = nBefore + nVal;
  }

  return { store: JSON.stringify(after), before, after };
}

/** 解析 ContractFieldEffect 中存储的 JSON 值（增量/基线）。 */
function parseJsonValue(raw: string | null | undefined): any {
  if (raw == null) return raw;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * 组合效果的两个数值来源（value + value2）。
 * - 标量字段：按 valueOp 做 加/减/乘（数字运算）。
 * - 列表字段：ADD/串联 → 拼接；SUB → 移除 value2 中元素；MUL 对集合无定义，退化为仅用 value。
 * - 字典字段：ADD/合并；SUB → 删键；MUL 退化为仅用 value（忽略 value2）。
 * 仅当 eff.value2 存在时调用，否则直接使用 value。
 */
function combineValues(v1: any, v2: any, vop: "ADD" | "SUB" | "MUL", fieldType: string): any {
  const isList = fieldType === "LIST";
  const isDict = fieldType === "DICTIONARY";
  if (isList) {
    const a = Array.isArray(v1) ? v1 : v1 == null ? [] : [v1];
    const b = Array.isArray(v2) ? v2 : v2 == null ? [] : [v2];
    if (vop === "SUB") return a.filter((i) => !b.some((x) => deepEqual(x, i)));
    return [...a, ...b];
  }
  if (isDict) {
    const a = v1 && typeof v1 === "object" && !Array.isArray(v1) ? v1 : {};
    const b = v2 && typeof v2 === "object" && !Array.isArray(v2) ? v2 : {};
    if (vop === "SUB") {
      const r = { ...a };
      for (const k of Object.keys(b)) delete r[k];
      return r;
    }
    return { ...a, ...b };
  }
  const a = toNumber(v1);
  const b = toNumber(v2);
  if (vop === "MUL") return a * b;
  if (vop === "SUB") return a - b;
  return a + b;
}

/** 对公司产业字段（列表/字典/数字）做前置比较，返回是否通过及前后值。 */
export function compareField(
  currentRaw: string | null | undefined,
  fieldType: string,
  config: any,
  op: CompareOp,
  expected: any,
): { passed: boolean; actual: any; expected: any; detail: string } {
  const isList = fieldType === "LIST";
  const isDict = fieldType === "DICTIONARY";
  const parseCurrent = (): any => {
    if (isList) {
      if (Array.isArray(currentRaw)) return currentRaw;
      if (typeof currentRaw === "string" && currentRaw) {
        try {
          const p = JSON.parse(currentRaw);
          return Array.isArray(p) ? p : [];
        } catch {
          return [];
        }
      }
      return [];
    }
    if (isDict) {
      if (currentRaw && typeof currentRaw === "object" && !Array.isArray(currentRaw))
        return currentRaw;
      if (typeof currentRaw === "string" && currentRaw) {
        try {
          const p = JSON.parse(currentRaw);
          return p && typeof p === "object" && !Array.isArray(p) ? p : {};
        } catch {
          return {};
        }
      }
      return {};
    }
    return toNumber(currentRaw);
  };
  const actual = parseCurrent();
  const length = isList ? (actual as any[]).length : Object.keys(actual as any).length;

  switch (op) {
    case "CONTAINS": {
      const ok = isList
        ? (actual as any[]).some((i) => deepEqual(i, expected))
        : Object.keys(actual as any).includes(expected as any) ||
          Object.values(actual as any).some((v) => deepEqual(v, expected));
      return {
        passed: ok,
        actual,
        expected,
        detail: `字段包含 ${JSON.stringify(expected)}: ${ok ? "是" : "否"}`,
      };
    }
    case "HAS_KEY": {
      const ok = isDict && Object.prototype.hasOwnProperty.call(actual, expected);
      return {
        passed: ok,
        actual,
        expected,
        detail: `字典含键 ${expected}: ${ok ? "是" : "否"}`,
      };
    }
    case "LEN_EQ":
      return {
        passed: length === toNumber(expected),
        actual: length,
        expected: toNumber(expected),
        detail: `长度=${length} == ${toNumber(expected)}`,
      };
    case "LEN_GTE":
      return {
        passed: length >= toNumber(expected),
        actual: length,
        expected: toNumber(expected),
        detail: `长度=${length} >= ${toNumber(expected)}`,
      };
    case "LEN_LTE":
      return {
        passed: length <= toNumber(expected),
        actual: length,
        expected: toNumber(expected),
        detail: `长度=${length} <= ${toNumber(expected)}`,
      };
    case "EQ":
      return { passed: deepEqual(actual, expected), actual, expected, detail: `结构相等比较` };
    default: {
      const ok = (() => {
        switch (op) {
          case "GT":
            return length > toNumber(expected);
          case "LT":
            return length < toNumber(expected);
          case "LTE":
            return length <= toNumber(expected);
          case "GTE":
          default:
            return length >= toNumber(expected);
        }
      })();
      return {
        passed: ok,
        actual: length,
        expected: toNumber(expected),
        detail: `长度${op} ${toNumber(expected)}`,
      };
    }
  }
}

@Injectable()
export class ContractEngineService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 执行合同：解析 effects，在事务内按类型改写
   * 公司的产业字段（CompanyFieldValue），并写审计日志。
   * 数值优先取自数据管理实体（ENTITY），无实体时由用户填写（INPUT）。
   * 合同仅可操作产业字段；账户/库存/科技/资产/载具/基建等子资源表已全部移除。
   */
  async execute(contract: {
    parties: string;
    inputs: string;
    contractType: { effects: string; conditions?: string };
  }): Promise<{ log: any[]; result: any }> {
    const effects: Effect[] = this.safeParse(contract.contractType.effects, "contractType.effects");
    const conditions: ConditionSpec[] = this.safeParse(
      contract.contractType.conditions || "[]",
      "contractType.conditions",
    );
    const parties: PartyDef[] = this.safeParse(contract.parties, "contract.parties");
    const inputs: Record<string, any> = this.safeParse(contract.inputs, "contract.inputs");

    // 基建清单「基建列表」引擎校验：若合同类型限定了基建范围，用户填写的基建清单字典里
    // 凡不在允许列表内的基建一律拒绝执行（事务中止，不落账）。快速失败，无副作用。
    const inputSchema: any[] = this.safeParse(
      (contract as any).contractType?.inputSchema || "[]",
      "contractType.inputSchema",
    );
    const infraFilterErr = this.validateInfraListFilters(inputSchema, inputs);
    if (infraFilterErr) {
      throw new BadRequestException(`基建清单范围校验未通过:\n${infraFilterErr}`);
    }
    const vehFilterErr = this.validateVehicleListFilters(inputSchema, inputs);
    if (vehFilterErr) {
      throw new BadRequestException(`载具清单范围校验未通过:\n${vehFilterErr}`);
    }

    const partyMap = new Map(parties.map((p) => [p.role, p]));
    const log: any[] = [];
    // 每个 FIELD 叶子效果落账一条不可变记录，供合同删除时复原字段（不影响后续合同）。
    const effectRows: any[] = [];
    const result: any = {
      logs: log,
      fields: {},
      checks: [],
    };

    // 运行期变量表：供 VAR 引用 / FOREACH 循环变量 / ASSIGN 赋值结果。
    const scope: Record<string, any> = {};
    // 求值上下文：地图路程按比赛隔离并缓存邻接表；产业字段现值（FIELD）按角色定位公司。
    const routeCache = new Map<number, Map<number, { to: number; d: number }[]>>();
    const ctx: EvalCtx = {
      competitionId: (contract as any).competitionId ?? undefined,
      cache: routeCache,
      parties: partyMap,
    };

    const resolvePartyCompany = (role: string): PartyDef | null => {
      const p = partyMap.get(role);
      if (!p || p.isHost || p.companyId == null) return null;
      return p;
    };

    const resolveValue = (spec: ValueSpec, sc?: Record<string, any>): Promise<any> =>
      evalValueSpec(spec, inputs, this.prisma, sc ?? scope, ctx);

    await this.prisma.$transaction(async (tx) => {
      // 前置检查：先核验公司状态，任一不过则中止（事务回滚，不落账）
      if (conditions.length) {
        const checks = await this.runConditions(
          conditions,
          partyMap,
          inputs,
          tx,
          {
            throwOnFail: true,
          },
          scope,
          ctx,
        );
        result.checks = checks;
      }

      // 递归执行效果（含 IF/ELSE、FOREACH、ASSIGN 控制流）。
      const isTruthy = (v: any): boolean => {
        if (v == null) return false;
        if (typeof v === "boolean") return v;
        if (typeof v === "number") return v !== 0;
        if (typeof v === "string") return v.length > 0;
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === "object") return Object.keys(v).length > 0;
        return !!v;
      };

      // 叶子效果（FIELD）的实际改写。
      const applyLeaf = async (eff: any, sc: Record<string, any>): Promise<void> => {
        if (eff.kind === "FIELD") {
          const party = resolvePartyCompany(eff.party);
          if (!party) {
            // 不再静默跳过：未定位到目标公司属于配置错误，必须明确报错，
            // 否则合同会"执行成功"但字段毫无变化，难以排查。
            if (eff.party == null || eff.party === "") {
              throw new BadRequestException(
                "合同「产业字段」效果未指定参与方：请在合同类型编辑器中为该效果节点连接「参与方」节点后再保存",
              );
            }
            const p = partyMap.get(eff.party);
            if (p && (p.isHost || p.companyId == null)) {
              throw new BadRequestException(
                `参与方「${eff.party}」为主办方或未分配公司，无法操作产业字段`,
              );
            }
            throw new BadRequestException(
              `合同不包含参与方角色「${eff.party}」，无法定位目标公司（请核对合同类型的参与方配置）`,
            );
          }
          const field = await this.resolveIndustryField(tx, party.companyId!, eff.fieldKey);
          let newValue = await resolveValue(eff.value, sc);
          // 效果双值组合：把第二个自动数值来源 value2 按 valueOp 合并到写入量。
          if (eff.value2) {
            const v2 = await resolveValue(eff.value2, sc);
            newValue = combineValues(
              newValue,
              v2,
              (eff.valueOp || "ADD") as "ADD" | "SUB" | "MUL",
              field.fieldType,
            );
          }
          const where = {
            companyId_industryFieldId: {
              companyId: party.companyId!,
              industryFieldId: field.id,
            },
          } as any;
          const current = await tx.companyFieldValue.findUnique({ where });
          const applied = applyFieldEffect(
            current?.value,
            field.fieldType,
            this.parseFieldConfig(field.config),
            eff.op,
            newValue,
          );
          await tx.companyFieldValue.upsert({
            where,
            create: {
              companyId: party.companyId!,
              industryFieldId: field.id,
              value: applied.store,
            },
            update: { value: applied.store },
          });
          log.push({
            kind: "FIELD",
            companyId: party.companyId,
            fieldKey: eff.fieldKey,
            fieldName: field.name,
            op: eff.op,
            value: newValue,
            before: applied.before,
            after: applied.after,
          });
          result.fields[`${party.companyId}:${eff.fieldKey}`] = applied.after;
          // 落账本次字段改写（不可变记录），供删除合同时按 executedAt 重放复原。
          effectRows.push({
            contractId: (contract as any).id,
            companyId: party.companyId,
            industryFieldId: field.id,
            fieldKey: eff.fieldKey,
            fieldName: field.name,
            op: eff.op,
            valueRaw: JSON.stringify(newValue),
            beforeRaw: JSON.stringify(applied.before),
            afterRaw: JSON.stringify(applied.after),
          });
        } else {
          throw new BadRequestException(`未知效果类型: ${eff.kind}`);
        }
      };

      // 递归分发：叶子效果 / IF / FOREACH / ASSIGN。
      const applyEffect = async (eff: any, sc: Record<string, any> = scope): Promise<void> => {
        if (!eff || typeof eff !== "object") return;
        if (eff.kind === "IF") {
          const condVal = await resolveValue(eff.cond, sc);
          const branch = isTruthy(condVal) ? eff.then || [] : eff.else || [];
          for (const sub of branch) await applyEffect(sub, sc);
        } else if (eff.kind === "FOREACH") {
          const arr = await resolveValue(eff.items, sc);
          const list = Array.isArray(arr) ? arr : [];
          const varName = eff.var || "item";
          for (const el of list) {
            const childScope = { ...sc, [varName]: el };
            for (const sub of eff.body || []) await applyEffect(sub, childScope);
          }
        } else if (eff.kind === "ASSIGN") {
          sc[eff.name] = await resolveValue(eff.value, sc);
        } else {
          await applyLeaf(eff, sc);
        }
      };

      for (const eff of effects) {
        await applyEffect(eff, scope);
      }

      // 持久化字段改写记录（与字段落账同一事务，保证一致）。
      if (effectRows.length) {
        await (tx as any).contractFieldEffect.createMany({ data: effectRows });
      }
    });

    return { log, result };
  }

  /**
   * 复原某合同对产业字段的修改（合同删除时由 ContractService 调用）。
   *
   * 采用「事件溯源式重放」：对每个受影响的 (companyId, industryFieldId)，以「全部效果中
   * 按 (executedAt,id) 最早者的 beforeRaw」作为基线现值，再按 executedAt 顺序重放**其余**
   * 已执行合同的增量，写回 CompanyFieldValue。这样仅精确撤销本合同造成的字段变化，
   * 后续合同已落账的字段值完全不受影响（ADD/SUB/SET 均成立）。
   *
   * 调用方须在本合同记录被删除（级联清空 ContractFieldEffect）之前调用本方法。
   */
  async revertContract(contract: { id: number; executedAt?: Date | null | undefined }): Promise<void> {
    const prisma = this.prisma as any;
    const deletedRows: any[] = await prisma.contractFieldEffect.findMany({
      where: { contractId: contract.id },
    });
    if (!deletedRows.length) return;

    // 去重受影响字段
    const fieldMap = new Map<string, { companyId: number; industryFieldId: number }>();
    for (const r of deletedRows) {
      fieldMap.set(`${r.companyId}:${r.industryFieldId}`, {
        companyId: r.companyId,
        industryFieldId: r.industryFieldId,
      });
    }

    for (const { companyId, industryFieldId } of fieldMap.values()) {
      const field = await prisma.industryField.findUnique({ where: { id: industryFieldId } });
      if (!field) continue;
      const fieldType = field.fieldType;
      const config = this.parseFieldConfig(field.config);

      const deletedRowsForField = deletedRows.filter(
        (r) => r.companyId === companyId && r.industryFieldId === industryFieldId,
      );
      const remaining: any[] = await prisma.contractFieldEffect.findMany({
        where: { companyId, industryFieldId, contractId: { not: contract.id } },
        orderBy: [{ contract: { executedAt: "asc" } }, { id: "asc" }],
        include: { contract: { select: { executedAt: true } } },
      });

      // 基线 = 全部效果（含被删合同）中最早者的 beforeRaw
      const allForField = [
        ...remaining.map((r) => ({ ex: r.contract?.executedAt ?? null, row: r })),
        ...deletedRowsForField.map((r) => ({ ex: contract.executedAt ?? null, row: r })),
      ];
      allForField.sort((a: any, b: any) => {
        const ta = a.ex ? a.ex.getTime() : 0;
        const tb = b.ex ? b.ex.getTime() : 0;
        if (ta !== tb) return ta - tb;
        return a.row.id - b.row.id;
      });
      let value: any = parseJsonValue(allForField[0].row.beforeRaw);

      // 按序重放其余已执行合同的增量（不含被删合同）
      for (const r of remaining) {
        const delta = parseJsonValue(r.valueRaw);
        value = applyFieldEffect(JSON.stringify(value), fieldType, config, r.op, delta).after;
      }

      const where = {
        companyId_industryFieldId: { companyId, industryFieldId },
      } as any;
      await prisma.companyFieldValue.upsert({
        where,
        create: { companyId, industryFieldId, value: JSON.stringify(value) },
        update: { value: JSON.stringify(value) },
      });
    }
  }

  /**
   * 按公司所属产业类型 + fieldKey 定位产业字段定义。
   * 公司未设置产业类型、或该产业下没有此字段时抛错（合同不应静默跳过字段操作）。
   */
  private async resolveIndustryField(p: any, companyId: number, fieldKey: string) {
    const company = await p.company.findUnique({ where: { id: companyId } });
    if (!company) throw new BadRequestException(`公司不存在(#${companyId})`);
    if (!company.industryTypeId)
      throw new BadRequestException(`公司「${company.name}」未设置产业类型，无法操作产业字段`);
    const field = await p.industryField.findUnique({
      where: {
        industryTypeId_fieldKey: {
          industryTypeId: company.industryTypeId,
          fieldKey,
        },
      } as any,
    });
    if (!field)
      throw new BadRequestException(`公司「${company.name}」所属产业下不存在字段「${fieldKey}」`);
    return field;
  }

  /** 解析产业字段 config（DICTIONARY -> entries/valueType；LIST -> itemType），失败兜底为空对象。 */
  private parseFieldConfig(raw: string | null | undefined): any {
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  /**
   * 前置检查：核验公司状态。throwOnFail=true 时任一不过抛 BadRequestException（执行中止）；
   * false 时仅返回各项结果（用于"预检"接口，不落账）。
   */
  private async runConditions(
    conditions: ConditionSpec[],
    partyMap: Map<string, PartyDef>,
    inputs: Record<string, any>,
    p: any,
    opts: { throwOnFail: boolean },
    scope?: Record<string, any>,
    ctx?: EvalCtx,
  ): Promise<CheckResult[]> {
    const resolvePartyCompany = (role: string): PartyDef | null => {
      const pp = partyMap.get(role);
      if (!pp || pp.isHost || pp.companyId == null) return null;
      return pp;
    };
    const resolveId = (ref?: string): number => (ref ? Number(inputs[ref]) || 0 : 0);
    const resolveValue = (spec?: ValueSpec): Promise<any> =>
      evalValueSpec(spec as ValueSpec, inputs, p, scope, ctx);

    const results: CheckResult[] = [];
    for (const c of conditions) {
      const label = c.label || condKindLabel(c.kind);
      // 控制流：若本检查挂在某个 IF 分支之下，仅当该分支条件成立时才执行。
      if (c.branch && (c.branch.when === "then" || c.branch.when === "else")) {
        let branchOk = false;
        try {
          const condVal = await resolveValue(c.branch.cond);
          branchOk = isTruthy(condVal) ? c.branch.when === "then" : c.branch.when === "else";
        } catch {
          branchOk = false;
        }
        if (!branchOk) {
          results.push({
            kind: c.kind,
            party: c.party ?? "",
            label,
            passed: true,
            detail: `已跳过：所属 IF 分支（${c.branch.when === "then" ? "真分支" : "假分支"}）未触发`,
            skipped: true,
          });
          continue;
        }
      }
      const em = (c.errorMessage || "").trim();
      // VALUE_COMPARE / DICT_COMPARE 无参与方概念，直接比较两个自由数值源，无需 party 校验。
      const party = c.kind === "VALUE_COMPARE" || c.kind === "DICT_COMPARE" || c.kind === "LIST_COMPARE" ? null : resolvePartyCompany(c.party ?? "");
      if (c.kind !== "VALUE_COMPARE" && c.kind !== "DICT_COMPARE" && c.kind !== "LIST_COMPARE" && !party) {
        results.push({
          kind: c.kind,
          party: c.party ?? "",
          label,
          passed: false,
          detail: em || "该参与方不是公司账户，无法检查",
          customError: !!em,
        });
        continue;
      }
      const companyId = party ? party.companyId! : undefined;
      let passed = true;
      let detail = "";
      let actual: any;
      let expected: any;

      switch (c.kind) {
        case "VALUE_COMPARE": {
          const v1 = await resolveValue(c.value1);
          const v2 = await resolveValue(c.value2);
          const op = (c.op || "GTE") as CompareOp;
          let ok = false;
          if (op === "CONTAINS") {
            ok = Array.isArray(v1)
              ? v1.some((i) => deepEqual(i, v2))
              : v1 && typeof v1 === "object"
                ? Object.keys(v1).includes(v2 as any) ||
                  Object.values(v1 as any).some((x) => deepEqual(x, v2))
                : false;
          } else if (op === "HAS_KEY") {
            ok =
              !!v1 &&
              typeof v1 === "object" &&
              !Array.isArray(v1) &&
              Object.prototype.hasOwnProperty.call(v1, v2 as any);
          } else if (op === "EQ") {
            ok = deepEqual(v1, v2);
          } else {
            ok = compareOp(toNumber(v1), op, toNumber(v2));
          }
          passed = ok;
          actual = v1;
          expected = v2;
          detail = `值1 ${COMPARE_OP_LABEL[op] || op} 值2：${ok ? "通过" : "未通过"}（${JSON.stringify(actual)} ${COMPARE_OP_LABEL[op] || op} ${JSON.stringify(expected)}）`;
          break;
        }
        case "DICT_COMPARE": {
          const v1 = await resolveValue(c.value1);
          const v2 = await resolveValue(c.value2);
          const op = (c.op || "GTE") as CompareOp;
          actual = v1;
          expected = v2;
          // 字典互相比较仅支持 ≥ / > / = 三种算子（与可视化编辑器下拉一致）。
          if (op !== "GTE" && op !== "GT" && op !== "EQ") {
            passed = false;
            detail = `DICT_COMPARE 仅支持 ≥(GTE) / >(GT) / =(EQ) 三种算子，当前算子无效：${op}`;
            break;
          }
          // 两个操作数都必须是字典（非数组、非 null 的普通对象）。
          const isDict = (x: any) =>
            !!x && typeof x === "object" && !Array.isArray(x);
          if (!isDict(v1) || !isDict(v2)) {
            passed = false;
            detail = `DICT_COMPARE 要求两个操作数均为字典，实际：值1=${isDict(v1) ? "字典" : JSON.stringify(v1)}，值2=${isDict(v2) ? "字典" : JSON.stringify(v2)}`;
            break;
          }
          // 前提：值一的每个键都必须存在于值二的键集合中（值一键 ⊆ 值二键）。
          const keys1 = Object.keys(v1);
          const keys2 = Object.keys(v2);
          const missing = keys1.filter((k) => !keys2.includes(k));
          if (missing.length) {
            passed = false;
            detail = `前提不满足：值一的键必须全部存在于值二（值二缺失键：${missing.join(", ")}）`;
            break;
          }
          // 前提满足后，对共有键逐一比较 toNumber(v1[k]) op toNumber(v2[k])。
          const opLabel = COMPARE_OP_LABEL[op] || op;
          const fails: string[] = [];
          for (const k of keys1) {
            const a = toNumber((v1 as any)[k]);
            const b = toNumber((v2 as any)[k]);
            if (!compareOp(a, op, b)) {
              fails.push(`「${k}」：${a} ${opLabel} ${b} 不成立`);
            }
          }
          passed = fails.length === 0;
          detail = passed
            ? `字典逐项比较通过（${keys1.length} 个共有键均满足 ${opLabel}）`
            : `字典逐项比较未通过：${fails.join("；")}`;
          break;
        }
        case "LIST_COMPARE": {
          const v1 = await resolveValue(c.value1);
          const v2 = await resolveValue(c.value2);
          const op = (c.op || "GTE") as CompareOp;
          actual = v1;
          expected = v2;
          // 列表互相比较仅支持 元素相等 / 被包含 / 大于 / 大于等于 / 等于 五种算子。
          if (op !== "ELEMENT_EQ" && op !== "CONTAINS" && op !== "GT" && op !== "GTE" && op !== "EQ") {
            passed = false;
            detail = `LIST_COMPARE 仅支持 元素相等(ELEMENT_EQ) / 被包含(CONTAINS) / >(GT) / ≥(GTE) / =(EQ) 五种算子，当前算子无效：${op}`;
            break;
          }
          // 两个操作数都必须是列表（数组）。
          const isList = (x: any) => Array.isArray(x);
          if (!isList(v1) || !isList(v2)) {
            passed = false;
            detail = `LIST_COMPARE 要求两个操作数均为列表，实际：值1=${isList(v1) ? "列表" : JSON.stringify(v1)}，值2=${isList(v2) ? "列表" : JSON.stringify(v2)}`;
            break;
          }
          const opLabel = COMPARE_OP_LABEL[op] || op;
          const a1 = v1 as any[];
          const a2 = v2 as any[];
          // 比较的是「元素集合的包含关系」（非长度）。
          // setHas(bigger, smaller)：smaller 的每个元素都能在 bigger 中找到（deepEqual）。
          const setHas = (bigger: any[], smaller: any[]) =>
            smaller.every((x) => bigger.some((y) => deepEqual(x, y)));
          const setEqual = setHas(a1, a2) && setHas(a2, a1);
          if (op === "ELEMENT_EQ") {
            // 两列表长度相同且对应位置元素相等（有序结构相等）。
            passed = a1.length === a2.length && a1.every((x, i) => deepEqual(x, a2[i]));
            detail = passed
              ? `列表元素相等（长度 ${a1.length}，逐项一致）`
              : `列表元素不相等（长度 值1=${a1.length} / 值2=${a2.length}，或存在位置不一致的元素）`;
          } else if (op === "CONTAINS") {
            // 值一被包含于值二：值一 ⊆ 值二（值一的每个元素都存在于值二中）。
            const missing = a1.filter((x) => !a2.some((y) => deepEqual(x, y)));
            passed = missing.length === 0;
            detail = passed
              ? `值一被包含于值二（值一 ${a1.length} 个元素均能在值二中找到）`
              : `值一未被完全包含于值二，缺失元素：${JSON.stringify(missing)}`;
          } else if (op === "EQ") {
            // 作为集合相等：值一 ⊆ 值二 且 值二 ⊆ 值一。
            passed = setEqual;
            detail = passed
              ? `两列表元素集合相同（${a1.length} 个元素一致）`
              : `两列表元素集合不同（值1=${a1.length} 个 / 值2=${a2.length} 个，存在一方特有元素）`;
          } else if (op === "GTE") {
            // 值一包含值二（含相等）：值二 ⊆ 值一（值一是值二的超集或相等）。
            passed = setHas(a1, a2);
            detail = passed
              ? `值一包含值二（值二 ${a2.length} 个元素均能在值一中找到）`
              : `值一未包含值二，值二特有元素：${JSON.stringify(a2.filter((y) => !a1.some((x) => deepEqual(x, y))))}`;
          } else {
            // GT：值一真包含值二：值二 ⊆ 值一 且 二者集合不等（值一 ⊃ 值二）。
            passed = setHas(a1, a2) && !setEqual;
            detail = passed
              ? `值一真包含值二（值二 ${a2.length} 个元素均能在值一中找到，且值一元素更多）`
              : `值一未真包含值二（需 值二 ⊆ 值一 且 值一元素更多）`;
          }
          break;
        }
        case "FIELD_COMPARE": {
          const fieldKey = c.fieldKey as string;
          const company = await p.company.findUnique({ where: { id: companyId } });
          if (!company?.industryTypeId) {
            passed = false;
            detail = `公司未设置产业类型，无法检查字段「${fieldKey}」`;
            break;
          }
          const def = await p.industryField.findUnique({
            where: {
              industryTypeId_fieldKey: {
                industryTypeId: company.industryTypeId,
                fieldKey,
              },
            } as any,
          });
          if (!def) {
            passed = false;
            detail = `该产业下不存在字段「${fieldKey}」`;
            break;
          }
          const cfv = await p.companyFieldValue.findUnique({
            where: {
              companyId_industryFieldId: {
                companyId,
                industryFieldId: def.id,
              },
            } as any,
          });
          const isStructured = def.fieldType === "DICTIONARY" || def.fieldType === "LIST";
          if (isStructured) {
            expected = await resolveValue(c.value);
            const r = compareField(
              cfv?.value,
              def.fieldType,
              this.parseFieldConfig(def.config),
              c.op || "LEN_GTE",
              expected,
            );
            passed = r.passed;
            actual = r.actual;
            expected = r.expected;
            detail = `${def.name}(${fieldKey}) ${r.detail}`;
          } else {
            actual = toNumber(cfv?.value ?? def.defaultValue ?? 0);
            expected = toNumber(await resolveValue(c.value));
            passed = compareOp(actual, c.op || "GTE", expected);
            detail = `${def.name}(${fieldKey})=${actual} ${c.op || "GTE"} ${expected}`;
          }
          break;
        }
        case "INDUSTRY_IS": {
          const company = await p.company.findUnique({
            where: { id: companyId },
            include: { industryType: true },
          });
          actual = company?.industryType?.name || "未设置";
          const want = await p.industryType.findUnique({
            where: { id: Number(c.industryTypeId) || 0 },
          });
          expected = want?.name || `#${c.industryTypeId}`;
          passed = !!company?.industryTypeId && company.industryTypeId === Number(c.industryTypeId);
          detail = `产业类型=${actual}，要求=${expected}`;
          break;
        }
        default:
          results.push({
            kind: c.kind,
            party: c.party ?? "",
            label,
            passed: false,
            detail: em || `未知检查类型: ${c.kind}`,
          });
          continue;
      }
      // 检查不通过且配置了该检查的错误信息，则优先用配置的错误信息展示给用户。
      if (!passed && em) detail = em;
      results.push({ kind: c.kind, party: c.party ?? "", label, passed, actual, expected, detail, customError: !!(em && detail === em) });
    }

    if (opts.throwOnFail && results.some((r) => !r.passed)) {
      const failed = results
        .filter((r) => !r.passed)
        .map((r) => (r.customError ? `• ${r.detail}` : `• ${r.label}: ${r.detail}`))
        .join("\n");
      throw new BadRequestException(`合同前置检查未通过:\n${failed}`);
    }
    return results;
  }

  /** 预检：仅评估前置检查并返回结果，不落账、不改写任何数据。 */
  async precheck(contract: {
    parties: string;
    inputs: string;
    contractType: { conditions?: string };
  }): Promise<CheckResult[]> {
    const conditions: ConditionSpec[] = this.safeParse(
      contract.contractType.conditions || "[]",
      "contractType.conditions",
    );
    const parties: PartyDef[] = this.safeParse(contract.parties, "contract.parties");
    const inputs: Record<string, any> = this.safeParse(contract.inputs, "contract.inputs");
    const partyMap = new Map(parties.map((p) => [p.role, p]));
    const routeCache = new Map<number, Map<number, { to: number; d: number }[]>>();
    const ctx: EvalCtx = {
      competitionId: (contract as any).competitionId ?? undefined,
      cache: routeCache,
      parties: partyMap,
    };
    // 基建清单「基建列表」引擎校验：预检阶段不抛错，把违规作为一条未通过的 CheckResult 返回，
    // 供前端预检界面以「未通过」形式展示。
    const inputSchema: any[] = this.safeParse(
      (contract as any).contractType?.inputSchema || "[]",
      "contractType.inputSchema",
    );
    const checks = await this.runConditions(
      conditions,
      partyMap,
      inputs,
      this.prisma,
      {
        throwOnFail: false,
      },
      undefined,
      ctx,
    );
    const infraFilterErr = this.validateInfraListFilters(inputSchema, inputs);
    if (infraFilterErr) {
      checks.push({
        kind: "INFRA_LIST_FILTER",
        party: "",
        label: "基建范围校验",
        passed: false,
        detail: infraFilterErr,
        customError: true,
      });
    }
    const vehFilterErr = this.validateVehicleListFilters(inputSchema, inputs);
    if (vehFilterErr) {
      checks.push({
        kind: "VEHICLE_LIST_FILTER",
        party: "",
        label: "载具范围校验",
        passed: false,
        detail: vehFilterErr,
        customError: true,
      });
    }
    return checks;
  }

  /**
   * 基建清单「基建列表」引擎校验：若合同类型某基建清单输入源在 inputSchema 中配置了
   * allowedInfrastructures（限定可见基建名数组，非空），则用户填写的基建清单字典
   * {基建名: 数量} 中，凡名称不在允许列表内的基建一律视为违规。
   * 返回中文错误信息（含违规基建名 + 允许清单），无违规返回 null。
   * - 仅对 type === "infrastructureList" 且 allowedInfrastructures 为非空数组的字段生效。
   * - inputs[field.key] 非对象 / 空字典：跳过（无违规）。
   * - 向后兼容：旧合同类型（无 allowedInfrastructures 或空数组）完全不受影响。
   */
  private validateInfraListFilters(
    inputSchema: any,
    inputs: Record<string, any>,
  ): string | null {
    if (!Array.isArray(inputSchema)) return null;
    const violations: string[] = [];
    for (const f of inputSchema) {
      if (!f || f.type !== "infrastructureList") continue;
      const allowed = f.allowedInfrastructures;
      if (!Array.isArray(allowed) || allowed.length === 0) continue;
      const allowedSet = new Set(allowed.map((x: any) => String(x)));
      const raw = inputs?.[f.key];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const forbidden: string[] = [];
      for (const name of Object.keys(raw)) {
        if (!allowedSet.has(name)) forbidden.push(name);
      }
      if (forbidden.length) {
        violations.push(
          `基建清单「${f.label || f.key}」包含未授权的基建：${forbidden.join("、")}（仅允许：${allowed.join("、")}）`,
        );
      }
    }
    return violations.length ? violations.join("\n") : null;
  }

  /**
   * 载具清单「载具列表」引擎校验：逻辑与 validateInfraListFilters 完全对称，
   * 仅将 type / 允许字段 / 实体名改为 vehicleList / allowedVehicles / 载具。
   * 若合同类型某载具清单输入源在 inputSchema 中配置了 allowedVehicles（限定可见载具名数组，非空），
   * 则用户填写的载具清单字典 {载具名: 数量} 中，凡名称不在允许列表内的载具一律视为违规。
   * 返回中文错误信息（含违规载具名 + 允许清单），无违规返回 null。
   * - 仅对 type === "vehicleList" 且 allowedVehicles 为非空数组的字段生效。
   * - inputs[field.key] 非对象 / 空字典：跳过（无违规）。
   * - 向后兼容：旧合同类型（无 allowedVehicles 或空数组）完全不受影响。
   */
  private validateVehicleListFilters(
    inputSchema: any,
    inputs: Record<string, any>,
  ): string | null {
    if (!Array.isArray(inputSchema)) return null;
    const violations: string[] = [];
    for (const f of inputSchema) {
      if (!f || f.type !== "vehicleList") continue;
      const allowed = f.allowedVehicles;
      if (!Array.isArray(allowed) || allowed.length === 0) continue;
      const allowedSet = new Set(allowed.map((x: any) => String(x)));
      const raw = inputs?.[f.key];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const forbidden: string[] = [];
      for (const name of Object.keys(raw)) {
        if (!allowedSet.has(name)) forbidden.push(name);
      }
      if (forbidden.length) {
        violations.push(
          `载具清单「${f.label || f.key}」包含未授权的载具：${forbidden.join("、")}（仅允许：${allowed.join("、")}）`,
        );
      }
    }
    return violations.length ? violations.join("\n") : null;
  }

  private safeParse(raw: string, label: string): any {
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new BadRequestException(`${label} 不是合法 JSON: ${(e as Error).message}`);
    }
  }
}
