// 实时数据同步：后端在单条/批量记录被创建、更新或删除时，通过 WebSocket 广播
// "resource:changed" { resource, id, competitionId, action }（action: created|updated|deleted|bulk）。
// 本模块统一处理该事件：
//   1) 删除（action=deleted）：精确从本地全量副本中移除该 id（client/src/api/cache.ts 的
//      removeFullItemByResource），避免触发整表重拉；随后的增量刷新会通过 existingIds 再次确认删除。
//   2) 创建/更新/批量变更：不再作废本地全量副本（保留它，使随后的「增量刷新」生效，仅拉变更数据），
//      直接派发 window 事件通知组件层自动重拉。组件重拉走 cachedApi → 增量模式，仅取回变更行。
// 使用原生 CustomEvent 而非第三方事件总线，零额外依赖。

import { onRealtime } from "./socket";
import { removeFullItemByResource } from "@/api/cache";
import { reconcileAllIncremental, bumpResourceEvent } from "@/api/request";

let _bound = false;

// O4：实时重拉去抖 —— 同一资源在短时间内的多次事件合并为一次 window 广播，
// 避免「批量创建/更新」触发的一连串组件重拉（每次重拉都打后台增量请求）。
const RELOAD_DEBOUNCE_MS = 400;
const _reloadTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleResourceReload(resource: string, detail: Record<string, any>): void {
  const existing = _reloadTimers.get(resource);
  if (existing) clearTimeout(existing);
  _reloadTimers.set(
    resource,
    setTimeout(() => {
      _reloadTimers.delete(resource);
      window.dispatchEvent(new CustomEvent("resource-changed", { detail }));
    }, RELOAD_DEBOUNCE_MS),
  );
}

/** 注册全局「资源变更」监听（幂等，多次调用只生效一次）。建议在实时连接建立后调用。 */
export function bindResourceChanged() {
  if (_bound) return;
  _bound = true;
  onRealtime(
    "resource:changed",
    (payload: { resource?: string; id?: number; action?: string; competitionId?: number }) => {
      if (!payload || typeof payload.resource !== "string") return;
      // 删除：精确移除本地副本中的该条目（无需重拉整表）
      if (payload.action === "deleted" && payload.id != null) {
        void removeFullItemByResource(payload.resource, payload.id);
      }
      // O3：标记该资源「最近有变更」，使内存新鲜度窗口 memo 立即失效、触发刷新
      bumpResourceEvent(payload.resource);
      // O4：同一资源短时间内的多次事件合并为一次广播，避免批量变更触发一连串组件重拉
      scheduleResourceReload(payload.resource, {
        resource: payload.resource,
        id: payload.id ?? null,
        action: payload.action ?? "changed",
        competitionId: payload.competitionId ?? null,
      });
    },
  );

  // 公司产业字段写入后实时广播（自定义事件，非标准 resource:changed）。
  // 统一转译为 window 的 resource-changed 事件（resource="company-field"），
  // 使所有消费组件（含参赛队员的公司详情页）都能在本地全量副本上做增量刷新，
  // 不再依赖单一组件自行订阅，避免漏刷。
  onRealtime(
    "company-field:changed",
    (payload: { companyId?: number; competitionId?: number }) => {
      if (!payload || payload.companyId == null) return;
      // 标记变更：请求侧资源名为 "companyField"（与 collectionKey 对齐），事件侧为 "company-field"，
      // 二者都标记，确保两类 memo 都能被绕过。
      bumpResourceEvent("company-field");
      bumpResourceEvent("companyField");
      scheduleResourceReload("company-field", {
        resource: "company-field",
        id: payload.companyId,
        action: "updated",
        competitionId: payload.competitionId ?? null,
      });
    },
  );

  // 断线重连成功后主动对账：清理「断线 / 实时事件丢失期间」被删除的条目，
  // 无需等用户手动刷新或 5 分钟强制全量周期。首次连接时本地通常无基线，会自动跳过。
  onRealtime("connect", () => {
    void reconcileAllIncremental();
  });
}
