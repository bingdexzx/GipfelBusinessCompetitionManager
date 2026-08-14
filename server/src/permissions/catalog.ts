/**
 * 权限目录（后端权威定义）。
 * 前端（client/src/permissions/catalog.ts）为同结构的镜像副本，修改时需同步。
 *
 * 权限 key 规范：`<domain>:<action>`
 *  - domain 形如 `data:material`、`contract`、`account`
 *  - action 形如 `view` / `edit` / `manage` / `execute`
 */

export interface PermissionAction {
  /** 完整权限 key，如 "data:material:edit" */
  key: string;
  /** 动作 token，如 "edit" */
  action: string;
  /** 中文标签，如 "编辑" */
  label: string;
}

export interface PermissionDomain {
  /** 域前缀，如 "data:material" */
  key: string;
  /** 中文标签，如 "原料管理" */
  label: string;
  /** UI 分组，如 "数据管理" */
  group: string;
  actions: PermissionAction[];
}

export const PERMISSION_CATALOG: PermissionDomain[] = [
  {
    key: "dashboard",
    label: "仪表盘",
    group: "概览",
    actions: [{ key: "dashboard:view", action: "view", label: "查看" }],
  },
  {
    key: "competition",
    label: "比赛管理",
    group: "比赛",
    actions: [{ key: "competition:manage", action: "manage", label: "管理（增删改）" }],
  },
  {
    key: "data:material",
    label: "原料管理",
    group: "数据",
    actions: [
      { key: "data:material:view", action: "view", label: "查看" },
      { key: "data:material:edit", action: "edit", label: "编辑（增删改）" },
    ],
  },
  {
    key: "data:part",
    label: "零件管理",
    group: "数据",
    actions: [
      { key: "data:part:view", action: "view", label: "查看" },
      { key: "data:part:edit", action: "edit", label: "编辑（增删改）" },
    ],
  },
  {
    key: "data:product",
    label: "产品管理",
    group: "数据",
    actions: [
      { key: "data:product:view", action: "view", label: "查看" },
      { key: "data:product:edit", action: "edit", label: "编辑（增删改）" },
    ],
  },
  {
    key: "data:map",
    label: "地图管理",
    group: "数据",
    actions: [
      { key: "data:map:view", action: "view", label: "查看" },
      { key: "data:map:edit", action: "edit", label: "编辑（增删改）" },
    ],
  },
  {
    key: "data:infrastructure",
    label: "基建管理",
    group: "数据",
    actions: [
      { key: "data:infrastructure:view", action: "view", label: "查看" },
      { key: "data:infrastructure:edit", action: "edit", label: "编辑（增删改）" },
    ],
  },
  {
    key: "data:tech",
    label: "科技树管理",
    group: "数据",
    actions: [
      { key: "data:tech:view", action: "view", label: "查看" },
      { key: "data:tech:edit", action: "edit", label: "编辑（增删改）" },
    ],
  },
  {
    key: "data:fuel",
    label: "燃料管理",
    group: "数据",
    actions: [
      { key: "data:fuel:view", action: "view", label: "查看" },
      { key: "data:fuel:edit", action: "edit", label: "编辑（增删改）" },
    ],
  },
  {
    key: "data:vehicle",
    label: "载具管理",
    group: "数据",
    actions: [
      { key: "data:vehicle:view", action: "view", label: "查看" },
      { key: "data:vehicle:edit", action: "edit", label: "编辑（增删改）" },
    ],
  },
  {
    key: "data:warehouse",
    label: "仓库管理",
    group: "数据",
    actions: [
      { key: "data:warehouse:view", action: "view", label: "查看" },
      { key: "data:warehouse:edit", action: "edit", label: "编辑（增删改）" },
    ],
  },
  {
    key: "data:productionLine",
    label: "生产线管理",
    group: "数据",
    actions: [
      { key: "data:productionLine:view", action: "view", label: "查看" },
      { key: "data:productionLine:edit", action: "edit", label: "编辑（增删改）" },
    ],
  },
  {
    key: "data:region",
    label: "区域管理",
    group: "区域",
    actions: [
      { key: "data:region:view", action: "view", label: "查看" },
      { key: "data:region:edit", action: "edit", label: "编辑（增删改）" },
    ],
  },
  {
    key: "contractType",
    label: "合同类型管理",
    group: "合同",
    actions: [
      { key: "contractType:view", action: "view", label: "查看" },
      { key: "contractType:manage", action: "manage", label: "管理（增删改）" },
    ],
  },
  {
    key: "contract",
    label: "合同管理",
    group: "合同",
    actions: [
      { key: "contract:view", action: "view", label: "查看" },
      { key: "contract:execute", action: "execute", label: "执行（比赛级，不限公司）" },
      {
        key: "contract:audit",
        action: "audit",
        label: "审核（公司范围，仅限范围内公司合同）",
      },
      { key: "contract:manage", action: "manage", label: "管理（新建/删除）" },
    ],
  },
  {
    key: "industryType",
    label: "产业类型管理",
    group: "产业",
    actions: [
      { key: "industryType:view", action: "view", label: "查看" },
      { key: "industryType:manage", action: "manage", label: "管理（增删改）" },
    ],
  },
  {
    key: "company",
    label: "公司管理",
    group: "产业",
    actions: [
      {
        key: "company:view",
        action: "view",
        label: "查看（读取公司产业字段等子资源）",
      },
      {
        key: "company:manage",
        action: "manage",
        label: "管理（含分部/库存/载具/科技/基建等子资源）",
      },
    ],
  },
  {
    key: "account",
    label: "账户管理",
    group: "系统",
    actions: [{ key: "account:manage", action: "manage", label: "管理（增删改账号与权限）" }],
  },
];

