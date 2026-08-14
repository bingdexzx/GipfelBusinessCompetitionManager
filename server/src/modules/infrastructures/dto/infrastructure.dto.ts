import { IsString, IsNumber, Min, IsOptional, IsInt } from "class-validator";

export class CreateInfrastructureDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  footprint: number;

  @IsNumber()
  @Min(0)
  employmentRateBonus: number;

  @IsNumber()
  @Min(0)
  populationBonus: number;

  @IsNumber()
  @Min(0)
  highQualityPopulationBonus: number;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(0)
  happinessIndexBonus: number;

  @IsNumber()
  @Min(0)
  perCapitaIncomeBonus: number;

  @IsNumber()
  @Min(0)
  carbonReductionBonus: number;

  @IsNumber()
  @Min(0)
  activationPrice: number;

  @IsOptional()
  @IsInt()
  competitionId?: number;
}

export class UpdateInfrastructureDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  footprint?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  employmentRateBonus?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  populationBonus?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  highQualityPopulationBonus?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  happinessIndexBonus?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  perCapitaIncomeBonus?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  carbonReductionBonus?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  activationPrice?: number;

  @IsOptional()
  @IsInt()
  competitionId?: number;
}
