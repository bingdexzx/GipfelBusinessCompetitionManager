// 列表组件接入实时数据同步：在 setup 中调用 useResourceChanged('<resource>', onChanged)，
// 当收到匹配 resource 的创建 / 更新 / 删除事件时，回调 onChanged（通常是重新加载该列表）。
// onUnmounted 时自动移除监听，避免泄漏。

import { onUnmounted } from "vue";

/**
 * @param resource 资源 URL 首段，须与后端 MODEL_TO_RESOURCE 及 @Controller 前缀一致
 *                 例如 materials / companies / contracts
 * @param onChanged 收到增 / 删 / 改事件时的回调（通常为重新加载列表）
 */
export function useResourceChanged(resource: string, onChanged: () => void) {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail as
      | { resource?: string; id?: number | null; action?: string }
      | undefined;
    if (detail && detail.resource === resource) {
      onChanged();
    }
  };
  window.addEventListener("resource-changed", handler);
  onUnmounted(() => window.removeEventListener("resource-changed", handler));
}
