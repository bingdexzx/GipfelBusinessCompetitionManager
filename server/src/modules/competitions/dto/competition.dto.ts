import { IsString, IsOptional, IsIn, IsObject, IsInt, Min, Max } from "class-validator";
import { CompetitionStatus, FiscalYearStatus } from "@prisma/client";

export class CreateCompetitionDto {
  @IsString()
  name: string;
}

export class UpdateCompetitionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(["ACTIVE", "CLOSED"])
  status?: CompetitionStatus;

  // 股票系统全局配置（JSON，S8）：比赛级 stockConfig，缺失字段回退默认值
  @IsOptional()
  @IsObject()
  stockConfig?: any;
}

export class CreateFiscalYearDto {
  @IsInt()
  @Min(0)
  @Max(99)
  year!: number;
}

export class UpdateFiscalYearDto {
  @IsOptional()
  @IsString()
  @IsIn(["ACTIVE", "CLOSED"])
  status?: FiscalYearStatus;
}
