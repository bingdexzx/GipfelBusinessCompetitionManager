import { IsString, IsNumber, IsOptional, IsInt, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class PrerequisiteItem {
  @IsNumber()
  prerequisiteNodeId: number;
}

export class CreateTechNodeDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  tier: number;

  @IsNumber()
  researchCost: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrerequisiteItem)
  prerequisites?: PrerequisiteItem[];

  @IsInt()
  competitionId!: number;
}

export class UpdateTechNodeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  tier?: number;

  @IsOptional()
  @IsNumber()
  researchCost?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrerequisiteItem)
  prerequisites?: PrerequisiteItem[];

  @IsOptional()
  @IsInt()
  competitionId?: number;
}
