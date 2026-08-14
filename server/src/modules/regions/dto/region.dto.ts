import { IsString, IsOptional, IsInt, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

/** 区域总览卡片：绑定区域内某公司的某个产业字段 + 展示名。 */
export class OverviewCardDto {
  @IsString()
  id: string;

  @IsString()
  displayName: string;

  @IsInt()
  companyId: number;

  @IsInt()
  industryFieldId: number;

  // 数据框归属区：'top'=上半区（消费者需求区），其余/缺省=下半区（区域数据区）
  @IsOptional()
  @IsString()
  zone?: string;

  // ===== 以下为 resolveCards 计算的只读展示字段，前端会随卡片回传，必须声明以免触发 forbidNonWhitelisted =====
  @IsOptional()
  valid?: boolean;

  @IsOptional()
  value?: any;

  @IsOptional()
  @IsString()
  fieldName?: string;

  @IsOptional()
  @IsString()
  fieldType?: string;

  @IsOptional()
  @IsString()
  companyName?: string;
}

export class CreateRegionDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  competitionId?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverviewCardDto)
  overviewCards?: OverviewCardDto[];
}

export class UpdateRegionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverviewCardDto)
  overviewCards?: OverviewCardDto[];
}

export class SaveOverviewCardsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverviewCardDto)
  cards: OverviewCardDto[];
}
