/**
 * 删除级联影响的结构类型。
 *
 * 此前这两个接口寄生在 `materials/material.service.ts` 中，却被 14 个服务跨模块 import，
 * 形成不合理的类型依赖（材料服务成为了删除影响的"类型宿主"）。
 * 现迁移到公共位置，并由 material.service 重新导出以保持向后兼容。
 */
export interface DeleteImpactItem {
  label: string;
  count: number;
}

export interface DeleteImpact {
  name: string;
  children: DeleteImpactItem[];
}
