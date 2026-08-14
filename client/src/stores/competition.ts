import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { getApiBaseUrl } from "@/config";
import {
  connectRealtime,
  disconnectRealtime,
  subscribeCompetition,
  unsubscribeCompetition,
  onRealtime,
  offRealtime,
  onReconnect,
} from "@/realtime/socket";
import { invalidateResource } from "@/api/cache";
import { bindResourceChanged } from "@/realtime/resource-changed";

export const useCompetitionStore = defineStore("competition", () => {
  const selected = ref<any>(null);
  const currentFiscalYear = ref<number | null>(null);
  // 财年网络确认状态：拉取中显示“加载中”，避免初始/切比赛时把 null 渲染成“未开启财年”（跳变）。
  const fiscalYearLoading = ref(false);

  const competitionId = computed(() => selected.value?.id || null);
  const competitionName = computed(() => selected.value?.name || "");

  function selectCompetition(comp: any) {
    selected.value = comp;
    localStorage.setItem("currentCompetition", JSON.stringify(comp));
    // 切换比赛时先清空旧财年并进入加载态，避免残留上一个比赛的财年（跳变）。
    currentFiscalYear.value = null;
    fiscalYearLoading.value = true;
    loadFiscalYear(comp.id);
    // 强时效：连接实时通道并订阅该比赛房间，接收管理员的财年/比赛变更广播
    connectRealtime();
    subscribeCompetition(comp.id);
    bindRealtime();
  }

  function clearSelection() {
    if (selected.value) unsubscribeCompetition(selected.value.id);
    disconnectRealtime();
    selected.value = null;
    currentFiscalYear.value = null;
    fiscalYearLoading.value = false;
    localStorage.removeItem("currentCompetition");
  }

  // 归属比赛的账号自动锁定并显示所属比赛：登录 / 拉取资料后调用。
  // - ownId 非空（PLAYER/COMPETITION_ADMIN 等归属账号）：拉取该比赛详情并 selectCompetition，
  //   覆盖 localStorage 中可能残留的其他比赛（这正是此前选错比赛导致 403 的根因）。
  // - ownId 为空（null，超管 / 未分配账号）：保持手动选择，不锁定。
  // 幂等：已锁定到同一比赛时直接返回，避免重复请求 / 重订阅。
  async function applyOwnCompetition(ownId: number | null | undefined) {
    if (ownId == null) return;
    if (selected.value?.id === ownId) return;
    try {
      const token = localStorage.getItem("token");
      const base = getApiBaseUrl() + "/api";
      const res = await fetch(`${base}/competitions/${ownId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // 归属比赛已不存在（清库 / 删除）：清空可能的悬空选择，避免顶部栏残留。
      if (res.status === 404) {
        clearSelection();
        return;
      }
      if (!res.ok) return;
      const comp = await res.json();
      if (comp && comp.id != null) {
        selectCompetition(comp);
      }
    } catch (e) {
      console.error("Failed to apply own competition:", e);
    }
  }

  async function loadFiscalYear(compId: number) {
    fiscalYearLoading.value = true;
    try {
      const token = localStorage.getItem("token");
      const base = getApiBaseUrl() + "/api";
      const res = await fetch(`${base}/competitions/${compId}/fiscal-years`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // 比赛不存在（已被删除或数据库已重置）→ 清空本地悬空选择，避免顶部栏残留并持续 404
      if (res.status === 404) {
        if (selected.value?.id === compId) clearSelection();
        return;
      }
      if (!res.ok) return;
      const json = await res.json();
      const fys = json.data || [];
      const active = fys.find((f: any) => f.status === "ACTIVE");
      // 有进行中的财年显示其年份；财年全部结束后显示“未开启财年”(null)
      currentFiscalYear.value = active ? active.year : null;
    } catch (e) {
      console.error("Failed to load fiscal year:", e);
      currentFiscalYear.value = null;
    } finally {
      fiscalYearLoading.value = false;
    }
  }

  // ===== 实时广播处理（管理员操作 → 所有前端即刻同步）=====
  function handleFiscalYearChanged(payload: any) {
    if (!payload?.competitionId || payload.competitionId !== competitionId.value) return;
    const fy = payload.fiscalYear;
    if (!fy) {
      // 兜底：事件无明细时回源一次，保证不漏更新
      loadFiscalYear(payload.competitionId);
      return;
    }
    // 直接依据广播的财年状态更新，省去一次 HTTP 回源，事件到即同步
    if (fy.status === "ACTIVE") {
      currentFiscalYear.value = fy.year;
    } else if (fy.status === "CLOSED" && currentFiscalYear.value === fy.year) {
      currentFiscalYear.value = null;
    }
    // 财年是比赛属性，失效本地比赛缓存，下次展示拉取最新
    invalidateResource("/competitions");
  }
  function handleCompetitionChanged(payload: any) {
    if (payload?.id && selected.value && payload.id === selected.value.id) {
      selected.value = { ...selected.value, ...payload };
    }
    // 管理员在其它客户端改动比赛后，失效本地比赛相关缓存，下次展示拉取最新
    invalidateResource("/competitions");
  }
  function bindRealtime() {
    offRealtime("fiscal-year:changed", handleFiscalYearChanged);
    onRealtime("fiscal-year:changed", handleFiscalYearChanged);
    offRealtime("competition:changed", handleCompetitionChanged);
    onRealtime("competition:changed", handleCompetitionChanged);
    // 实时数据同步：后端增/删/改记录时广播 "resource:changed"，此处统一作废本地缓存并通知组件
    bindResourceChanged();
  }

  // serverUrl 变更后重建实时通道：断开旧 socket（旧地址），并按当前比赛重新订阅新服务器房间。
  // HTTP 通道由请求拦截器即时切换，这里补齐 WebSocket 一侧，避免改地址后实时更新静默失效。
  function reconnectRealtime() {
    disconnectRealtime();
    connectRealtime();
    if (selected.value?.id) subscribeCompetition(selected.value.id);
    bindRealtime();
  }

  // 断线自动重连成功后：服务端房间订阅随旧连接销毁，需重新订阅当前比赛房间以恢复广播；
  // 同时回源刷新财年（断连期间财年可能被改动），使左上角财年在连接恢复后立即同步，而非等下次导航。
  function handleReconnect() {
    const cid = selected.value?.id;
    if (cid) {
      subscribeCompetition(cid);
      loadFiscalYear(cid);
    }
    bindRealtime();
  }

  // 校验当前比赛是否真实存在：服务端清库 / 删除后，本地可能残留一个指向
  // 已不存在比赛的引用（悬空选择），会导致顶部栏与列表显示不存在的内容。
  // 用原生 fetch 绕过本地缓存，避免读到 IndexedDB 中已删除的旧数据。
  async function verifyCompetition(compId: number) {
    try {
      const token = localStorage.getItem("token");
      const base = getApiBaseUrl() + "/api";
      const res = await fetch(`${base}/competitions/${compId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // 比赛已不存在（清库 / 删除）→ 清除悬空选择，避免残留显示
      if (res.status === 404) {
        if (selected.value?.id === compId) clearSelection();
      }
    } catch {
      // 网络错误不处理：保留当前选择（离线降级），下次进入时再校验
    }
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem("currentCompetition");
      if (raw) {
        const comp = JSON.parse(raw);
        selected.value = comp;
        if (comp.id) {
          connectRealtime();
          subscribeCompetition(comp.id);
          bindRealtime();
          loadFiscalYear(comp.id);
          verifyCompetition(comp.id);
        }
      }
    } catch (e) {
      console.error("Failed to load from storage:", e);
    }
  }

  loadFromStorage();

  // 注册断线重连回调：重连成功后重订阅房间 + 回源刷新财年/比赛（见 handleReconnect）。
  onReconnect(handleReconnect);

  return {
    selected,
    currentFiscalYear,
    fiscalYearLoading,
    competitionId,
    competitionName,
    selectCompetition,
    clearSelection,
    applyOwnCompetition,
    loadFiscalYear,
    reconnectRealtime,
  };
});
