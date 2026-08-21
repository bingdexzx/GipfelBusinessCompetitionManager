import { IsString, IsOptional, IsInt, IsIn } from "class-validator";

export class CreateCompanyDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsInt()
  industryTypeId?: number;

  @IsInt()
  competitionId!: number;

  @IsOptional()
  @IsInt()
  regionId?: number;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(["ACTIVE", "INACTIVE"])
  status?: string;

  @IsOptional()
  @IsInt()
  regionId?: number;
}

export class UpdateFieldValueDto {
  @IsString()
  value: string;
}
