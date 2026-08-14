import { IsNumber, IsOptional, IsInt } from "class-validator";
import { Type } from "class-transformer";

/**
 * 背景图变换（位置 + 缩放）更新。
 * 数值经 FormData/JSON 可能被序列化为字符串，故统一用 @Type(() => Number) 在全局
 * transform 阶段转回数字，再经 @IsNumber 校验（与 MapBackgroundTargetDto 一致）。
 */
export class MapBackgroundTransformDto {
  @Type(() => Number)
  @IsNumber()
  x: number;

  @Type(() => Number)
  @IsNumber()
  y: number;

  @Type(() => Number)
  @IsNumber()
  scale: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  competitionId?: number;
}
