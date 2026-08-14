import { IsString, IsNumber, IsOptional, IsIn, IsInt } from "class-validator";

export class CreateWarehouseDto {
  @IsString()
  name: string;

  @IsNumber()
  capacity: number;

  @IsNumber()
  price: number;

  @IsString()
  @IsIn(["MATERIAL", "PART", "PRODUCT", "FUEL"])
  type: string;

  @IsOptional()
  @IsInt()
  competitionId?: number;
}

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  capacity?: number;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  @IsIn(["MATERIAL", "PART", "PRODUCT", "FUEL"])
  type?: string;

  @IsOptional()
  @IsInt()
  competitionId?: number;
}