/** 所有合法权限 key 列表 */
export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.flatMap((d) =>
  d.actions.map((a) => a.key),
);

/** key -> 中文可读标签（含域标签前缀更易读） */
export const PERMISSION_LABELS: Record<string, string> = PERMISSION_CATALOG.reduce(
  (acc, d) => {
    for (const a of d.actions) {
      acc[a.key] = `${d.label} · ${a.label}`;
    }
    return acc;
  },
  {} as Record<string, string>,
);

/** 按 UI 分组聚合，便于前端渲染 */
export const PERMISSION_GROUPS: { group: string; domains: PermissionDomain[] }[] = (() => {
  const map = new Map<string, PermissionDomain[]>();
  for (const d of PERMISSION_CATALOG) {
    if (!map.has(d.group)) map.set(d.group, []);
    map.get(d.group)!.push(d);
  }
  return Array.from(map.entries()).map(([group, domains]) => ({ group, domains }));
})();

/** 已废止但为兼容旧数据仍视为合法的权限 key（如系统设置不再单独分权限） */
export const DEPRECATED_PERMISSION_KEYS: string[] = ["settings:view", "settings:manage"];

/** 校验一组 key 是否全部合法（用于 DTO 校验） */
export function isValidPermissions(perms: unknown): perms is string[] {
  if (!Array.isArray(perms)) return false;
  return perms.every(
    (p) =>
      typeof p === "string" &&
      (ALL_PERMISSION_KEYS.includes(p) || DEPRECATED_PERMISSION_KEYS.includes(p)),
  );
}

/**
 * 判断某用户是否满足所需权限。
 * - SUPER_ADMIN 隐式拥有全部权限（兼容旧行为，始终放行）。
 * - 其余角色：要求 required 中每一项都在用户的 permissions 列表中（AND 语义）。
 */
export function hasPermission(
  role: string | undefined,
  permissions: string[] | null | undefined,
  required: string | string[],
): boolean {
  if (role === "SUPER_ADMIN") return true;
  const req = Array.isArray(required) ? required : [required];
  if (req.length === 0) return true;
  const perms = permissions ?? [];
  const owned = new Set(perms);
  return req.every((need) => {
    if (owned.has(need)) return true;
    // 同域动作层级蕴含（manage ⊇ edit ⊇ view）：让「已有写/管理权限者天然可读」，
    // 从而给读接口统一加 view 守卫时不会让既有的 edit/manage 授权失效。
    const colon = need.lastIndexOf(":");
    if (colon === -1) return false;
    const domain = need.slice(0, colon);
    const action = need.slice(colon + 1);
    if (action === "view") {
      // 读是某域内最弱的能力：持有该域任意能力（view/edit/manage/execute/audit 等）即视为可读。
      return perms.some((p) => p === domain || p.startsWith(domain + ":"));
    }
    if (action === "edit") {
      // 编辑可由管理满足。
      return owned.has(`${domain}:manage`);
    }
    // manage / execute / audit 等：需精确持有，不做向下蕴含。
    return false;
  });
}

