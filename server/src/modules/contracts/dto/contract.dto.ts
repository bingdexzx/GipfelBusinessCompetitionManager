import { IsString, IsOptional, IsInt, IsIn, IsObject } from "class-validator";

// 合同实例 DTO（创建即存草稿，编号分步补全）。
// parties: JSON [{role:"A",companyId:5,isHost:false,contractNumber:"HT-001"}, ...]
//   - 非主办方参与方的 contractNumber 允许为空（建单时仅发起方填自己那方，其余留空待补）。
// inputs:  JSON 已填写的输入参数（与 ContractType.inputSchema 对应）。
// 注意：合同名称不再由用户填写，创建时自动取合同类型名称；创建仅存 DRAFT，不执行。
export class CreateContractDto {
  @IsInt()
  competitionId: number;

  @IsInt()
  contractTypeId: number;

  // 注意：带 @IsOptional() 以在 class-validator 注册元数据，
  // 否则 forbidNonWhitelisted 会将其判为"不应存在的字段"而拒绝创建合同请求。
  @IsOptional()
  parties: any;

  @IsOptional()
  inputs?: any;
}

export class ExecuteContractDto {
  // 执行时允许覆盖/补全输入参数
  @IsOptional()
  inputs?: any;
  // 合同编号不再由执行接口接收：各方编号已随分步补全写回 parties，执行前由引擎校验是否齐全。
}

// 分步补全合同编号：role -> 编号。
// 仅传入需要补/改的参与方；主办方（isHost）忽略；权限隔离只接受审核范围内公司的参与方。
export class UpdatePartyNumbersDto {
  @IsObject()
  partyNumbers: Record<string, string>;
}

// 会签模型下 setStatus 仅用于「标记终止」：状态转换由 execute / remove / updatePartyNumbers 驱动，
// 禁止直接置 EXECUTED（绕过执行落账）或回退 DRAFT/PENDING_EXEC（绕过复原/编号流程）。
export class UpdateContractStatusDto {
  @IsString()
  @IsIn(["TERMINATED"])
  status: string;
}
