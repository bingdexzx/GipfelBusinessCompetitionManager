import { IsInt, IsOptional } from "class-validator";

/**
 * 地图背景操作的目标比赛。
 * - 超管：可指定任意比赛 ID（competitionId 必填）。
 * - 归属账号：忽略 competitionId，强制使用其所属比赛（competitionId 留空）。
 */
export class MapBackgroundTargetDto {
  @IsOptional()
  @IsInt()
  competitionId?: number;
}
