import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { RealtimeService } from "./realtime.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * 实时网关：复用 HTTP 服务（同源同端口，默认 3000），
 * 客户端通过 socket.io 连接，握手时携带 JWT 鉴权，
 * 连接后发送 { competitionId } 加入对应比赛房间，从而只收到该比赛的广播。
 */
const WS_ALLOWED_ORIGINS = (
  process.env.CORS_ORIGIN || "http://localhost:5173,http://localhost:3000,app://localhost"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const WS_ALLOW_ALL = WS_ALLOWED_ORIGINS.includes("*");

/** 与 main.ts isLocalOrPrivateOrigin 保持一致：判断来源是否为本地 / 内网。 */
function isLocalOrPrivateOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
    if (u.protocol === "file:" || u.protocol === "app:") return true;
    if (
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

@WebSocketGateway({
  cors: {
    origin: (origin: any, cb: any) => {
      // 同源 / Electron / 服务间调用（无 Origin）放行。
      if (!origin) return cb(null, true);
      if (WS_ALLOW_ALL) {
        // 通配模式：仅对本地/内网来源放行（与 main.ts 一致）
        if (isLocalOrPrivateOrigin(origin)) return cb(null, true);
        return cb(new Error("CORS 来源不被允许"));
      }
      // 显式白名单模式：命中即放行
      if (WS_ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS 来源不被允许"));
    },
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  private _replayThrottles = new Map<string, { count: number; resetAt: number }>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit() {
    this.realtime.setServer(this.server);
    this.logger.log("[Realtime] WebSocket 网关已初始化（同源端口）");
  }

  async handleConnection(client: Socket) {
    try {
      const authToken = client.handshake.auth?.token;
      if (!authToken) {
        client.disconnect();
        return;
      }
      const raw = authToken.startsWith("Bearer ") ? authToken.slice(7) : authToken;
      // 与 HTTP 侧（JwtStrategy）保持一致：校验时绑定 issuer / audience，
      // 避免可被其它系统误用的令牌在本网关被接受。
      const payload: any = this.jwtService.verify(raw, {
        issuer: process.env.JWT_ISSUER || "gipfel-competition",
        audience: process.env.JWT_AUDIENCE || "gipfel-competition-client",
      });
      if (!payload || !payload.sub) {
        client.disconnect();
        return;
      }
      // 解析调用者的比赛归属与角色，供 subscribe 时做房间归属校验（防跨比赛订阅）。
      const user = (await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, competitionId: true, mustChangePassword: true, tokenVersion: true },
      })) as any;
      if (!user) {
        // 账号已被删除：即便令牌尚未过期也不允许接入实时通道。
        client.disconnect();
        return;
      }
      // TokenVersion check: kick old device sessions (same as HTTP JwtStrategy)
      if (typeof payload.tv === "number" && payload.tv !== user.tokenVersion) {
        client.emit("auth:required", { reason: "账号已在其他设备登录" });
        client.disconnect(true);
        return;
      }
      if (user.mustChangePassword) {
        // 强制改密状态：断开实时通道，必须先改密（与 HTTP 侧 MustChangePasswordGuard 一致）。
        client.emit("auth:required", { reason: "账号需先修改初始密码" });
        client.disconnect();
        return;
      }
      client.data.userId = user.id;
      client.data.role = user.role;
      client.data.competitionId = user.competitionId ?? null;
      // 加入用户私有房间，便于按用户定向推送（如站内消息 / 通知）。
      // 断开时 socket.io 自动清理房间归属。
      client.join(`user-${user.id}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // 断开时 socket.io 会自动清理房间归属，无需额外处理
    this._replayThrottles.delete(client.id);
  }

  @SubscribeMessage("subscribe")
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { competitionId?: number },
  ) {
    if (!payload || typeof payload.competitionId !== "number") return;
    const cid = payload.competitionId;

    // 房间归属校验：仅允许订阅自身所属比赛（SUPER_ADMIN 可订阅任意比赛），
    // 防止已登录用户订阅其它比赛的广播、泄露活动。
    const role = (client.data as any)?.role;
    const ownCid = (client.data as any)?.competitionId;
    if (role !== "SUPER_ADMIN" && cid !== ownCid) {
      client.emit("subscribe:denied", {
        competitionId: cid,
        reason: "无权订阅该比赛的实时广播",
      });
      return;
    }
    client.join(`comp-${cid}`);
  }

  @SubscribeMessage("unsubscribe")
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { competitionId?: number },
  ) {
    if (payload && typeof payload.competitionId === "number") {
      client.leave(`comp-${payload.competitionId}`);
    }
  }

  /**
   * 处理重连补发请求
   * 客户端重连后发送 sync:replay，服务端补发遗漏的事件
   */
  @SubscribeMessage("sync:replay")
  handleSyncReplay(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { lastSeq?: number },
  ) {
    // Rate limit: max 5 replays per minute per client
    const now = Date.now();
    const key = client.id;
    let throttle = this._replayThrottles.get(key);
    if (!throttle || now > throttle.resetAt) {
      throttle = { count: 0, resetAt: now + 60_000 };
      this._replayThrottles.set(key, throttle);
    }
    if (throttle.count >= 5) return { replayed: 0, error: "请求过于频繁" };
    throttle.count++;

    if (!payload || typeof payload.lastSeq !== "number") return;
    // Validate lastSeq
    const lastSeq = Math.max(0, Math.min(payload.lastSeq, Number.MAX_SAFE_INTEGER));
    const events = this.realtime.getEventsAfter(lastSeq);
    if (events.length > 0) {
      client.emit("sync:replay:result", { events });
    } else {
      client.emit("sync:replay:result", { events: [] });
    }
  }
}
