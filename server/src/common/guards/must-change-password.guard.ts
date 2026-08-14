import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/**
 * 强制改密守卫（修复默认超管 admin/admin123 后门）：
 *
 * 用户记录带 `mustChangePassword` 标志（种子默认超管置 true）。登录后若未改密，
 * 除「自助改密 / 查看自身 / 登录」等少数端点外，一律禁止访问业务接口，
 * 强制管理员在首次登录后立即修改初始密码。
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  // 允许在未改密状态下访问的端点（自助改密、查看自身资料）。
  private static readonly EXEMPT_PREFIXES = [
    "/api/auth/change-password",
    "/api/auth/me",
  ];

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return true;

    if (user.mustChangePassword) {
      const url: string = req.originalUrl || req.url || "";
      const path = url.split("?")[0];
      const exempt = MustChangePasswordGuard.EXEMPT_PREFIXES.some((p) => path.startsWith(p));
      if (!exempt) {
        throw new ForbiddenException("请先修改初始密码后再继续操作");
      }
    }
    return true;
  }
}
