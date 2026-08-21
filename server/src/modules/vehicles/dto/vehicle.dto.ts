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

class VehiclePathTypeItem {
  @IsNumber()
  pathTypeId: number;
}

export class CreateVehicleDto {
  @IsString()
  name: string;

  @IsNumber()
  fuelId: number;

  @IsNumber()
  @Min(0)
  fuelConsumptionPerKm: number;

  @IsNumber()
  @Min(0)
  maxCargo: number;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(0)
  carbonEmission: number;

  @IsOptional()
  @IsArray()
  pathTypeIds?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VehiclePathTypeItem)
  vehiclePathTypes?: VehiclePathTypeItem[];

  @IsInt()
  competitionId!: number;
}

export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  fuelId?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fuelConsumptionPerKm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxCargo?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  carbonEmission?: number;

  @IsOptional()
  @IsArray()
  pathTypeIds?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VehiclePathTypeItem)
  vehiclePathTypes?: VehiclePathTypeItem[];

  @IsOptional()
  @IsInt()
  competitionId?: number;
}
