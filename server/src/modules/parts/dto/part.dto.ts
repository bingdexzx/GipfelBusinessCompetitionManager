import {
  IsString,
  IsNumber,
  IsArray,
  ValidateNested,
  IsOptional,
  IsInt,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

class PartMaterialItem {
  @IsNumber()
  materialId: number;

  @IsNumber()
  @Min(0)
  ratio: number;
}

class TechRequirementItem {
  @IsNumber()
  techNodeId: number;
}

export class CreatePartDto {
  @IsString()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartMaterialItem)
  partMaterials: PartMaterialItem[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TechRequirementItem)
  techRequirements: TechRequirementItem[];

  @IsOptional()
  @IsInt()
  competitionId?: number;
}

export class UpdatePartDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartMaterialItem)
  partMaterials?: PartMaterialItem[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TechRequirementItem)
  techRequirements?: TechRequirementItem[];

  @IsOptional()
  @IsInt()
  competitionId?: number;
}