/** 把数据库存储的 JSON 字符串解析为权限 key 数组 */
export function parsePermissions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 把权限 key 数组序列化为数据库存储的 JSON 字符串 */
export function serializePermissions(perms: string[] | null | undefined): string | null {
  if (!perms || perms.length === 0) return null;
  return JSON.stringify([...new Set(perms)]);
}

/** 把数据库存储的 JSON 字符串解析为公司 id 数组（用于账号的 companyScopes） */
export function parseCompanyScopes(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => (typeof x === "string" ? Number(x) : x))
      .filter((x) => typeof x === "number" && Number.isFinite(x));
  } catch {
    return [];
  }
}

/** 把公司 id 数组序列化为数据库存储的 JSON 字符串（去重、过滤非法值） */
export function serializeCompanyScopes(scopes: number[] | null | undefined): string | null {
  if (!scopes || scopes.length === 0) return null;
  const clean = Array.from(
    new Set(scopes.filter((x) => typeof x === "number" && Number.isFinite(x))),
  );
  return clean.length === 0 ? null : JSON.stringify(clean);
}

/**
 * 判断某用户能否读取「指定公司的全部（含未发布）产业字段」。
 *
 * 范围（viewCompanyScopes）机制：账号可被分配「仅能查看这些公司全量字段」的限制，
 * 用于让仅持 company:view 的角色只能读到其负责范围内公司的全量字段，范围外公司仍只
 * 回「已发布到区域总览」的公开字段。该范围独立于 companyScopes（contract:audit 审核
 * 范围），两者分别控制「读」与「审」。
 *
 *  - SUPER_ADMIN：恒放行（全部字段）。
 *  - 拥有 company:manage 或 data:region:edit：恒放行（管理者 / 区域总览发布者需看全量）。
 *  - 仅拥有 company:view：按 companyScopes 限定——
 *        scopes 为空(null/[]) → 全部公司可见全量（向后兼容：未配置范围即不限制）；
 *        scopes 非空        → 仅 companyId 在 scopes 内时可见全量，其余公司仅能读公开字段。
 *  - 其余角色：无全量读权限。
 */
export function canReadCompanyAllFields(
  role: string | undefined,
  permissions: string[] | null | undefined,
  viewCompanyScopes: number[] | null | undefined,
  companyId: number,
): boolean {
  if (role === "SUPER_ADMIN") return true;
  const hasManage = hasPermission(role, permissions, "company:manage");
  const hasRegionEdit = hasPermission(role, permissions, "data:region:edit");
  const hasView = hasPermission(role, permissions, "company:view");
  // 管理者 / 区域总览发布者恒全量读
  if (hasManage || hasRegionEdit) return true;
  // 仅查看者：受 viewCompanyScopes 约束（独立于 companyScopes 审核范围）
  if (hasView) {
    const scopes = viewCompanyScopes && viewCompanyScopes.length > 0 ? viewCompanyScopes : null;
    if (!scopes) return true; // 空范围 = 无限制
    return scopes.includes(companyId);
  }
  return false;
}

/**
 * 计算「公司列表/详情」的范围过滤参数（基于 viewCompanyScopes）。
 * 返回 null 表示不施加公司级限制（可见全部公司，含超管 / company:manage / data:region:edit）；
 * 否则返回允许访问的公司 id 数组（仅 company:view 角色、且配置了非空 viewCompanyScopes 时）。
 *
 * 与 canReadCompanyAllFields 一致：空 viewCompanyScopes 与「未配置范围」等价，即不限制。
 */
export function companyListScopes(
  role: string | undefined,
  permissions: string[] | null | undefined,
  viewCompanyScopes: number[] | null | undefined,
): number[] | null {
  if (role === "SUPER_ADMIN") return null;
  const hasManage = hasPermission(role, permissions, "company:manage");
  const hasRegionEdit = hasPermission(role, permissions, "data:region:edit");
  if (hasManage || hasRegionEdit) return null;
  const scopes = viewCompanyScopes && viewCompanyScopes.length > 0 ? viewCompanyScopes : null;
  return scopes;
}
