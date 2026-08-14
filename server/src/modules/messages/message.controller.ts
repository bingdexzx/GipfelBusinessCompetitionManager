import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MessageService } from "./message.service";
import { CreateMessageDto } from "./dto/message.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../permissions/permissions.guard";
import { RequirePermissions } from "../../permissions/permissions.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { NoCompetitionScope } from "../../common/decorators/no-competition-scope.decorator";

/**
 * 消息中心接口。
 * 收件箱 / 未读 / 已读以当前用户（userId）为过滤维度，不依赖 competitionId，
 * 故整体豁免 CompetitionScopeGuard（@NoCompetitionScope），避免未归属比赛（超管）被误拒。
 */
@Controller("messages")
@UseGuards(JwtAuthGuard)
@NoCompetitionScope()
export class MessageController {
  constructor(private service: MessageService) {}

  /** 可选收件人（发布者同比赛 / 超管全部）；超管可附加 competitionId 过滤。 */
  @Get("selectable-users")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("message:manage")
  selectableUsers(@CurrentUser() actor: any, @Query("competitionId") competitionId?: string) {
    const cid = competitionId ? parseInt(competitionId, 10) : undefined;
    return this.service.getSelectableUsers(actor, Number.isNaN(cid as number) ? undefined : cid);
  }

  /** 发布消息。 */
  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions("message:manage")
  create(@CurrentUser() actor: any, @Body() dto: CreateMessageDto) {
    return this.service.create(actor, dto);
  }

  /**
   * 上传消息图片（multipart 单文件）。仅 message:manage 可调用（仅发布者需要）。
   * 返回 { url, filename }，前端在发布时将其填入 CreateMessageDto.images 一并提交。
   * 复用 /uploads 静态托管：落盘于 uploads/message-images/，前端经 getApiBaseUrl() + url 跨源加载。
   */
  @Post("upload-image")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("message:manage")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
      fileFilter: (_req, file, cb) => {
        const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"];
        if (!ALLOWED.includes(file.mimetype)) {
          return cb(new BadRequestException("仅支持图片文件（PNG / JPEG / GIF / WebP / BMP）"), false);
        }
        cb(null, true);
      },
    }),
  )
  uploadImage(@CurrentUser() actor: any, @UploadedFile() file: any) {
    return this.service.uploadImage(actor, file);
  }

  /** 收件箱（当前用户）。 */
  @Get("inbox")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("message:view")
  inbox(@CurrentUser() user: any) {
    return this.service.inbox(user);
  }

  /** 已发布（当前用户发布的消息）。 */
  @Get("sent")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("message:manage")
  sent(@CurrentUser() actor: any) {
    return this.service.sent(actor);
  }

  /** 未读计数（当前用户）。 */
  @Get("unread-count")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("message:view")
  unreadCount(@CurrentUser() user: any) {
    return this.service.unreadCount(user);
  }

  /** 标记单条已读。 */
  @Patch(":id/read")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("message:view")
  markRead(@CurrentUser() user: any, @Param("id", ParseIntPipe) id: number) {
    return this.service.markRead(user, id);
  }

  /** 全部标记为已读。 */
  @Post("read-all")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("message:view")
  markAllRead(@CurrentUser() user: any) {
    return this.service.markAllRead(user);
  }

  /** 删除自己发布的消息（级联删除收件人记录）。 */
  @Delete(":id")
  @UseGuards(PermissionsGuard)
  @RequirePermissions("message:manage")
  remove(@CurrentUser() actor: any, @Param("id", ParseIntPipe) id: number) {
    return this.service.remove(actor, id);
  }
}
