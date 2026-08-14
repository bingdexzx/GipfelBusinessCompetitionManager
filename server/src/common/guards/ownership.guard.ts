import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../prisma/prisma.service";

export const OWNERSHIP_KEY = "ownership";

export interface OwnershipOptions {
  /** Prisma 客户端属性名（camelCase），实体直接持有 competitionId，如 "material" / "techNode"。viaCompany 模式下可省略。 */
  model?: string;
  /** 路由参数名，默认为 "id"；company-fields 用 "companyId"。 */
  param?: string;
  /**
   * 实体经 companyId 关联 Company，需先按 param 查 company 再取其 competitionId。
   * 用于 CompanyField（按 companyId 直查公司字段）等子资源。
   */
  viaCompany?: boolean;
}

/**
 * 标注在控制器类或路由方法上，声明该接口是一个「按 ID 直查的比赛级资源接口」。
 * 守卫仅对标注了本元数据且路由携带对应 id 参数的请求做归属校验；
 * 列表接口（无 id 参数）自动放行，不影响既有数据流。
 */
export const Ownership = (options: OwnershipOptions) =>
  SetMetadata(OWNERSHIP_KEY, options);

/**
 * 资源归属守卫（修复「按 ID 直查绕过比赛作用域」的系统性越权读，BOLA）：
 *
 * 各业务实体的 `GET /:id`（详情）与 `GET /:id/impact`（级联影响）按主键直查，
 * 既不携带也不读取 `competitionId`，导致一个比赛的玩家可用顺序 ID 枚举读走
 * 任意比赛的数据——尤其是 `company-fields`（现金 / 库存 / 所在地等核心商业机密）
 * 与 `users`（用户名 / 角色 / 权限）。
 *
 * 本守卫在认证之后，用**请求者真实归属比赛**（`user.competitionId`，而非前端可伪造的
 * 查询参数）校验被查实体的归属：
 * - SUPER_ADMIN 可访问任意比赛资源（含全量）。
 * - 其余角色：被查实体的 competitionId 必须等于本人所属比赛；未分配比赛的账号拒绝。
 * - 实体不存在返回 404（与既有 service 行为一致）。
 *
 * 与 CompetitionScopeGuard 互补：后者约束「列表 / 删除」的 competitionId 作用域，
 * 本守卫约束「按 ID 直查」的实体归属，二者共同闭合比赛级数据的对象级隔离。
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const cls = context.getClass();

    const opts = this.reflector.getAllAndOverride<OwnershipOptions>(OWNERSHIP_KEY, [
      handler,
      cls,
    ]);
    if (!opts) return true; // 仅标注了 @Ownership 的接口生效，其余放行

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return true;
    if (user.role === "SUPER_ADMIN") return true; // 超管可跨比赛访问

    const paramName = opts.param || "id";
    const rawId = req.params?.[paramName];
    const id = rawId === undefined || rawId === null ? NaN : Number(rawId);
    if (!rawId || Number.isNaN(id)) return true; // 非按 id 的资源接口，放行

    const own = user.competitionId ?? null;

    let entityCompetitionId: number | null;
    if (opts.viaCompany) {
      const company = await (this.prisma as any).company.findUnique({
        where: { id },
        select: { competitionId: true },
      });
      if (!company) throw new NotFoundException("公司不存在");
      entityCompetitionId = company.competitionId ?? null;
    } else {
      const model = opts.model;
      if (!model) return true; // 非 viaCompany 模式必须声明 model；防御性放行
      const entity = await (this.prisma as any)[model].findUnique({
        where: { id },
        select: { competitionId: true },
      });
      if (!entity) throw new NotFoundException("资源不存在");
      entityCompetitionId = entity.competitionId ?? null;
    }

    if (entityCompetitionId === own) return true;

    throw new ForbiddenException("无权访问该资源");
  }
}
