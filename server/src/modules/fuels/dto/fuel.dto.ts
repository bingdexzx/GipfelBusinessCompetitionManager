import { IsString, IsNumber, Min, IsOptional, IsInt } from "class-validator";

export class CreateFuelDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  pricePerLiter: number;

  @IsInt()
  competitionId!: number;
}

export class UpdateFuelDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerLiter?: number;

  @IsOptional()
  @IsInt()
  competitionId?: number;
}
