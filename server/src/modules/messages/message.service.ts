import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeService } from "../../realtime/realtime.service";
import { CreateMessageDto, MessageImageDto } from "./dto/message.dto";
import { validateMessageImages } from "../../common/validators/json-schema";
import { assertValidated } from "../../common/assert-validated";
import { assertImageMime } from "../../common/image-mime";

interface Actor {
  id: number;
  role: string;
  competitionId?: number | null;
}

// 消息图片落盘目录（与 main.ts 的 /uploads 静态服务同源，前端经 getApiBaseUrl() + url 跨源加载）。
const MSG_UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "message-images");

/** 解析 PNG / JPEG 的像素尺寸；其他格式或解析失败返回 null（前端加载后再补）。 */
function readImageDimensions(
  buf: Buffer,
  mime: string,
): { width: number | null; height: number | null } {
  try {
    if (mime === "image/png" && buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/jpeg") {
      let off = 2;
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) break;
        const marker = buf[off + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) };
        }
        const len = buf.readUInt16BE(off + 2);
        off += 2 + len;
      }
    }
  } catch {
    /* 尺寸解析失败不阻塞上传，前端以实际加载结果为准 */
  }
  return { width: null, height: null };
}

/**
 * 消息中心业务：发布、收件箱、已发布、未读计数、标记已读、删除、选人。
 *
 * 收件人在发布时一次性结算为 MessageRecipient 行（「本比赛全体」与显式选人取并集去重），
 * 因此收件箱与未读状态以 MessageRecipient 为权威来源，与比赛隔离逻辑解耦——
 * 离线用户登录后也能在收件箱看到消息并带未读红点；在线用户同时收到实时弹窗推送。
 */
