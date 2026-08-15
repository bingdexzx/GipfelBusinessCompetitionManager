import { IsString, IsOptional, IsInt, IsBoolean, IsIn, IsObject } from "class-validator";

// 产业字段类型：基础类型 + 结构化类型（字典 / 列表）
export const INDUSTRY_FIELD_TYPES = ["STRING", "NUMBER", "BOOLEAN", "DICTIONARY", "LIST"];

export class CreateIndustryTypeDto {
  @IsString()
  name: string;

  // 不传则由服务端自动分配（当前最大编号 +1）
  @IsOptional()
  @IsInt()
  code?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;
}

export class UpdateIndustryTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  code?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;
}

export class CreateIndustryFieldDto {
  @IsString()
  name: string;

  @IsString()
  fieldKey: string;

  @IsOptional()
  @IsIn(INDUSTRY_FIELD_TYPES)
  fieldType?: string;

  // 类型相关配置（结构化类型必填）：
  // - DICTIONARY -> { entries: [{ key, label, defaultValue? }], valueType: "NUMBER"|"STRING"|"BOOLEAN" }
  // - LIST       -> { itemType: "NUMBER"|"STRING"|"BOOLEAN" }
  // 基础类型可省略或传 {}
  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  @IsOptional()
  @IsString()
  defaultValue?: string;

  @IsOptional()
  @IsBoolean()
  isCalculated?: boolean;

  // 产业计算图（GGraph JSON 字符串）：isCalculated=true 时由该图在写入时级联重算本字段。
  // 提供时须为合法 JSON；旧 formula 字段不再使用。
  @IsOptional()
  @IsString()
  calcGraph?: string;

  @IsOptional()
  @IsString()
  formula?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  // 字段是否在前台展示，默认 true
  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  // 财年定时器：启用后于财年「开始(FY_START) / 结束(FY_END)」时自动把该字段写为 timerValue。
  // 不可与计算字段(isCalculated=true)同时启用。
  @IsOptional()
  @IsBoolean()
  timerEnabled?: boolean;

  // 触发时机：仅当 timerEnabled=true 时必填，取值 FY_START / FY_END
  @IsOptional()
  @IsIn(["FY_START", "FY_END"])
  timerTrigger?: string;

  // 触发后写入的设定值（按字段类型序列化的原始字符串；DICTIONARY/LIST 为 JSON 文本）。timerEnabled=true 时必填。
  @IsOptional()
  @IsString()
  timerValue?: string;
}

export class UpdateIndustryFieldDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  fieldKey?: string;

  @IsOptional()
  @IsIn(INDUSTRY_FIELD_TYPES)
  fieldType?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, any>;

  @IsOptional()
  @IsString()
  defaultValue?: string;

  @IsOptional()
  @IsBoolean()
  isCalculated?: boolean;

  // 产业计算图（GGraph JSON 字符串）：isCalculated=true 时由该图在写入时级联重算本字段。
  @IsOptional()
  @IsString()
  calcGraph?: string;

  @IsOptional()
  @IsString()
  formula?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  // 字段是否在前台展示
  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  // 财年定时器：启用后于财年「开始(FY_START) / 结束(FY_END)」时自动把该字段写为 timerValue。
  // 不可与计算字段(isCalculated=true)同时启用。
  @IsOptional()
  @IsBoolean()
  timerEnabled?: boolean;

  // 触发时机：仅当 timerEnabled=true 时必填，取值 FY_START / FY_END
  @IsOptional()
  @IsIn(["FY_START", "FY_END"])
  timerTrigger?: string;

  // 触发后写入的设定值（按字段类型序列化的原始字符串；DICTIONARY/LIST 为 JSON 文本）。timerEnabled=true 时必填。
  @IsOptional()
  @IsString()
  timerValue?: string;
}
