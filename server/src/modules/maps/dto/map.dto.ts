import { IsString, IsNumber, IsOptional, Min, IsInt } from "class-validator";

// ===== MapNodeType =====
export class CreateMapNodeTypeDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsInt()
  competitionId!: number;
}

export class UpdateMapNodeTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;
}

// ===== PathType =====
export class CreatePathTypeDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsInt()
  competitionId!: number;
}

export class UpdatePathTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;
}

// ===== MapNode =====
export class CreateMapNodeDto {
  @IsString()
  name: string;

  @IsString()
  region: string;

  @IsNumber()
  nodeTypeId: number;

  @IsNumber()
  @Min(0)
  x: number;

  @IsNumber()
  @Min(0)
  y: number;

  @IsInt()
  competitionId!: number;
}

export class UpdateMapNodeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsNumber()
  nodeTypeId?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  x?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  y?: number;

  // 与 CreateMapNodeDto 保持一致：前端更新时总是携带 competitionId 用于作用域校验，
  // 全局 ValidationPipe 启用了 forbidNonWhitelisted，缺失该字段会导致 400 Bad Request。
  @IsOptional()
  @IsInt()
  competitionId?: number;
}

// ===== MapEdge =====
export class CreateMapEdgeDto {
  @IsNumber()
  fromNodeId: number;

  @IsNumber()
  toNodeId: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  distance?: number;

  @IsOptional()
  @IsNumber()
  pathTypeId?: number;

  @IsInt()
  competitionId!: number;
}

export class UpdateMapEdgeDto {
  @IsOptional()
  @IsNumber()
  fromNodeId?: number;

  @IsOptional()
  @IsNumber()
  toNodeId?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  distance?: number;

  @IsOptional()
  @IsNumber()
  pathTypeId?: number;

  // 与 CreateMapEdgeDto 保持一致：前端更新时总是携带 competitionId，
  // 缺失该字段会因 forbidNonWhitelisted 被全局 ValidationPipe 拒绝（400）。
  @IsOptional()
  @IsInt()
  competitionId?: number;
}
