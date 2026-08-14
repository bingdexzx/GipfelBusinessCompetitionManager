import { IsString, IsNumber, IsOptional, IsInt, Min } from "class-validator";

export class CreateProductionLineDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsInt()
  @Min(1)
  laborCount: number;

  @IsNumber()
  @Min(0)
  maxPerYear: number;

  @IsOptional()
  @IsInt()
  competitionId?: number;
}

export class UpdateProductionLineDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  laborCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPerYear?: number;

  @IsOptional()
  @IsInt()
  competitionId?: number;
}
