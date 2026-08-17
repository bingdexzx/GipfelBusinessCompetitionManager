/**
 * 合同引擎 - 条件检查
 *
 * 从 contract-engine.service.ts 提取的条件检查相关类型和函数。
 * 包含前置检查（precheck）的类型定义。
 */

import { ValueSpec } from "./values";

// ========== 类型定义 ==========

/** 检查类型 */
export type ConditionKind =
  | "FIELD_COMPARE"
  | "VALUE_COMPARE"
  | "INDUSTRY_IS"
  | "DICT_COMPARE"
  | "LIST_COMPARE";

/** 检查规格 */
export interface ConditionSpec {
  id?: string;
  label?: string;
  errorMessage?: string;
  kind: ConditionKind;
  party?: string;
  fieldKey?: string;
  industryTypeId?: number;
  op?: string;
  value?: ValueSpec;
  value1?: ValueSpec;
  value2?: ValueSpec;
  // 控制流：若本检查挂在某个 IF 分支之下，仅当该分支条件成立时才执行
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

/** 获取检查类型的中文标签 */
export function condKindLabel(kind: string): string {
  return COND_KIND_LABEL[kind] || kind;
}

/** 检查结果工厂函数 */
export function createCheckResult(
  kind: string,
  party: string,
  passed: boolean,
  detail: string,
  options?: {
    label?: string;
    actual?: any;
    expected?: any;
    customError?: boolean;
    skipped?: boolean;
  },
): CheckResult {
  return {
    kind,
    party,
    passed,
    detail,
    ...options,
  };
}

/** 创建跳过的检查结果（因 IF 分支未触发） */
export function createSkippedCheckResult(
  kind: string,
  party: string,
  label?: string,
): CheckResult {
  return {
    kind,
    party,
    passed: true,
    detail: "条件分支未触发，跳过检查",
    skipped: true,
    label,
  };
}

/** 创建通过的检查结果 */
export function createPassedCheckResult(
  kind: string,
  party: string,
  detail: string,
  options?: { label?: string; actual?: any; expected?: any },
): CheckResult {
  return createCheckResult(kind, party, true, detail, options);
}

/** 创建失败的检查结果 */
export function createFailedCheckResult(
  kind: string,
  party: string,
  detail: string,
  options?: {
    label?: string;
    actual?: any;
    expected?: any;
    errorMessage?: string;
  },
): CheckResult {
  return createCheckResult(kind, party, false, detail, {
    ...options,
    customError: !!options?.errorMessage,
  });
}

/** 获取检查结果的错误消息 */
export function getCheckErrorMessage(result: CheckResult): string {
  if (result.passed) return "";
  if (result.customError) return result.detail;
  const kindLabel = condKindLabel(result.kind);
  const label = result.label ? `[${result.label}]` : "";
  return `${kindLabel}${label}: ${result.detail}`;
}
