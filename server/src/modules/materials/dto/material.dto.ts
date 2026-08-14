import { IsString, IsNumber, Min, IsOptional, IsIn, IsInt } from "class-validator";

export class CreateMaterialDto {
  @IsString()
  name: string;

  @IsString()
  origin: string;

  @IsNumber()
  @Min(0)
  carbonEmissionCoefficient: number;

  @IsOptional()
  @IsString()
  @IsIn(["NORMAL", "SPECIAL"])
  type?: string;

  // 按地点（地图节点）价格：JSON 字符串 { [mapNodeId]: 价格 }。
  @IsOptional()
  @IsString()
  nodePrices?: string;

  @IsOptional()
  @IsInt()
  competitionId?: number;
}

export class UpdateMaterialDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  origin?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  carbonEmissionCoefficient?: number;

  @IsOptional()
  @IsString()
  @IsIn(["NORMAL", "SPECIAL"])
  type?: string;

  // 按地点（地图节点）价格：JSON 字符串 { [mapNodeId]: 价格 }。
  @IsOptional()
  @IsString()
  nodePrices?: string;

  @IsOptional()
  @IsInt()
  competitionId?: number;
}
