import {
  Controller,
  Post,
  Delete,
  Get,
  Patch,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  Query,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { NoCompetitionScope } from "../../common/decorators/no-competition-scope.decorator";
import { FilesService } from "./files.service";
import { MapBackgroundTargetDto } from "./dto/map-background.dto";
import { MapBackgroundTransformDto } from "./dto/map-background-transform.dto";
import { ALLOWED_IMAGE_MIME } from "../../common/image-mime";

/**
 * 文件上传接口（地图背景图）。
 * 标记为 @NoCompetitionScope：比赛归属由 FilesService.resolveTarget 按角色强制收敛，
 * 不使用全局 CompetitionScopeGuard（超管 own=null 时全局守卫会直接拒绝）。
 */
@Controller("files")
@NoCompetitionScope()
export class FilesController {
  constructor(private service: FilesService) {}

  @Post("map-background")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("data:map:edit")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_IMAGE_MIME.includes(file.mimetype)) {
          return cb(
            new BadRequestException("仅支持图片文件（PNG / JPEG / GIF / WebP / BMP）"),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  upload(
    @CurrentUser() user: any,
    @UploadedFile() file: any,
    @Body() dto: MapBackgroundTargetDto,
  ) {
    return this.service.upload(user, file, dto.competitionId);
  }

  @Delete("map-background")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("data:map:edit")
  remove(@CurrentUser() user: any, @Body() dto: MapBackgroundTargetDto) {
    return this.service.remove(user, dto.competitionId);
  }

  @Get("map-background")
  @UseGuards(JwtAuthGuard)
  get(@CurrentUser() user: any, @Query("competitionId") competitionId?: string) {
    const cid =
      competitionId != null ? parseInt(competitionId, 10) : undefined;
    return this.service.getBackground(
      user,
      Number.isNaN(cid as number) ? undefined : cid,
    );
  }

  @Patch("map-background/transform")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions("data:map:edit")
  updateTransform(
    @CurrentUser() user: any,
    @Body() dto: MapBackgroundTransformDto,
  ) {
    return this.service.updateTransform(
      user,
      { x: dto.x, y: dto.y, scale: dto.scale },
      dto.competitionId,
    );
  }
}
