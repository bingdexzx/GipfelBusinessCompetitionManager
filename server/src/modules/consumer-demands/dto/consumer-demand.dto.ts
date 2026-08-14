import { IsInt, IsOptional, IsString, Min } from "class-validator";

/** 新建消费者需求：归属比赛 + 区域 + 关联产品 + 数量 + 备注。 */
export class CreateConsumerDemandDto {
  @IsOptional()
  @IsInt()
  competitionId?: number;

  @IsString()
  region: string;

  /** 关联产品（产品主数据 id）；产品名称由后端按 id 冗余写入 productType。 */
  @IsInt()
  productId: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsString()
  note?: string;
}

/** 更新消费者需求：各字段均可选。 */
export class UpdateConsumerDemandDto {
  @IsOptional()
  @IsString()
  region?: string;

  /** 关联产品（产品主数据 id）；提供时后端按 id 冗余写入 productType。 */
  @IsOptional()
  @IsInt()
  productId?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
