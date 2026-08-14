import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from "@nestjs/common";
import { hasPermission } from "../../permissions/catalog";

/**
 * 合同编号编辑守卫：允许拥有 contract:manage / contract:execute / contract:audit
 * 任一权限者进入（即"能管理或审核合同的人可补全编号"）。
 * 具体的「仅限范围内公司」约束在 service 层按 user.companyScopes 进一步校验。
 */
@Injectable()
export class ContractEditGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return false;
    const canManage = hasPermission(user.role, user.permissions, "contract:manage");
    const canExecute = hasPermission(user.role, user.permissions, "contract:execute");
    const canAudit = hasPermission(user.role, user.permissions, "contract:audit");
    if (!canManage && !canExecute && !canAudit) {
      throw new ForbiddenException("无权修改合同编号");
    }
    return true;
  }
}
