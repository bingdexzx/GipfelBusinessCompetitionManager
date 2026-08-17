// 列表组件接入实时数据同步：在 setup 中调用 useResourceChanged('<resource>', onChanged)，
// 当收到匹配 resource 的创建 / 更新 / 删除事件时，回调 onChanged（通常是重新加载该列表）。
// onUnmounted 时自动移除监听，避免泄漏。

import { onUnmounted } from "vue";
import { useCompetitionStore } from "@/stores/competition";

/** 事件详情类型 */
export interface ResourceChangedDetail {
  resource?: string;
  id?: number | null;
  action?: string;
  competitionId?: number | null;
  seq?: number | null;
  ts?: number | null;
}

/** 匹配选项 */
export interface UseResourceChangedOptions {
  /**
   * 匹配范围：
   * - "competition"（默认）：仅匹配当前比赛的事件
   * - "global"：仅匹配全局豁免实体的事件（competitionId 为 null）
   * - "any"：匹配所有事件（不检查 competitionId）
   */
  scope?: "competition" | "global" | "any";
}

/**
 * 订阅资源变更事件
 * @param resource 资源 URL 首段，须与后端 MODEL_TO_RESOURCE 及 @Controller 前缀一致
 *                 例如 materials / companies / contracts
 * @param onChanged 收到增 / 删 / 改事件时的回调（通常为重新加载列表）
 * @param options 匹配选项（scope 控制匹配范围）
 */
export function useResourceChanged(
  resource: string,
  onChanged: () => void,
  options?: UseResourceChangedOptions,
) {
  const scope = options?.scope ?? "competition";

  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail as ResourceChangedDetail | undefined;
    if (!detail || detail.resource !== resource) return;

    // 按 scope 过滤
    if (scope === "any") {
      // 不检查 competitionId，直接触发
      onChanged();
      return;
    }

    const compStore = useCompetitionStore();
    const currentCid = compStore.competitionId;
    const eventCid = detail.competitionId;

    if (scope === "global") {
      // 仅匹配全局豁免实体（competitionId 为 null）
      if (eventCid == null) {
        onChanged();
      }
      return;
    }

    // scope === "competition"（默认）
    // 仅匹配当前比赛的事件
    if (eventCid != null && currentCid != null && eventCid === currentCid) {
      onChanged();
    }
  };

  window.addEventListener("resource-changed", handler);
  onUnmounted(() => window.removeEventListener("resource-changed", handler));
}

/**
 * 订阅对账完成事件
 * @param onReconciled 对账完成时的回调
 */
export function useSyncReconciled(onReconciled: () => void) {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail as
      | { collections?: string[] }
      | undefined;
    if (detail) {
      onReconciled();
    }
  };

  window.addEventListener("sync:reconciled", handler);
  onUnmounted(() => window.removeEventListener("sync:reconciled", handler));
}
