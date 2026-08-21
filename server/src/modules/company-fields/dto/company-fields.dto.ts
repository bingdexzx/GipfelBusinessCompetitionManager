import { IsArray, IsInt, ValidateNested, IsDefined } from "class-validator";
import { Type } from "class-transformer";

export class FieldValueItemDto {
  @IsInt()
  industryFieldId: number;

  // 任意类型的值：基础类型为 字符串/数字/布尔；字典/列表为对象/数组（由后端按字段类型校验与序列化）
  @IsDefined()
  value: any;
}

export class SetCompanyFieldValuesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldValueItemDto)
  values: FieldValueItemDto[];
}
