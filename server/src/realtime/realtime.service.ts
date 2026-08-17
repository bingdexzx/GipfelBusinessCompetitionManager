import { Injectable } from "@nestjs/common";
import { Server } from "socket.io";

/**
 * Prisma model 名 -> 前端资源 URL 首段（与 @Controller 前缀、client/src/api/cache.ts 的
 * groupPrefix 保持一致）。仅映射「会被 REST 增删改且需前端实时同步」的实体；
 * 不在表中的模型（如合同引擎内部表）不会触发变更广播。
 *
 * 注意：股票子资源（StockFundsAccount/StockOrder/StockHolding/StockCandle）使用
 * 细分的 resource 标识，避免删除订单时误伤持仓（S6 修复）。
 */
export const MODEL_TO_RESOURCE: Record<string, string> = {
  User: "users",
  Vehicle: "vehicles",
  Fuel: "fuels",
  TechNode: "tech-nodes",
  Company: "companies",
  Warehouse: "warehouses",
  ProductionLine: "production-lines",
  CompanyField: "company-fields",
  Infrastructure: "infrastructures",
  Competition: "competitions",
  Part: "parts",
  IndustryType: "industry-types",
  MapEdge: "map-edges",
  MapNodeType: "map-node-types",
  MapNode: "map-nodes",
  ContractType: "contract-types",
  Material: "materials",
  Contract: "contracts",
  Product: "products",
  PathType: "path-types",
  Stock: "stocks",
  StockFundsAccount: "stock-accounts",
  StockOrder: "stock-orders",
  StockHolding: "stock-holdings",
  StockCandle: "stock-candles",
};

/** 全局豁免实体（不按比赛隔离，向全体广播） */
export const GLOBAL_ENTITIES = new Set([
  "industry-types",
  "contract-types",
  "competitions",
]);

// 模块级单例引用：PrismaService 的审计中间件需要广播删除事件，但不宜与 PrismaModule
// 形成注入依赖（避免循环 / 模块耦合）。故由首个构造实例登记全局引用，供中间件取用。
let _singleton: RealtimeService | null = null;

/**
 * 通用实时广播服务。
 * Gateway 在 afterInit 时把 socket.io Server 实例注册进来，
 * 各业务 service 注入本服务即可向指定比赛房间或全体客户端推送事件。
 *
 * 事件格式（向后兼容）：
 * {
 *   resource: string,      // 资源类型
 *   id: number | null,     // 记录 ID
 *   action: string,        // 变更类型
 *   competitionId?: number, // 比赛 ID（新增）
 *   seq?: number,          // 事件序号（新增）
 *   ts?: number,           // 时间戳（新增）
 * }
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;
  private seq = 0; // 全局单调递增序号（内存计数，重启归零可接受）
  private eventBuffer: Array<{ event: string; data: any; ts: number }> = [];
  private readonly BUFFER_SIZE = 1000; // 环形缓冲大小

  constructor() {
    if (!_singleton) _singleton = this;
  }

  setServer(server: Server) {
    this.server = server;
  }

  get ready(): boolean {
    return !!this.server;
  }

  /** 获取下一个事件序号 */
  private nextSeq(): number {
    return ++this.seq;
  }

  /** 记录事件到环形缓冲（用于重连补发） */
  private bufferEvent(event: string, data: any) {
    this.eventBuffer.push({ event, data, ts: Date.now() });
    if (this.eventBuffer.length > this.BUFFER_SIZE) {
      this.eventBuffer.shift();
    }
  }

  /** 获取指定序号之后的事件（用于重连补发） */
  getEventsAfter(afterSeq: number): Array<{ event: string; data: any; ts: number }> {
    return this.eventBuffer.filter((e) => (e.data as any)?.seq > afterSeq);
  }

  /** 向某个比赛房间（仅同比赛的客户端）广播 */
  broadcastToCompetition(competitionId: number, event: string, data: any) {
    if (!this.server) return;
    this.server.to(`comp-${competitionId}`).emit(event, data);
  }

  /** 向所有已连接的客户端广播 */
  broadcastAll(event: string, data: any) {
    if (!this.server) return;
    this.server.emit(event, data);
  }

  /** 向指定用户的私有房间推送（用于定向到具体用户的消息 / 通知）。 */
  emitToUser(userId: number, event: string, data: any) {
    if (!this.server) return;
    this.server.to(`user-${userId}`).emit(event, data);
  }

  /** 向多个用户的私有房间批量推送。 */
  emitToUsers(userIds: number[], event: string, data: any) {
    if (!this.server) return;
    for (const id of userIds) {
      if (Number.isFinite(id)) this.server.to(`user-${id}`).emit(event, data);
    }
  }

  /**
   * 广播「某资源某条记录发生变更（created / updated / deleted / bulk）」，供前端实时作废
   * 本地缓存并刷新当前列表。
   * - competitionId 为数字：仅向该比赛房间广播（租户隔离，他人比赛不觉察）。
   * - competitionId 为 null：向全体客户端广播（用于全局模板，如合同类型 / 产业类型 /
   *   比赛本身），因为这些资源不分比赛归属。
   * @param action 变更类型：created=新增 / updated=更新 / deleted=删除 / bulk=批量（无单条 id）
   */
  emitResourceChanged(
    resource: string,
    id: number | null,
    competitionId: number | null,
    action: "created" | "updated" | "deleted" | "bulk",
  ) {
    if (!this.server) return;
    const seq = this.nextSeq();
    const ts = Date.now();
    const payload = { resource, id, action, competitionId, seq, ts };

    // 记录到环形缓冲
    this.bufferEvent("resource:changed", payload);

    if (competitionId != null) {
      this.server.to(`comp-${competitionId}`).emit("resource:changed", payload);
    } else {
      this.server.emit("resource:changed", payload);
    }
  }

  /**
   * 广播权限变更事件（定向到具体用户）
   * 用于实时同步权限/角色/范围变更
   */
  emitPermissionsChanged(userId: number, version: number) {
    if (!this.server) return;
    const seq = this.nextSeq();
    const ts = Date.now();
    const payload = { userId, version, seq, ts };
    this.server.to(`user-${userId}`).emit("permissions:changed", payload);
  }
}

/** 取实时服务单例（供非注入上下文如 Prisma 中间件使用）。 */
export function getRealtimeService(): RealtimeService | null {
  return _singleton;
}
