/**
 * 合同引擎模块导出
 *
 * 统一导出拆分后的引擎子模块，便于外部引用。
 */

// 值解析工具
export {
  toNumber,
  isTruthy,
  toNumberArray,
  deepEqual,
  castScalar,
  compareOp,
  COMPARE_OP_LABEL,
  COND_KIND_LABEL,
  condKindLabel,
  safeParse,
  ENTITY_MODEL,
  type ValueSpec,
  type EntityType,
  type PartyDef,
  type EvalCtx,
  type CompareOp,
  type ValueType,
} from "./values";

// 效果执行
export {
  applyFieldEffect,
  compareField,
  parseJsonValue,
  combineValues,
  type FieldEffectOp,
  type FieldEffectResult,
  type FieldCompareResult,
} from "./effects";

// 条件检查
export {
  createCheckResult,
  createSkippedCheckResult,
  createPassedCheckResult,
  createFailedCheckResult,
  getCheckErrorMessage,
  type ConditionKind,
  type ConditionSpec,
  type CheckResult,
} from "./conditions";
