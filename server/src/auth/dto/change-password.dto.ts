import { IsString, MinLength } from "class-validator";
import { IsPasswordStrong } from "../../common/validators/password.validator";

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  oldPassword: string;

  @IsPasswordStrong()
  newPassword: string;
}
