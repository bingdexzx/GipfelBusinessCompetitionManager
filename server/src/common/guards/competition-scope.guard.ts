import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { NO_COMPETITION_SCOPE_KEY } from "../decorators/no-competition-scope.decorator";

/**
 * 比赛数据归属守卫（修复跨租户读 / 删越权）：
 *
 * 业务列表 / 详情 / 删除接口信任客户端传入的 `competitionId` 进行过滤，但原实现并未校验
 * 请求者是否真的属于该比赛——一个 A 比赛的玩家只需把 `?competitionId=B` 就能读走
 * B 比赛的全部数据；更严重的是，若**根本不传** `competitionId`，多数 service 会以
 * `where = {}` 返回所有比赛的数据，删除接口则因 `assertSameCompetition(..., undefined)`
 * 直接放行而可跨比赛删除。本守卫在认证之后强制收敛作用域：
 *
 * - SUPER_ADMIN 可访问任意比赛（含全量）。
 * - 其余角色：显式传入的 competitionId 必须与其所属比赛一致。
 * - 未传 competitionId 时，非超管默认把作用域收窄到本人所属比赛（注入到 query），
 *   既杜绝「不传 ID 拉走/删除全量」，又不影响全局模板接口（ContractType / IndustryType
 *   等忽略 competitionId，注入值被忽略）；未分配比赛(own=null)的用户维持原行为，仅可访问
 *   competitionId=null 的全局共享字典。
 */
@Injectable()
export class CompetitionScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const cls = context.getClass();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, cls]);
    if (isPublic) return true;

    // 显式豁免接口（全局模板 / 比赛实体本身）：不按 competitionId 隔离，放行。
    const noScope = this.reflector.getAllAndOverride<boolean>(NO_COMPETITION_SCOPE_KEY, [handler, cls]);
    if (noScope) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return true; // 无用户（公开路由）由其它守卫处理

    if (user.role === "SUPER_ADMIN") return true; // 超管可跨比赛访问全部数据

    const own = user.competitionId ?? null;

    // 写接口锚定可信 competitionId：客户端传入的 body.competitionId 可被伪造或省略，
    // 省略即生成 competitionId=null 的「全局实体」污染其它租户（跨租户隔离弱化，审计 M1）。
    // 一律以请求者真实归属比赛（user.competitionId）覆盖 body，杜绝越权写入/全局实体。
    // 超管已在上方放行；未归属比赛的账号 own=null，不在此覆盖（其写请求会被下方分支拒绝）。
    if (
      own !== null &&
      req.body &&
      typeof req.body === "object" &&
      !Array.isArray(req.body)
    ) {
      const method = req.method;
      if (
        method === "POST" ||
        method === "PUT" ||
        method === "PATCH" ||
        method === "DELETE"
      ) {
        req.body.competitionId = own;
      }
    }

    const cid = this.resolveCompetitionId(req);

    if (cid === undefined) {
      if (own !== null && req.query) {
        // 未显式提供比赛 ID：非超管默认收敛到本人所属比赛，
        // 杜绝「不传 ID 即拉取 / 删除全量」的跨租户越权（BOLA）。
        req.query.competitionId = String(own);
      } else if (own === null) {
        // 未归属任何比赛的非超管账号无权访问隔离业务数据（异常状态兜底）。
        // 已通过上方 noScope 放行全局模板接口，故此处拒绝不会破坏选比赛流程。
        throw new ForbiddenException("账号未归属比赛，无法访问该数据");
      }
      return true;
    }

    if (cid === own) return true;

    throw new ForbiddenException("无权访问该比赛的数据");
  }

  /** 从 query 或 body 解析 competitionId（与 materials 等控制器解析规则保持一致）。 */
  private resolveCompetitionId(req: any): number | null | undefined {
    const parse = (v: unknown): number | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === "null" || v === "") return null;
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      return Number.isNaN(n as number) ? undefined : n;
    };
    if (req.query && req.query.competitionId !== undefined) {
      return parse(req.query.competitionId);
    }
    if (req.body && req.body.competitionId !== undefined) {
      return parse(req.body.competitionId);
    }
    return undefined;
  }
}
