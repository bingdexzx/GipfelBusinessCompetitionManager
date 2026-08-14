import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "./permissions.decorator";
import { hasPermission } from "./catalog";

/**
 * 权限守卫：与 JwtAuthGuard 配合（通常置于其后）。
 * 若路由未声明 @RequirePermissions，则直接放行（不改变既有公开/登录校验行为）。
 * 若声明了权限，则校验当前登录用户是否满足（SUPER_ADMIN 隐式全部满足）。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException("未登录或登录已失效");

    const ok = hasPermission(user.role, user.permissions ?? null, required);
    if (!ok) throw new ForbiddenException("权限不足");
    return true;
  }
}
