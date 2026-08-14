import { IsArray, IsBoolean, IsInt, IsOptional, IsString, MinLength } from "class-validator";

/** 发布消息：标题 + 正文 + 收件范围（全体可选用户 或/且 显式指定用户）。 */
export class CreateMessageDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @MinLength(1)
  content: string;

  /** 是否向「可选范围内全体用户」发布（发布者同比赛 / 超管全部）。与 targetUserIds 取并集。 */
  @IsOptional()
  @IsBoolean()
  targetsAll?: boolean;

  /** 显式指定收件人用户 id（与 targetsAll 取并集后去重）。 */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  targetUserIds?: number[];
}
