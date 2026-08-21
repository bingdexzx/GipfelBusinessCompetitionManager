/**
 * 增量查询公共工具。
 *
 * 思路：列表接口支持 `updatedAfter=<ISO>` 参数时，仅返回 `updatedAt` 晚于该基线的条目，
 * 同时返回「满足 baseWhere 的全部 id 集合」(existingIds)，让前端据此 diff 出被删除的本地副本，
 * 从而在网络层实现增量同步、降低服务器与带宽压力。
 *
 * 非增量模式（不传 updatedAfter）保持原有返回形态，完全向后兼容。
 */

export interface IncrementalContext {
  /** 合并了 updatedAt 过滤条件的 where（增量模式）；非增量模式等于 baseWhere */
  where: any;
  /** 是否为增量模式 */
  incremental: boolean;
  /** 增量模式下解析出的基线时间；非增量模式为 null */
  baseline: Date | null;
}

/**
 * 解析 updatedAfter 参数并构造查询条件。
 * @param baseWhere 业务基础过滤条件（如 { competitionId }）
 * @param updatedAfter ISO 时间字符串（可选）
 */
export function applyUpdatedAfter(baseWhere: any, updatedAfter?: string): IncrementalContext {
  const baseline = parseBaseline(updatedAfter);
  if (!baseline) {
    return { where: baseWhere, incremental: false, baseline: null };
  }
  return {
    where: { ...baseWhere, updatedAt: { gt: baseline } },
    incremental: true,
    baseline,
  };
}

/** 安全解析 ISO 时间字符串，无效则返回 null */
export function parseBaseline(updatedAfter?: string): Date | null {
  if (!updatedAfter) return null;
  const d = new Date(updatedAfter);
  return isNaN(d.getTime()) ? null : d;
}

/** 当前服务器时间（ISO 字符串），用于前端作为下一次同步的基线，避免增量间隙漏推 */
export function serverNowIso(): string {
  return new Date().toISOString();
}

/** 生成增量响应包装（列表形态），供各 service 的增量分支复用 */
export interface IncrementalListResult {
  items: any[];
  total: number;
  existingIds?: number[];
  deletedIds?: number[];
  serverTime: string;
  incremental: true;
}

export function buildIncrementalResult<T extends { id: number }>(
  updated: T[],
  allCurrentIds: number[],
  previousIds?: number[],
  total?: number,
): IncrementalListResult {
  const serverNow = new Date().toISOString();
  
  if (previousIds && previousIds.length > 0) {
    // 客户端发送了缓存的ID - 计算差异
    const currentSet = new Set(allCurrentIds);
    const deletedIds = previousIds.filter(id => !currentSet.has(id));
    return { 
      items: updated, 
      total: total ?? updated.length, 
      deletedIds, 
      serverTime: serverNow, 
      incremental: true 
    };
  }
  
  // 向后兼容：返回所有ID（旧客户端行为）
  return { 
    items: updated, 
    total: total ?? updated.length, 
    existingIds: allCurrentIds, 
    serverTime: serverNow, 
    incremental: true 
  };
}
