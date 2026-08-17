/**
 * 合同引擎 - 效果执行
 *
 * 从 contract-engine.service.ts 提取的效果执行相关函数。
 * 包含 Field 效果的字段值改写逻辑。
 */

import { toNumber, deepEqual, castScalar } from "./values";

// ========== 类型定义 ==========

/** 字段效果操作类型 */
export type FieldEffectOp = "ADD" | "SUB" | "SET";

/** 字段效果执行结果 */
export interface FieldEffectResult {
  store: string; // 序列化后的存储值
  before: any; // 改写前的值
  after: any; // 改写后的值
}

// ========== 字段效果执行 ==========

/**
 * 对公司产业字段（列表/字典/数字）执行效果操作，返回改写前后的值。
 * @param currentRaw 当前字段存储值（JSON 字符串或已解析值）
 * @param fieldType 字段类型（NUMBER/STRING/BOOLEAN/LIST/DICTIONARY）
 * @param config 字段配置（列表的 itemType、字典的 valueType 等）
 * @param op 操作类型（ADD/SUB/SET）
 * @param newValue 新值（ADD/SUB 时为增量，SET 时为直接值）
 */
export function applyFieldEffect(
  currentRaw: string | null | undefined,
  fieldType: string,
  config: any,
  op: FieldEffectOp,
  newValue: any,
): FieldEffectResult {
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
    return parseStoredFieldValue(currentRaw, fieldType);
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
    // ADD 时去重，与 applyOp 的 LIST_ADD 行为一致
    else after = [...base, ...items.filter((item) => !base.some((b) => deepEqual(b, item)))]
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
    const ft = (fieldType || "STRING").toUpperCase();
    if (ft === "STRING" || ft === "BOOLEAN") {
      // 字符串 / 布尔字段（如「所在地」存地图节点名）：保留原始标量，不做数字强制。
      // ADD/SUB 对字符串 / 布尔无定义，统一退化为 SET（直接取新值）。
      after = castScalar(ft, newValue);
    } else {
      const nBefore = toNumber(before);
      const nVal = toNumber(newValue);
      if (op === "SET") after = nVal;
      else if (op === "SUB") after = nBefore - nVal;
      else after = nBefore + nVal;
    }
  }

  return { store: JSON.stringify(after), before, after };
}

// ========== 字段比较 ==========

/** 比较操作符类型 */
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

/** 字段比较结果 */
export interface FieldCompareResult {
  passed: boolean;
  actual: any;
  expected: any;
  detail: string;
}

/** 比较操作执行 */
export function compareOp(actual: number, op: CompareOp, expected: number): boolean {
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

/**
 * 对公司产业字段（列表/字典/数字）做前置比较，返回是否通过及前后值。
 */
export function compareField(
  currentRaw: string | null | undefined,
  fieldType: string,
  config: any,
  op: CompareOp,
  expected: any,
): FieldCompareResult {
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
      // 标量 STRING 字段：使用字典序比较，而非数值比较
      if (!isList && !isDict && (fieldType || "").toUpperCase() === "STRING") {
        const a = String(actual ?? "");
        const b = String(expected ?? "");
        const ok = (() => {
          switch (op) {
            case "GT": return a > b;
            case "LT": return a < b;
            case "LTE": return a <= b;
            case "GTE":
            default: return a >= b;
          }
        })();
        return { passed: ok, actual: a, expected: b, detail: `"${a}" ${op} "${b}"` };
      }
      // LIST/DICTIONARY：按长度比较
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

// ========== 工具函数 ==========

/** 解析存储的字段值 */
function parseStoredFieldValue(raw: string | null | undefined, fieldType: string): any {
  if (raw == null) return fieldType === "BOOLEAN" ? false : 0;
  if (typeof raw === "number") return raw;
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return raw;

  const ft = (fieldType || "STRING").toUpperCase();
  if (ft === "BOOLEAN") {
    return raw === "true" || raw === "1" || raw === "是";
  }
  if (ft === "NUMBER") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  // STRING
  return raw;
}

/** 解析 JSON 字符串（安全） */
export function parseJsonValue(raw: string | null | undefined): any {
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
export function combineValues(v1: any, v2: any, vop: "ADD" | "SUB" | "MUL", fieldType: string): any {
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
  const ft = (fieldType || "STRING").toUpperCase();
  if (ft === "STRING") return v1 == null ? "" : v1;
  if (ft === "BOOLEAN") return v1 === true || v1 === "true" || v1 === 1 || v1 === "1";
  const a = toNumber(v1);
  const b = toNumber(v2);
  if (vop === "MUL") return a * b;
  if (vop === "SUB") return a - b;
  return a + b;
}
