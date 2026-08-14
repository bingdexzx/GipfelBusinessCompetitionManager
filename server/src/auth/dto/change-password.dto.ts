import { IsString, MinLength, IsOptional, IsInt } from "class-validator";
import { IsPasswordStrong } from "../../common/validators/password.validator";

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  oldPassword: string;

  @IsPasswordStrong()
  newPassword: string;

  // 某些调用方（如带比赛上下文的客户端）会随请求回传 competitionId。
  // 全局 ValidationPipe 启用了 forbidNonWhitelisted，若不声明此字段会导致 400。
  // 后端改密仅依据 JWT 中的 userId，competitionId 仅作白名单透传、不参与逻辑。
  @IsOptional()
  @IsInt()
  competitionId?: number;
}
