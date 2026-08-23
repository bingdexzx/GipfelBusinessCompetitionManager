import { BadRequestException } from "@nestjs/common";

/** 校验结果的最小接口（与 json-schema.ts 的 ValidationResult 对齐）。 */
export interface ValidationOutcome {
  success: boolean;
  error?: string;
}

/**
 * 统一的「校验失败即抛 400」辅助：消除各 service 中重复的
 * `if (!validation.success) throw new BadRequestException("JSON 校验失败: ...")` 样板。
 *
 * @param result 校验结果对象（需含 success 与可选 error）。
 * @param label  错误前缀，默认 "JSON"，用于区分不同业务字段的校验场景。
 */
export function assertValidated(result: ValidationOutcome, label = "JSON"): void {
  if (!result.success) {
    throw new BadRequestException(`${label}校验失败: ${result.error}`);
  }
}
