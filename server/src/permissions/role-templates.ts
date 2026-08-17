/**
 * 权限角色模板与授予上限
 *
 * 根据《权限分级与重构设计.md》T3 任务创建。
 * 后端权威定义角色的默认权限集合与「授予上限」。
 */

// ========== 角色模板 ==========

/** 角色模板定义 */
export interface RoleTemplate {
  /** 角色名称 */
  role: string;
  /** 默认权限列表 */
  defaultPermissions: string[];
  /** 默认范围值 */
  defaultScopes: {
    companyScopes: any;
    viewCompanyScopes: any;
    contractViewCompanyScopes: any;
    stockCompanyScopes: any;
  };
  /** 授予上限（默认 = 模板本身） */
  grantCeiling: string[];
  /** 可选扩展集（默认不开放，超管可按需放开） */
  grantExtras: string[];
  /** 是否为超管专属角色 */
  isSuperAdmin: boolean;
}

/** 基础视图权限（17 个） */
const BASE_VIEW_PERMISSIONS = [
  "data:material:view",
  "data:part:view",
  "data:product:view",
  "data:map:view",
  "data:infrastructure:view",
  "data:tech:view",
  "data:fuel:view",
  "data:vehicle:view",
  "data:warehouse:view",
  "data:productionLine:view",
  "data:region:view",
  "industryType:view",
  "contractType:view",
  "company:view",
  "contract:view",
  "message:view",
  "stock:view",
];

/** 超管专属权限（任何非超管角色禁止持有） */
export const SUPER_ADMIN_ONLY_PERMISSIONS = [
  "competition:manage",
  "account:manage",
  "stock:manage",
  // data:*:edit 除扩展集显式允许外
];

/** COMPETITION_ADMIN 可选扩展集 */
const COMPETITION_ADMIN_EXTRAS = [
  "message:manage",
  "contractType:manage",
  "industryType:manage",
  "company:manage",
  "data:region:edit",
];

/** 角色模板定义 */
export const ROLE_TEMPLATES: Record<string, RoleTemplate> = {
  SUPER_ADMIN: {
    role: "SUPER_ADMIN",
    defaultPermissions: [], // 隐式全放行
    defaultScopes: {
      companyScopes: null,
      viewCompanyScopes: null,
      contractViewCompanyScopes: null,
      stockCompanyScopes: null,
    },
    grantCeiling: [], // 任意（不受限）
    grantExtras: [],
    isSuperAdmin: true,
  },
  COMPETITION_ADMIN: {
    role: "COMPETITION_ADMIN",
    defaultPermissions: [
      ...BASE_VIEW_PERMISSIONS,
      "contract:manage",
      "contract:audit",
      "contract:execute",
      "stock:edit",
    ],
    defaultScopes: {
      companyScopes: null, // 由前端传入所选公司
      viewCompanyScopes: null,
      contractViewCompanyScopes: null,
      stockCompanyScopes: null,
    },
    grantCeiling: [
      ...BASE_VIEW_PERMISSIONS,
      "contract:manage",
      "contract:audit",
      "contract:execute",
      "stock:edit",
    ],
    grantExtras: COMPETITION_ADMIN_EXTRAS,
    isSuperAdmin: false,
  },
  PLAYER: {
    role: "PLAYER",
    defaultPermissions: BASE_VIEW_PERMISSIONS,
    defaultScopes: {
      companyScopes: [], // 空 = 无可审核合同
      viewCompanyScopes: null,
      contractViewCompanyScopes: null,
      stockCompanyScopes: null,
    },
    grantCeiling: BASE_VIEW_PERMISSIONS,
    grantExtras: [],
    isSuperAdmin: false,
  },
};

// ========== 授予上限校验 ==========

/**
 * 校验权限授予是否在上限范围内
 * @param actorRole 操作者角色
 * @param targetRole 目标角色
 * @param permissions 要授予的权限列表
 * @returns 校验结果
 */
export function assertGrantAllowed(
  actorRole: string,
  targetRole: string,
  permissions: string[],
): { allowed: boolean; violations: string[] } {
  // 非超管不能写权限
  if (actorRole !== "SUPER_ADMIN") {
    return { allowed: false, violations: ["仅超管可修改权限"] };
  }

  // 超管角色只能设为空数组
  if (targetRole === "SUPER_ADMIN") {
    if (permissions.length > 0) {
      return { allowed: false, violations: ["超管权限不落库，必须为空数组"] };
    }
    return { allowed: true, violations: [] };
  }

  const template = ROLE_TEMPLATES[targetRole];
  if (!template) {
    return { allowed: false, violations: [`未知角色: ${targetRole}`] };
  }

  // 检查是否在授予上限范围内
  // 注意：扩展集不在默认上限内，需要超管显式放开
  const ceiling = new Set(template.grantCeiling);
  const violations: string[] = [];

  for (const perm of permissions) {
    // 超管专属权限检查
    if (SUPER_ADMIN_ONLY_PERMISSIONS.includes(perm)) {
      violations.push(`${perm} 为超管专属权限，不可授予 ${targetRole}`);
      continue;
    }
    // 授予上限检查（扩展集不在默认上限内）
    if (!ceiling.has(perm)) {
      // 检查是否在扩展集中
      if (template.grantExtras.includes(perm)) {
        violations.push(`${perm} 在扩展集中，需超管显式放开`);
      } else {
        violations.push(`${perm} 超出 ${targetRole} 的授予上限`);
      }
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
  };
}

/**
 * 获取角色的默认权限
 */
export function getDefaultPermissions(role: string): string[] {
  const template = ROLE_TEMPLATES[role];
  return template ? [...template.defaultPermissions] : [];
}

/**
 * 获取角色的默认范围
 */
export function getDefaultScopes(role: string): RoleTemplate["defaultScopes"] | null {
  const template = ROLE_TEMPLATES[role];
  return template ? { ...template.defaultScopes } : null;
}

/**
 * 检查是否为超管专属角色
 */
export function isSuperAdminOnly(role: string): boolean {
  const template = ROLE_TEMPLATES[role];
  return template?.isSuperAdmin ?? false;
}
