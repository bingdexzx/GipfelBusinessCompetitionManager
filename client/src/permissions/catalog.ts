/**
 * 权限目录（前端镜像，需与 server/src/permissions/catalog.ts 保持同步）。
 * 权限 key 规范：`<domain>:<action>`
 */

export interface PermissionAction {
  key: string;
  action: string;
  label: string;
}

export interface PermissionDomain {
  key: string;
  label: string;
  group: string;
  actions: PermissionAction[];
}

export const PERMISSION_CATALOG: PermissionDomain[] = [
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
  {
    key: "message",
    label: "消息中心",
    group: "消息",
    actions: [
      {
        key: "message:view",
        action: "view",
        label: "查看（收件箱 / 已发布 / 接收弹窗）",
      },
      { key: "message:manage", action: "manage", label: "管理（发布 / 删除消息）" },
    ],
  },
];

/** 所有合法权限 key */
export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.flatMap((d) =>
  d.actions.map((a) => a.key),
);

/** key -> 中文可读标签 */
export const PERMISSION_LABELS: Record<string, string> = PERMISSION_CATALOG.reduce(
  (acc, d) => {
    for (const a of d.actions) acc[a.key] = `${d.label} · ${a.label}`;
    return acc;
  },
  {} as Record<string, string>,
);

/** 按 UI 分组聚合 */
export const PERMISSION_GROUPS: { group: string; domains: PermissionDomain[] }[] = (() => {
  const map = new Map<string, PermissionDomain[]>();
  for (const d of PERMISSION_CATALOG) {
    if (!map.has(d.group)) map.set(d.group, []);
    map.get(d.group)!.push(d);
  }
  return Array.from(map.entries()).map(([group, domains]) => ({ group, domains }));
})();
