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
   * 数据库写操作审计 + 实时广播（Prisma 6 已移除 $use 中间件，改用 $extends 的 $allOperations 查询扩展）。
   * operation 即原 $use 的 params.action；query(args) 即原 next(params)。
   * 日志内容（全部经 sanitize 脱敏 / 截断）与实时广播语义同前：
   *  - create / upsert：记录创建后的完整记录（after）并广播 created。
   *  - update：记录改前(before)/改后(after)/变更(changes)并广播 updated。
   *  - delete：记录被删记录(before)并广播 deleted。
   *  - createMany / updateMany / deleteMany：记录受影响数量(count)/脱敏 data/where 并广播 bulk。
   */
  private registerAuditMiddleware() {
    const extended = this.$extends({
      query: {
        $allOperations: async function (
          this: PrismaClient,
          { model, operation, args, query }: any,
        ) {
          const action = operation as string;
          const isWrite = WRITE_ACTIONS.has(action);
          const where = (args as any)?.where;
          const canFetchBefore =
            SINGLE_FETCH_ACTIONS.has(action) && where && typeof where === "object";

          // 执行前抓取「改前记录」，供 update/delete/upsert 追溯旧值。
          let before: unknown = null;
          if (isWrite && canFetchBefore && model) {
            try {
              before = await (this as unknown as Record<string, any>)[model].findUnique({ where });
            } catch {
              before = null; // 抓取失败不影响主流程，仅缺失 before 字段。
            }
          }

          const result = await query(args);
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
            model,
            action,
            id,
          };
          if (count !== null) payload.count = count;

          switch (action) {
            case "create":
            case "upsert":
              payload.after = sanitize((result as any) ?? null);
              emitResourceChange(model, "created", result, before, id);
              break;
            case "update":
              payload.before = sanitize(before ?? null);
              payload.after = sanitize((result as any) ?? null);
              payload.changes = sanitize((args as any)?.data ?? null);
              emitResourceChange(model, "updated", result, before, id);
              break;
            case "delete":
              payload.before = sanitize(before ?? null);
              emitResourceChange(model, "deleted", result, before, id);
              break;
            case "createMany":
            case "updateMany":
              payload.data = sanitize((args as any)?.data ?? null);
              emitResourceChange(model, "bulk", null, before, null);
              break;
            case "deleteMany":
              payload.where = sanitize(where ?? null);
              emitResourceChange(model, "bulk", null, before, null);
              break;
          }

          logger.info("数据库写操作", payload);
          return result;
        },
      },
    } as any);

    // Prisma 6 的 $extends 返回新实例（不可原地修改），此处把本实例原型接到扩展客户端之上，
    // 同时保留 PrismaService 自身方法（onModuleInit/onModuleDestroy）可达。
    const extProto = Object.getPrototypeOf(extended);
    const svcProto = Object.getPrototypeOf(this);
    Object.setPrototypeOf(extProto, svcProto);
    Object.setPrototypeOf(this, extProto);
  }
}
