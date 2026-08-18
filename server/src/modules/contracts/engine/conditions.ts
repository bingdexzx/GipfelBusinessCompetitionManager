/**
 * 合同引擎 - 条件检查
 *
 * 从 contract-engine.service.ts 提取的条件检查相关类型和函数。
 * 包含前置检查（precheck）的类型定义。
 */

import { ValueSpec } from "./values";

// ========== 类型/常量：统一从共享包导入并 re-export（单一真源） ==========
import {
  ConditionKind,
  ConditionSpec,
  CheckResult,
  COND_KIND_LABEL,
} from "@gipfel/engine-dsl";
export {
  ConditionKind,
  ConditionSpec,
  CheckResult,
  COND_KIND_LABEL,
} from "@gipfel/engine-dsl";

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
