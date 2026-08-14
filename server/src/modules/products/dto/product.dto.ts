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

class ProductPartItem {
  @IsNumber()
  partId: number;

  @IsNumber()
  @Min(0)
  ratio: number;
}

class TechRequirementItem {
  @IsNumber()
  techNodeId: number;
}

export class CreateProductDto {
  @IsString()
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductPartItem)
  productParts: ProductPartItem[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TechRequirementItem)
  techRequirements: TechRequirementItem[];

  @IsOptional()
  @IsInt()
  competitionId?: number;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductPartItem)
  productParts?: ProductPartItem[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TechRequirementItem)
  techRequirements?: TechRequirementItem[];

  @IsOptional()
  @IsInt()
  competitionId?: number;
}
