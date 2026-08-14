import { Injectable } from "@nestjs/common";
import { Server } from "socket.io";

/**
 * Prisma model 名 -> 前端资源 URL 首段（与 @Controller 前缀、client/src/api/cache.ts 的
 * groupPrefix 保持一致）。仅映射「会被 REST 增删改且需前端实时同步」的实体；
 * 不在表中的模型（如合同引擎内部表）不会触发变更广播。
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
};

// 模块级单例引用：PrismaService 的审计中间件需要广播删除事件，但不宜与 PrismaModule
// 形成注入依赖（避免循环 / 模块耦合）。故由首个构造实例登记全局引用，供中间件取用。
let _singleton: RealtimeService | null = null;

/**
 * 通用实时广播服务。
 * Gateway 在 afterInit 时把 socket.io Server 实例注册进来，
 * 各业务 service 注入本服务即可向指定比赛房间或全体客户端推送事件。
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  constructor() {
    if (!_singleton) _singleton = this;
  }

  setServer(server: Server) {
    this.server = server;
  }

  get ready(): boolean {
    return !!this.server;
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
    const payload = { resource, id, action };
    if (competitionId != null) {
      this.server.to(`comp-${competitionId}`).emit("resource:changed", payload);
    } else {
      this.server.emit("resource:changed", payload);
    }
  }
}

/** 取实时服务单例（供非注入上下文如 Prisma 中间件使用）。 */
export function getRealtimeService(): RealtimeService | null {
  return _singleton;
}
