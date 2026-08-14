import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { logger } from "../common/logging/logger.config";
import { sanitize } from "../common/logging/sanitize";
import { getRealtimeService, MODEL_TO_RESOURCE } from "../realtime/realtime.service";

const WRITE_ACTIONS = new Set([
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);

/** 仅对含可定位条件的单条写操作抓取「改前记录」，避免对批量/无主键场景多发查询。 */
const SINGLE_FETCH_ACTIONS = new Set(["update", "delete"]);

/**
 * 向实时通道广播资源变更事件（供前端实时作废缓存并刷新列表）。
 * 比赛归属优先级：改前记录 before 的 competitionId > 改后记录 result 的 competitionId；
 * 批量操作无法定位单条归属，按全局模板处理（competitionId=null → 全体广播）。
 */
function emitResourceChange(
  model: string | undefined,
  action: "created" | "updated" | "deleted" | "bulk",
  result: unknown,
  before: unknown,
  id: unknown,
) {
  if (!model) return;
  const resource = MODEL_TO_RESOURCE[model];
  if (!resource) return;
  const pickCompetitionId = (rec: unknown): number | null | undefined => {
    if (rec && typeof rec === "object" && "competitionId" in (rec as any)) {
      const v = (rec as any).competitionId;
      if (typeof v === "number") return v;
      if (v === null || v === undefined) return null;
    }
    return undefined;
  };
  let competitionId: number | null;
  if (action === "bulk") {
    competitionId = null;
  } else {
    const fromBefore = pickCompetitionId(before);
    const fromResult = pickCompetitionId(result);
    competitionId = (fromBefore ?? fromResult ?? null) as number | null;
  }
  getRealtimeService()?.emitResourceChanged(
    resource,
    id != null ? Number(id) : null,
    competitionId,
    action,
  );
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    this.registerAuditMiddleware();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * 数据库写操作审计中间件：对 create/update/delete 等写动作输出结构化审计日志，
   * 由 Winston format 自动附加 operator / requestId / ip，实现「谁在何时改了哪条数据、
   * 改前改后分别是什么」的详细溯源。
   *
   * 日志内容（全部经 sanitize 脱敏 / 截断）：
   *  - create / upsert：记录创建后的完整记录（after）。
   *  - update：记录改前记录（before）、改后记录（after）、本次变更集合（changes）。
   *  - delete：记录被删记录（before）。
   *  - createMany / updateMany / deleteMany：记录受影响数量（count）+ 脱敏后的 data/where。
   */
  private registerAuditMiddleware() {
    this.$use(async (params, next) => {
      const action = params.action;
      const isWrite = WRITE_ACTIONS.has(action);
      const where = (params.args as any)?.where;
      const canFetchBefore = SINGLE_FETCH_ACTIONS.has(action) && where && typeof where === "object";

      // 执行前抓取「改前记录」，供 update/delete/upsert 追溯旧值。
      let before: unknown = null;
      if (isWrite && canFetchBefore && params.model) {
        try {
          before = await (this as unknown as Record<string, any>)[params.model].findUnique({ where });
        } catch {
          before = null; // 抓取失败不影响主流程，仅缺失 before 字段。
        }
      }

      const result = await next(params);
      if (!isWrite) return result;

      // 主键 / 数量。
      let id: unknown = null;
      let count: number | null = null;
      if (action === "createMany" || action === "updateMany" || action === "deleteMany") {
        count = (result as any)?.count ?? null;
      } else if (action === "create" || action === "upsert") {
        id = (result as any)?.id ?? null;
      } else {
        id = where?.id ?? where ?? null;
      }

      const payload: Record<string, unknown> = {
        audit: true,
        model: params.model,
        action,
        id,
      };
      if (count !== null) payload.count = count;

      switch (action) {
        case "create":
        case "upsert":
          payload.after = sanitize((result as any) ?? null);
          // 实时同步：新增（upsert 视为新增）广播 created
          emitResourceChange(params.model, "created", result, before, id);
          break;
        case "update":
          payload.before = sanitize(before ?? null);
          payload.after = sanitize((result as any) ?? null);
          payload.changes = sanitize((params.args as any)?.data ?? null);
          // 实时同步：更新广播 updated
          emitResourceChange(params.model, "updated", result, before, id);
          break;
        case "delete":
          payload.before = sanitize(before ?? null);
          // 实时删除广播：被删实体（若有对应 REST 资源映射）向同比赛客户端推送
          // "resource:changed"(action=deleted)，前端据此立即作废本地缓存并刷新当前列表。
          // competitionId 取自「改前记录」before（已在中件中抓取），全局模板为 null → 全体广播。
          emitResourceChange(params.model, "deleted", result, before, id);
          break;
        case "createMany":
        case "updateMany":
          payload.data = sanitize((params.args as any)?.data ?? null);
          // 批量写：无法定位单条归属，按全局模板广播 bulk（前端作废该资源缓存并重拉）
          emitResourceChange(params.model, "bulk", null, before, null);
          break;
        case "deleteMany":
          payload.where = sanitize(where ?? null);
          emitResourceChange(params.model, "bulk", null, before, null);
          break;
      }

      logger.info("数据库写操作", payload);
      return result;
    });
  }
}
