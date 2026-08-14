import { IsInt, IsOptional } from "class-validator";
import { Type } from "class-transformer";

/**
 * 地图背景操作的目标比赛。
 * - 超管：可指定任意比赛 ID（competitionId 必填）。
 * - 归属账号：忽略 competitionId，强制使用其所属比赛（competitionId 留空）。
 *
 * 注意：客户端经 FormData/JSON 传参时 competitionId 可能被序列化为字符串（如 "3"），
 * 故用 @Type(() => Number) 在全局 transform 阶段先转为数字，@IsInt 才能通过。
 */
export class MapBackgroundTargetDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  competitionId?: number;
}
