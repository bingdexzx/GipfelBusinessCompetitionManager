/**
 * 权限目录端点
 *
 * 根据《权限分级与重构设计.md》T7 任务创建。
 * 提供只读端点 GET /api/permissions/catalog，返回权限目录、动作等级表、角色模板等。
 */

import { Controller, Get } from "@nestjs/common";
import { PERMISSION_CATALOG, DEFAULT_ACTION_RANKS, ALL_PERMISSION_KEYS, PERMISSION_LABELS, PERMISSION_GROUPS } from "./catalog";
import { ROLE_TEMPLATES, SUPER_ADMIN_ONLY_PERMISSIONS } from "./role-templates";

/**
 * 权限目录端点
 * 登录即可访问，无需业务权限。
 * 注意：全局已 setGlobalPrefix("api")，此处只需写 "permissions"，
 * 最终路由为 /api/permissions/catalog，避免双重 /api 前缀导致 404。
 */
@Controller("permissions")
export class PermissionsController {
  /**
   * 获取权限目录
   * 返回完整的权限元数据，包括：
   * - domains: 权限域列表（含动作等级）
   * - groups: 按 UI 分组聚合
   * - actionRank: 全局默认动作等级表
   * - roleTemplates: 角色模板（不含授予上限，仅默认权限）
   * - allKeys: 所有合法权限 key
   * - labels: 权限 key 到中文标签的映射
   */
  @Get("catalog")
  getCatalog() {
    return {
      domains: PERMISSION_CATALOG,
      groups: PERMISSION_GROUPS,
      actionRank: DEFAULT_ACTION_RANKS,
      roleTemplates: Object.fromEntries(
        Object.entries(ROLE_TEMPLATES).map(([role, template]) => [
          role,
          {
            role: template.role,
            defaultPermissions: template.defaultPermissions,
            defaultScopes: template.defaultScopes,
            isSuperAdmin: template.isSuperAdmin,
          },
        ]),
      ),
      superAdminOnlyPermissions: SUPER_ADMIN_ONLY_PERMISSIONS,
      allKeys: ALL_PERMISSION_KEYS,
      labels: PERMISSION_LABELS,
    };
  }
}
