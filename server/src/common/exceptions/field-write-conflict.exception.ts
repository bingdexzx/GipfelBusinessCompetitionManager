import { ConflictException } from "@nestjs/common";

/**
 * 字段值写入乐观锁冲突：同一 (companyId, industryFieldId) 在重试上限内仍被其他写入抢占，
 * 无法安全提交。调用方可视情况提示用户重试或合并后重提。
 */
export class FieldWriteConflictException extends ConflictException {
  constructor(companyId: number, industryFieldId: number) {
    super(
      `产业字段值写入冲突：公司 #${companyId} 字段 #${industryFieldId} 在并发写入中版本不一致，请稍后重试。`,
    );
  }
}
