import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from "@nestjs/common";
import { hasPermission } from "../../permissions/catalog";

/**
 * 合同审核/执行守卫。
 * - D1 确认蕴含规则：manage ⊇ execute ⊇ audit ⊇ view
 * - 拥有 `contract:execute`（比赛级，不限公司）或 `contract:audit`（公司范围）之一即可进入。
 * - 拥有 `contract:manage` 的用户也自动满足（因为 manage ⊇ execute）。
 * - 具体的「仅限范围内公司」约束在 service 层按 user.companyScopes 进一步校验。
 */
@Injectable()
export class ContractReviewGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return false;
    // 使用 hasPermission 的偏序表驱动判定
    // contract:execute 的 rank=30，contract:audit 的 rank=20
    // 拥有 contract:manage (rank=40) 也自动满足（D1 确认：manage ⊇ execute）
    const canExecute = hasPermission(user.role, user.permissions, "contract:execute");
    if (!canExecute) {
      throw new ForbiddenException("无权审核/执行合同");
    }
    return true;
  }
}
