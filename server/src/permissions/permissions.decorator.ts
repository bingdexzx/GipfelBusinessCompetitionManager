import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "permissions";

/**
 * 标记某个路由（handler 或 controller）需要的权限。
 * 用法：@RequirePermissions("account:manage") 或 @RequirePermissions("contract:execute", "contract:manage")
 * 规则（见 PermissionsGuard）：SUPER_ADMIN 始终放行；其余角色必须拥有所列全部权限（AND）。
 */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);