@Injectable()
export class MessageService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  /**
   * 上传消息图片（multipart 单文件），落盘到 uploads/message-images/，返回 {url, filename}。
   * 仅做结构落盘，不入库；真正发布时由 CreateMessageDto.images 携带这些元信息一并持久化。
   * 文件名前缀 userId 以避免并发冲突，删除消息时按 filename 清理。
   */
  async uploadImage(actor: Actor, file: { buffer: Buffer; mimetype: string; size: number }): Promise<MessageImageDto> {
    if (!file || !file.buffer) throw new BadRequestException("未收到文件");
    const ext = assertImageMime(file.mimetype);
    fs.mkdirSync(MSG_UPLOAD_DIR, { recursive: true });
    const safeName = `msg-${actor.id}-${Date.now()}-${randomUUID().slice(0, 12)}${ext}`;
    fs.writeFileSync(path.join(MSG_UPLOAD_DIR, safeName), file.buffer);
    readImageDimensions(file.buffer, file.mimetype); // 尺寸解析失败不阻塞
    return { url: `/uploads/message-images/${safeName}`, filename: safeName };
  }


  /**
   * 返回当前发布者可选择的用户（前端选人列表 + 服务端收件人范围校验）。
   * - 超管：全部用户（可附加 competitionId 过滤）。
   * - 其余角色：仅同比赛用户（未归属比赛的账号无可选用户）。
   */
  async getSelectableUsers(actor: Actor, competitionId?: number) {
    const where: any = {};
    if (actor.role === "SUPER_ADMIN") {
      // 超管：传了 competitionId 时，范围为「所选比赛内账号 ∪ 无归属比赛的系统账号
      // （超管等）」，既不广播到其他比赛，也保证系统账号能收到；不传则为全部比赛（全站广播）。
      if (competitionId != null) {
        where.OR = [{ competitionId }, { competitionId: null }];
      }
    } else {
      where.competitionId = actor.competitionId ?? null;
    }
    return this.prisma.user.findMany({
      where,
      select: { id: true, username: true, displayName: true, role: true, competitionId: true },
      orderBy: { id: "asc" },
    });
  }

  async create(actor: Actor, dto: CreateMessageDto) {
    // 校验 images JSON
    if (dto.images && dto.images.length > 0) {
      assertValidated(validateMessageImages(JSON.stringify(dto.images)));
    }
    // 超管可经 dto.competitionId 把收件范围收敛到指定比赛；归属账号忽略该字段，
    // 恒以自身 competitionId 为准。不传 competitionId 时超管作用于全部比赛（全站广播）。
    const selectable = await this.getSelectableUsers(actor, dto.competitionId);
    const selectableIds = new Set(selectable.map((u) => u.id));
    const recipientIds = new Set<number>();

    if (dto.targetUserIds && dto.targetUserIds.length) {
      for (const id of dto.targetUserIds) {
        if (!selectableIds.has(id)) {
          throw new ForbiddenException(`收件人 ${id} 不在你可发布的范围内`);
        }
        recipientIds.add(id);
      }
    }
    if (dto.targetsAll) {
      for (const id of selectableIds) recipientIds.add(id);
    }
    if (recipientIds.size === 0) {
      throw new BadRequestException("未选择任何接收人");
    }

    const MAX_RECIPIENTS = 500;
    if (recipientIds.size > MAX_RECIPIENTS) {
      throw new BadRequestException(`收件人数量超过上限（${MAX_RECIPIENTS}）`);
    }

    const message = await this.prisma.message.create({
      data: {
        title: dto.title,
        content: dto.content,
        senderId: actor.id,
        competitionId: actor.competitionId ?? null,
        targetsAll: !!dto.targetsAll,
        targetUserIds: JSON.stringify(dto.targetUserIds || []),
        images: JSON.stringify(dto.images || []),
        recipients: {
          create: Array.from(recipientIds).map((userId) => ({ userId })),
        },
      },
      include: { _count: { select: { recipients: true } } },
    });

    // 发送者昵称用于实时弹窗与收件箱展示（避免建立 sender 外键关系，按需查一次）。
    const sender = await this.prisma.user.findUnique({
      where: { id: message.senderId },
      select: { id: true, displayName: true, username: true },
    });
    const senderName = sender?.displayName || sender?.username || `用户${message.senderId}`;

    // 实时推送：向每位在线收件人私有房间推送新消息（离线用户登录后于收件箱看到未读）。
    this.realtime.emitToUsers(
      Array.from(recipientIds),
      "message:new",
      {
        id: message.id,
        title: message.title,
        content: message.content,
        senderId: message.senderId,
        senderName,
        createdAt: message.createdAt,
        images: dto.images || [],
      },
    );

    return { ...message, images: this.parseImages(message.images), senderName };
  }

  /** 当前用户的收件箱（按接收时间倒序），含消息体、已读状态与发送者昵称。 */
  async inbox(user: Actor) {
    const rows = await this.prisma.messageRecipient.findMany({
      where: { userId: user.id },
      include: { message: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const senderIds = [...new Set(rows.map((r) => r.message.senderId))];
    const senders = await this.prisma.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, displayName: true, username: true },
    });
    const senderMap = new Map(senders.map((s) => [s.id, s.displayName || s.username]));
    return rows.map((r) => ({
      recipientId: r.id,
      read: r.read,
      readAt: r.readAt,
      message: { ...r.message, images: this.parseImages(r.message.images) },
      senderName: senderMap.get(r.message.senderId) ?? `用户${r.message.senderId}`,
    }));
  }

  /** 当前用户已发布的消息（按发布时间倒序），含收件人计数。 */
  async sent(actor: Actor) {
    const msgs = await this.prisma.message.findMany({
      where: { senderId: actor.id },
      include: { _count: { select: { recipients: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const senderName = (actor as any)?.displayName || (actor as any)?.username || `用户${actor.id}`;
    return msgs.map((m) => ({ ...m, images: this.parseImages(m.images), senderName }));
  }

  /** 当前用户未读消息数。 */
  async unreadCount(user: Actor) {
    const count = await this.prisma.messageRecipient.count({
      where: { userId: user.id, read: false },
    });
    return { count };
  }

  async markRead(user: Actor, messageId: number) {
    const rec = await this.prisma.messageRecipient.findFirst({
      where: { messageId, userId: user.id },
    });
    if (!rec) throw new NotFoundException("消息不存在或不属于你");
    if (!rec.read) {
      await this.prisma.messageRecipient.update({
        where: { id: rec.id },
        data: { read: true, readAt: new Date() },
      });
    }
    return { message: "已标记为已读" };
  }

  async markAllRead(user: Actor) {
    await this.prisma.messageRecipient.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true, readAt: new Date() },
    });
    return { message: "已全部标记为已读" };
  }

  async remove(actor: Actor, messageId: number) {
    const msg = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException("消息不存在");
    if (actor.role !== "SUPER_ADMIN" && msg.senderId !== actor.id) {
      throw new ForbiddenException("只能删除自己发布的消息");
    }
    // 删除消息前清理其落盘图片（忽略异常，避免阻塞主流程）。
    this.deleteMessageImages(msg.images);
    await this.prisma.message.delete({ where: { id: messageId } });
    return { message: "已删除" };
  }

  /** 解析消息 images(JSON 字符串) 为元信息数组；损坏 / 为空时返回 []（不影响主流程）。 */
  private parseImages(raw: string | null | undefined): MessageImageDto[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((it) => it && typeof it.url === "string" && typeof it.filename === "string")
          .map((it) => ({ url: it.url, filename: it.filename }));
      }
    } catch {
      /* 损坏数据当作无图片 */
    }
    return [];
  }

  /** 解析消息 images(JSON 字符串) 并逐个删除落盘文件（忽略缺失 / 异常）。 */
  private deleteMessageImages(raw: string | null | undefined) {
    if (!raw) return;
    let arr: { filename?: string }[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      return;
    }
    for (const it of arr) {
      if (!it?.filename) continue;
      try {
        const p = path.join(MSG_UPLOAD_DIR, path.basename(it.filename));
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        /* 文件删除失败不影响主流程 */
      }
    }
  }
}
