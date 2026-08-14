import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeService } from "../../realtime/realtime.service";
import { CreateMessageDto } from "./dto/message.dto";

interface Actor {
  id: number;
  role: string;
  competitionId?: number | null;
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
   * 返回当前发布者可选择的用户（前端选人列表 + 服务端收件人范围校验）。
   * - 超管：全部用户（可附加 competitionId 过滤）。
   * - 其余角色：仅同比赛用户（未归属比赛的账号无可选用户）。
   */
  async getSelectableUsers(actor: Actor, competitionId?: number) {
    const where: any = {};
    if (actor.role === "SUPER_ADMIN") {
      if (competitionId != null) where.competitionId = competitionId;
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

    const message = await this.prisma.message.create({
      data: {
        title: dto.title,
        content: dto.content,
        senderId: actor.id,
        competitionId: actor.competitionId ?? null,
        targetsAll: !!dto.targetsAll,
        targetUserIds: JSON.stringify(dto.targetUserIds || []),
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
      },
    );

    return { ...message, senderName };
  }

  /** 当前用户的收件箱（按接收时间倒序），含消息体、已读状态与发送者昵称。 */
  async inbox(user: Actor) {
    const rows = await this.prisma.messageRecipient.findMany({
      where: { userId: user.id },
      include: { message: true },
      orderBy: { createdAt: "desc" },
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
      message: r.message,
      senderName: senderMap.get(r.message.senderId) ?? `用户${r.message.senderId}`,
    }));
  }

  /** 当前用户已发布的消息（按发布时间倒序），含收件人计数。 */
  async sent(actor: Actor) {
    const msgs = await this.prisma.message.findMany({
      where: { senderId: actor.id },
      include: { _count: { select: { recipients: true } } },
      orderBy: { createdAt: "desc" },
    });
    const senderName = (actor as any)?.displayName || (actor as any)?.username || `用户${actor.id}`;
    return msgs.map((m) => ({ ...m, senderName }));
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
    await this.prisma.message.delete({ where: { id: messageId } });
    return { message: "已删除" };
  }
}
