import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from "@nestjs/common";
import { hasPermission } from "../../permissions/catalog";

/**
 * 合同审核/执行守卫。
 * - 拥有 `contract:execute`（比赛级，不限公司）或 `contract:audit`（公司范围）之一即可进入。
 * - 具体的「仅限范围内公司」约束在 service 层按 user.companyScopes 进一步校验。
 */
@Injectable()
export class ContractReviewGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return false;
    const canExecute = hasPermission(user.role, user.permissions, "contract:execute");
    const canAudit = hasPermission(user.role, user.permissions, "contract:audit");
    if (!canExecute && !canAudit) {
      throw new ForbiddenException("无权审核/执行合同");
    }
    return true;
  }
}
