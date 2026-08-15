import { IsString, MinLength, IsOptional, IsIn, IsInt, IsArray } from "class-validator";
import { Transform } from "class-transformer";
import { IsPasswordStrong } from "../../common/validators/password.validator";

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  username: string;

  @IsPasswordStrong()
  password: string;

  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null ? undefined : value))
  @IsIn(["SUPER_ADMIN", "COMPETITION_ADMIN", "PLAYER"])
  role?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  // 归一化：null / "" / undefined → undefined（@IsOptional 才会跳过）；
  // 字符串数字 → 数字整数。避免“未归属比赛时传 null 触发 @IsInt 校验 400”。
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === "") return undefined;
    if (typeof value === "string") {
      const n = Number(value);
      return Number.isNaN(n) ? value : n;
    }
    return value;
  })
  @IsInt()
  competitionId?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  companyScopes?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  viewCompanyScopes?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  contractViewCompanyScopes?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  stockCompanyScopes?: number[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsIn(["SUPER_ADMIN", "COMPETITION_ADMIN", "PLAYER"])
  role?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  companyScopes?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  viewCompanyScopes?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  contractViewCompanyScopes?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  stockCompanyScopes?: number[];
}

export class UpdatePasswordDto {
  @IsPasswordStrong()
  password: string;

  // 自助改密（修改自身密码）时必须提供原密码；管理员重置他人密码可不传。
  @IsOptional()
  @IsString()
  @MinLength(6)
  oldPassword?: string;
}
