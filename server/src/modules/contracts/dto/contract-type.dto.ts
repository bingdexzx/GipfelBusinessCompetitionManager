import { IsString, IsOptional, IsInt, IsBoolean } from "class-validator";

// 合同类型模板 DTO。
// partyRoles / inputSchema / effects 均为 JSON（字符串或对象均可，service 层统一 stringify）。
export class CreateContractTypeDto {
  @IsString()
  key: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  partyCount?: number;

  // JSON: [{role:"A",label:"放款方",selectable:true,isHost:false}, ...]
  // 注意：必须带 @IsOptional() 以在 class-validator 注册元数据，
  // 否则 forbidNonWhitelisted 会将其判为"不应存在的字段"而拒绝请求。
  @IsOptional()
  partyRoles: any;

  // JSON: [{key,label,type,required,default?,enum?}]
  @IsOptional()
  inputSchema: any;

  // JSON: 效果定义数组（见合同引擎）
  @IsOptional()
  effects: any;

  @IsOptional()
  conditions?: any; // JSON: 前置检查数组

  @IsOptional()
  graph?: any; // JSON: 可视化图结构（节点+连线+布局）

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateContractTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  partyCount?: number;

  @IsOptional()
  partyRoles?: any;

  @IsOptional()
  inputSchema?: any;

  @IsOptional()
  effects?: any;

  @IsOptional()
  conditions?: any;

  @IsOptional()
  graph?: any;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
