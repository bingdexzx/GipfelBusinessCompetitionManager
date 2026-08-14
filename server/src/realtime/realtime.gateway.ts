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

@WebSocketGateway({
  cors: {
    origin: (origin: any, cb: any) => {
      // 同源 / Electron / 服务间调用（无 Origin）放行；带 Origin 时必须命中白名单。
      if (!origin || WS_ALLOWED_ORIGINS.includes(origin)) cb(null, true);
      else cb(new Error("CORS 来源不被允许"));
    },
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);

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
      const authToken =
        client.handshake.auth && client.handshake.auth.token
          ? client.handshake.auth.token
          : client.handshake.query && (client.handshake.query.token as string);
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
        select: { id: true, role: true, competitionId: true, mustChangePassword: true },
      })) as any;
      if (!user) {
        // 账号已被删除：即便令牌尚未过期也不允许接入实时通道。
        client.disconnect();
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
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(_client: Socket) {
    // 断开时 socket.io 会自动清理房间归属，无需额外处理
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
}
