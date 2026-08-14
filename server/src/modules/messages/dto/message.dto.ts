import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

/** 消息图片元信息（发布时由前端经上传接口预取到 {url, filename} 后回传）。 */
export class MessageImageDto {
  /** 相对服务端根的路径，形如 /uploads/message-images/xxx.png */
  @IsString()
  url: string;

  /** 落盘文件名（用于删除时定位文件）。 */
  @IsString()
  filename: string;
}

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

  /**
   * 目标比赛 id（仅超管可传，用于把「本比赛全体」或显式选人收敛到指定比赛）。
   * 归属账号忽略此字段，恒以自身 competitionId 为准。
   * 超管不传则为「全部比赛」（全站广播），与前端「按比赛筛选」下拉的「不筛选」语义一致。
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  competitionId?: number;

  /**
   * 消息附带图片（可选）：元素为经 messages/upload-image 预上传后回传的 {url, filename}。
   * 仅做结构校验，落盘文件在服务端 upload-image 时已写入 uploads/message-images/。
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MessageImageDto)
  images?: MessageImageDto[];
}
