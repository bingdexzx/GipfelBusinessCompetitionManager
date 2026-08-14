import axios, { AxiosInstance } from "axios";
import { ElMessage } from "element-plus";
import { getApiBaseUrl } from "@/config";
import { versionBlocked } from "@/version-block";

// axios 自定义请求配置字段类型增强（request.ts 与 stores/version.ts 均使用这些字段）。
declare module "axios" {
  export interface AxiosRequestConfig {
    /** 绕过版本硬封锁（仅版本校验请求使用，否则请求会被拦截器拒绝、不发网络）。 */
    bypassVersionBlock?: boolean;
    /** 显式 false 时绕过本地缓存层、直接走网络；缺省走缓存。 */
    cache?: boolean;
    /** 为 true 时请求失败不弹错误提示（后台静默同步 / 校验请求使用）。 */
    silent?: boolean;
  }
}

const api = axios.create({
  timeout: 15000,
});

api.interceptors.request.use(
  (config) => {
    // 版本硬封锁：客户端版本与服务端不一致时，除显式 bypassVersionBlock 的版本校验请求外，
    // 一律拒绝并阻断网络，实现「无法使用任何功能、发出任何请求」。
    if (versionBlocked.value && !config.bypassVersionBlock) {
      return Promise.reject(
        new Error("客户端版本与服务端不一致，已禁用全部请求，请联系管理员获取最新版本"),
      );
    }
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    config.baseURL = getApiBaseUrl() + "/api";
    return config;
  },
  (error) => Promise.reject(error),
);

// 将任意错误统一转换为中文提示，避免暴露 axios / HTTP 的英文消息
export function getErrorMessage(error: unknown): string {
  const err = error as any;
  if (err?.response?.data?.message) {
    return err.response.data.message;
  }
  if (err?.response) {
    const status = err.response.status;
    const statusText: Record<number, string> = {
      400: "请求参数错误，请检查输入",
      401: "登录已过期，请重新登录",
      403: "没有权限执行此操作",
      404: "请求的资源不存在",
      409: "数据冲突，请刷新后重试",
      422: "请求参数校验失败",
      500: "服务器内部错误，请稍后重试",
      502: "网关错误，请确认服务已启动",
      503: "服务暂不可用，请稍后重试",
      504: "网关超时，请稍后重试",
    };
    return statusText[status] || `请求失败（错误码 ${status}）`;
  }
  return "网络错误，请检查网络连接或服务器是否启动";
}

api.interceptors.response.use(
  (response) => {
    const res = response.data;
    if (res.code !== 0) {
      ElMessage.error(res.message || "请求失败");
      return Promise.reject(new Error(res.message));
    }
    return res.data;
  },
  (error) => {
    // 后台静默同步请求（缓存增量轮询 / 离线降级）失败不弹提示，由缓存层自行降级。
    if (error.config?.silent && error.response?.status !== 401) {
      return Promise.reject(error);
    }
    if (error.response?.status === 401) {
      const isLoginRequest = error.config?.url?.includes("/auth/login");
      if (isLoginRequest) {
        ElMessage.error(getErrorMessage(error));
      } else {
        localStorage.removeItem("token");
        clearAllCache();
        _resetMemo();
        window.location.hash = "#/login";
        // 优先采用后端明确提示：被新设备登录顶掉时后端返回「您的账号已在其他设备登录，请重新登录」；
        // 其余 401（token 过期 / 用户被删）后端返回通用「Unauthorized」，回退为「登录已过期」。
        const backendMsg = error.response?.data?.message;
        const msg =
          backendMsg && backendMsg !== "Unauthorized"
            ? backendMsg
            : "登录已过期，请重新登录";
        ElMessage.error(msg);
        // 派发「被顶号 / 登录过期」事件：通知 authStore 同步清空内存登录态，
        // 否则 localStorage 已清但内存 token ref 仍在，路由守卫会把刚跳到的 /login 又弹回首页（回弹）。
        window.dispatchEvent(new CustomEvent("auth:kicked"));
      }
    } else {
      ElMessage.error(getErrorMessage(error));
    }
    return Promise.reject(error);
  },
);

export interface ApiInstance {
  get: <T = any>(url: string, config?: any) => Promise<T>;
  post: <T = any>(url: string, data?: any, config?: any) => Promise<T>;
  put: <T = any>(url: string, data?: any, config?: any) => Promise<T>;
  patch: <T = any>(url: string, data?: any, config?: any) => Promise<T>;
  delete: <T = any>(url: string, config?: any) => Promise<T>;
  defaults: AxiosInstance["defaults"];
  interceptors: AxiosInstance["interceptors"];
}

// ===================== 本地全量副本 + 增量同步（降低服务器压力）=====================
// 设计（详见 client/src/api/cache.ts）：
//   1) 每个「资源集合」在本地维护全量副本；刷新时优先走增量（携带 updatedAfter），仅拉变更数据。
//   2) 首次 / 基线过期 / 被写失效 → 全量同步（大 pageSize 一次取回）。
//   3) 离线 → 用本地全量副本构造响应降级。
//   4) 复合地图（/maps/full）特殊对待：拆成 nodes/edges/nodeTypes/pathTypes 四个本地全量副本。
import {
  cacheGet,
  cacheSet,
  invalidateResource,
  clearAllCache,
  SEG_TO_RESOURCE,
  getFull,
  setFull,
  getBaseline,
  setBaseline,
  getFullSyncAt,
  setFullSyncAt,
  patchFullItems,
  extractItems,
  maxUpdatedAtOf,
  inferShape,
  listFullCollections,
  listMapSyncKeys,
} from "./cache";

// 周期强制全量对账：避免基线漂移 / 漏推导致本地副本长期偏离服务端。
const FULL_SYNC_INTERVAL_MS = 5 * 60 * 1000;
// 全量同步时一次性取回的最大条数（分页接口用此覆盖默认 pageSize）。
const LARGE_PAGE_SIZE = 10000;
// 这些参数不参与集合键（分页/时间戳是「视图」参数，不改变集合身份）。
const VIEW_PARAMS = new Set(["page", "pageSize", "updatedAfter"]);

const _getInflight = new Map<string, Promise<any>>();

// ---------- O3：跨挂载新鲜度窗口（stale-while-revalidate）----------
// 内存 memo：按「请求键」缓存最近一次成功响应；窗口内（且无该资源实时事件）直接返回，
// 避免同一资源在多个组件/多次挂载被重复发往服务端（仍是后台增量请求，但能省则省）。
const STALE_WINDOW_MS = 15 * 1000;
const _memo = new Map<string, { time: number; value: any }>();
// 各资源最近一次实时事件时间；事件后该资源的 memo 立即失效（绕过新鲜度窗口），保证及时刷新。
const _lastEventAt = new Map<string, number>();

function _resourceOf(url: string): string {
  const path = (url || "").split("?")[0];
  const seg = path.split("/").filter(Boolean)[0] || "";
  return SEG_TO_RESOURCE[seg] || seg;
}

/** 实时事件到达时调用：标记该资源「最近有变更」，使 O3 memo 立即失效并触发刷新。 */
export function bumpResourceEvent(resource: string): void {
  if (!resource) return;
  _lastEventAt.set(resource, Date.now());
}

/** 写操作 / 登录失效后清空内存 memo，避免返回被写失效前的陈旧数据。 */
function _resetMemo(): void {
  _memo.clear();
  _lastEventAt.clear();
}

function _reqKey(method: string, url: string, config?: any): string {
  const params = config?.params ? JSON.stringify(config.params) : "";
  return `${method.toUpperCase()} ${url} ${params}`;
}

function _cacheable(config?: any): boolean {
  // 仅当显式 cache === false 时才绕过本地缓存（直接走网络拿实时数据）；
  // cache 未设置（undefined，默认）或 cache === true 均走缓存。
  // 注意：此前误写为 `!config?.cache`，导致 cache:false 被反判为「可缓存」，
  // 使所有 cache:false 的实时请求（如消费者需求列表、删除影响检查）退化成读过期缓存，
  // 表现为「保存后重新打开看不到最新值」。
  return config?.cache !== false && !config?.signal;
}

/** 合并 URL 查询串与 axios params 为单一对象。 */
function collectParams(url: string, config?: any): Record<string, any> {
  const params: Record<string, any> = {};
  const qIdx = (url || "").indexOf("?");
  if (qIdx >= 0) {
    const sp = new URLSearchParams(url.slice(qIdx + 1));
    sp.forEach((v, k) => (params[k] = v));
  }
  if (config?.params) Object.assign(params, config.params);
  return params;
}

/** 由 URL + params 推导稳定的「集合键」：资源名 | 非视图参数的升序拼接。
 *  注意：嵌套路由（如 /competitions/123/fiscal-years）必须把子路径编入键，
 *  否则会与父列表（/competitions）撞同一个集合键，互相覆盖本地全量副本。 */
function collectionKeyFor(url: string, config?: any): string {
  const path = (url || "").split("?")[0];
  const parts = path.split("/").filter(Boolean);
  const seg = parts[0] || "";
  const resource = SEG_TO_RESOURCE[seg] || seg;
  const subPath = parts.slice(1).join("/"); // 嵌套子路径，如 "123/fiscal-years"
  const params = collectParams(url, config);
  const restParts: string[] = [];
  if (subPath) restParts.push(`_p=${subPath}`);
  for (const k of Object.keys(params)
    .filter((k) => !VIEW_PARAMS.has(k))
    .sort()) {
    restParts.push(`${k}=${params[k]}`);
  }
  return `${resource}|${restParts.join("&")}`;
}

function isMapFullUrl(url: string): boolean {
  return (url || "").split("?")[0].replace(/\/$/, "").endsWith("/maps/full");
}

const MAP_SUB_RESOURCES = ["mapNode", "mapEdge", "mapNodeType", "pathType"] as const;

function mapSyncKey(competitionId: any): string {
  return `mapFull|competitionId=${competitionId ?? ""}`;
}
function mapSubKey(resource: string, competitionId: any): string {
  return `${resource}|competitionId=${competitionId ?? ""}`;
}

/** 按集合的 shape 与请求的分页参数，把本地全量副本「还原」成组件期望的响应形态。 */
function reconstruct(items: any[], shape: "array" | "paged", params: Record<string, any>): any {
  if (shape === "array") return items;
  const page = params.page != null ? parseInt(String(params.page), 10) : 1;
  const pageSize = params.pageSize != null ? parseInt(String(params.pageSize), 10) : 50;
  const total = items.length;
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pageSize };
}

/** 全量同步：循环分页拉取，直到取满 total，避免单集合超过 LARGE_PAGE_SIZE 时本地副本被截断。
 *  返回合并后的响应（items 为全量，total 为真实总数），供 storeAndReturn 写入本地全量副本。 */
async function fetchFullSync(url: string, config: any, params: Record<string, any>): Promise<any> {
  const syncParams: Record<string, any> = { ...params, page: 1, pageSize: LARGE_PAGE_SIZE };
  const first: any = await (api as any).get(url, { ...config, params: syncParams });
  // 裸数组接口（competitions / companies / industry-types / warehouses / production-lines 等）：
  // 服务端忽略分页参数、一次返回全量数组。直接原样返回，避免被下方分页分支误裹成
  // { items, total, page, pageSize } 对象 —— 否则组件拿到非数组对象，[...res] 会抛 TypeError
  // 导致列表空白（且本地全量副本被错存为 "paged" 形状，后续增量刷新也一并出错）。
  if (Array.isArray(first)) return first;
  const ex = extractItems(first);
  if (!ex) return first; // 非列表（详情）：原样返回，无需分页
  const knownTotal = typeof first?.total === "number" ? first.total : null;
  if (knownTotal != null && knownTotal <= LARGE_PAGE_SIZE) return first; // 单页足以覆盖
  let items = ex.items.slice();
  let page = 1;
  let lastLen = ex.items.length;
  // 已知 total：拉到取满为止；未知 total（防御）：直到某页返回不足一页为止。
  while (knownTotal == null ? lastLen === LARGE_PAGE_SIZE : items.length < knownTotal) {
    page++;
    const r: any = await (api as any).get(url, { ...config, params: { ...syncParams, page, pageSize: LARGE_PAGE_SIZE } });
    const rx = extractItems(r);
    if (!rx || rx.items.length === 0) break;
    items = items.concat(rx.items);
    lastLen = rx.items.length;
    if (knownTotal != null && items.length >= knownTotal) break;
  }
  return { ...first, items, total: knownTotal ?? items.length };
}

/** 全量同步后写入本地副本并设立基线；按请求的分页参数「还原」成组件期望的响应形态返回。
 *  非列表形态（详情）按原 key 缓存以离线降级。 */
async function storeAndReturn(
  ck: string,
  v: any,
  params: Record<string, any>,
  url: string,
  config?: any,
): Promise<any> {
  const shape = inferShape(v);
  if (shape) {
    const items = extractItems(v)!.items;
    await setFull(ck, { items, shape });
    const base = v?.serverTime || maxUpdatedAtOf(v);
    if (base) await setBaseline(ck, base);
    await setFullSyncAt(ck, Date.now());
    // 还原分页形态：组件看到的是「当前页切片 + total=全量条数」，与改造前一致，
    // 同时本地已存全量副本，后续翻页/增量都无需再打服务器。
    return reconstruct(items, shape, params);
  }
  // 详情：保留原请求键的缓存，供离线降级
  await cacheSet(_reqKey("GET", url, config), v);
  return v;
}

// ---------- 复合地图 /maps/full ----------
function maxUpdatedAtComposite(v: any): string | null {
  let maxStr: string | null = null;
  let maxMs = -Infinity;
  for (const key of ["nodes", "edges", "nodeTypes", "pathTypes"]) {
    const arr = (v && v[key]) || [];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      const u = it?.updatedAt;
      if (u != null) {
        const ms = Date.parse(String(u));
        if (!Number.isNaN(ms) && ms > maxMs) {
          maxMs = ms;
          maxStr = String(u);
        }
      }
    }
  }
  return maxStr;
}

async function reconstructMap(competitionId: any): Promise<any> {
  const subs = MAP_SUB_RESOURCES.map((r) => mapSubKey(r, competitionId));
  const [n, e, nt, pt] = await Promise.all(subs.map(getFull));
  return {
    nodes: n?.items || [],
    edges: e?.items || [],
    nodeTypes: nt?.items || [],
    pathTypes: pt?.items || [],
  };
}

async function storeMapAndReturn(
  ck: string,
  competitionId: any,
  v: any,
): Promise<any> {
  const subs = MAP_SUB_RESOURCES.map((r) => mapSubKey(r, competitionId));
  await Promise.all([
    setFull(subs[0], { items: v?.nodes || [], shape: "array" }),
    setFull(subs[1], { items: v?.edges || [], shape: "array" }),
    setFull(subs[2], { items: v?.nodeTypes || [], shape: "array" }),
    setFull(subs[3], { items: v?.pathTypes || [], shape: "array" }),
  ]);
  const base = v?.serverTime || maxUpdatedAtComposite(v);
  if (base) await setBaseline(ck, base);
  await setFullSyncAt(ck, Date.now());
  return v;
}

async function syncMapFull(url: string, config: any, competitionId: any): Promise<any> {
  const ck = mapSyncKey(competitionId);
  const subs = MAP_SUB_RESOURCES.map((r) => mapSubKey(r, competitionId));
  const [fulls, baseline, fullSyncAt] = await Promise.all([
    Promise.all(subs.map(getFull)),
    getBaseline(ck),
    getFullSyncAt(ck),
  ]);
  const hasCopy = fulls.every((f) => f != null) && baseline != null;
  // 过期时带 requireExistingIds 复核删除；新鲜窗口下服务端 getFullMap 默认不下发 existingIds。
  const needReconcile = fullSyncAt != null && Date.now() - fullSyncAt >= FULL_SYNC_INTERVAL_MS;

  if (hasCopy && baseline) {
    // 本地已有全量副本：走增量，过期时带 requireExistingIds 复核删除（O2），不再整表重拉。
    const params = collectParams(url, config);
    const incParams: Record<string, any> = { ...params, updatedAfter: baseline };
    if (needReconcile) incParams.requireExistingIds = "true";
    const v = await (api as any).get(url, { ...config, params: incParams });
    if (v && v.incremental) {
      if (needReconcile) {
        await patchFullItems(subs[0], v.nodes || [], v.existingIds?.nodes);
        await patchFullItems(subs[1], v.edges || [], v.existingIds?.edges);
        await patchFullItems(subs[2], v.nodeTypes || [], v.existingIds?.nodeTypes);
        await patchFullItems(subs[3], v.pathTypes || [], v.existingIds?.pathTypes);
      } else {
        await patchFullItems(subs[0], v.nodes || []);
        await patchFullItems(subs[1], v.edges || []);
        await patchFullItems(subs[2], v.nodeTypes || []);
        await patchFullItems(subs[3], v.pathTypes || []);
      }
      await setBaseline(ck, v.serverTime || baseline);
      await setFullSyncAt(ck, Date.now());
      return reconstructMap(competitionId);
    }
    return storeMapAndReturn(ck, competitionId, v);
  }
  const v = await (api as any).get(url, config);
  return storeMapAndReturn(ck, competitionId, v);
}

async function degradeMap(competitionId: any, e: any): Promise<any> {
  const reconstructed = await reconstructMap(competitionId);
  if (
    reconstructed.nodes.length ||
    reconstructed.edges.length ||
    reconstructed.nodeTypes.length ||
    reconstructed.pathTypes.length
  ) {
    return reconstructed;
  }
  throw e;
}

// ---------- 公司产业字段（派生集合，特殊处理）----------
// 公司产业字段返回 { industryTypeId, fields:[...] } 而非列表形态，故不走通用列表逻辑，
// 而是像复合地图一样维护「每公司一份本地全量副本」（items = fields 数组，每项带 id/updatedAt）。
function isCompanyFieldsUrl(url: string): boolean {
  return (url || "").split("?")[0].replace(/\/$/, "").startsWith("/company-fields/");
}

function companyFieldId(url: string): number | null {
  const m = (url || "").split("?")[0].match(/\/company-fields\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function companyFieldKey(companyId: any): string {
  return `companyField|companyId=${companyId ?? ""}`;
}

async function storeCompanyFieldsAndReturn(ck: string, v: any): Promise<any> {
  const fields: any[] = v?.fields || [];
  await setFull(ck, { items: fields, shape: "array" });
  const base = v?.serverTime || maxUpdatedAtOf(fields);
  if (base) await setBaseline(ck, base);
  await setFullSyncAt(ck, Date.now());
  return { industryTypeId: v?.industryTypeId ?? null, fields };
}

async function syncCompanyFields(url: string, config: any, companyId: any): Promise<any> {
  const ck = companyFieldKey(companyId);
  const [full, baseline] = await Promise.all([
    getFull(ck),
    getBaseline(ck),
  ]);
  const hasCopy = full != null && baseline != null;

  try {
    if (hasCopy && baseline) {
      // 本地已有副本：走增量；服务端 getValues 始终回传 existingIds（含可见字段定义 id），
      // 前端据此核对被隐藏/被移除的字段，无需整表重拉（O2）。
      const params = collectParams(url, config);
      const v = await (api as any).get(url, {
        ...config,
        params: { ...params, updatedAfter: baseline },
      });
      if (v && v.incremental) {
        const merged = await patchFullItems(ck, v.fields || [], v.existingIds);
        await setBaseline(ck, v.serverTime || baseline);
        await setFullSyncAt(ck, Date.now());
        return { industryTypeId: v.industryTypeId ?? merged[0]?.industryTypeId ?? null, fields: merged };
      }
      // 服务端未返回增量形态（兜底）：按全量处理
      return storeCompanyFieldsAndReturn(ck, v);
    }
    // 首次 / 写失效：本地无副本，走全量同步
    const v = await (api as any).get(url, config);
    return storeCompanyFieldsAndReturn(ck, v);
  } catch (e: any) {
    const fullNow = await getFull(ck);
    if (fullNow) {
      return {
        industryTypeId: fullNow.items[0]?.industryTypeId ?? null,
        fields: fullNow.items,
      };
    }
    throw e;
  }
}

// ---------- 通用列表 ----------
async function cachedGetImpl(url: string, config: any): Promise<any> {
  // 复合地图
  if (isMapFullUrl(url)) {
    const params = collectParams(url, config);
    try {
      return await syncMapFull(url, config, params.competitionId);
    } catch (e) {
      return degradeMap(params.competitionId, e);
    }
  }

  // 公司产业字段（派生集合，每公司一份本地全量副本）
  if (isCompanyFieldsUrl(url)) {
    const cid = companyFieldId(url);
    if (cid == null) return (api as any).get(url, config);
    return syncCompanyFields(url, config, cid);
  }

  const ck = collectionKeyFor(url, config);
  const params = collectParams(url, config);
  const full = await getFull(ck);
  const baseline = await getBaseline(ck);
  const fullSyncAt = await getFullSyncAt(ck);
  const hasCopy = full != null && baseline != null;
  // 基线过期（>= FULL_SYNC_INTERVAL_MS）→ 走「对账」增量：携带 requireExistingIds，
  // 用服务端回传的全体 id 复核被删除/被移除的本地副本；新鲜窗口内仅拉变更，删除由实时事件精确处理。
  const needReconcile = fullSyncAt != null && Date.now() - fullSyncAt >= FULL_SYNC_INTERVAL_MS;

  try {
    if (hasCopy && baseline) {
      // 本地已有全量副本：始终走增量，不再整表重拉（O2）。
      const incParams: Record<string, any> = { ...params, updatedAfter: baseline };
      if (needReconcile) incParams.requireExistingIds = "true";
      const v = await (api as any).get(url, { ...config, params: incParams });
      if (v && v.incremental) {
        // 仅对账模式才用 existingIds 核对删除：新鲜窗口下服务端默认不下发 existingIds，
        // 误传空数组会把本地副本整盘清空（O1 行为变更）；删除由实时事件精确移除，无需全量核对。
        const merged = needReconcile
          ? await patchFullItems(ck, v.items || [], v.existingIds)
          : await patchFullItems(ck, v.items || []);
        await setBaseline(ck, v.serverTime || baseline);
        // 对账成功后刷新「上次全量同步时间」，使 existingIds 开销每 FULL_SYNC_INTERVAL_MS 才发生一次
        await setFullSyncAt(ck, Date.now());
        return reconstruct(merged, full!.shape, params);
      }
      // 服务端未返回增量形态（兜底）：按全量处理
      const fv = await fetchFullSync(url, config, params);
      return await storeAndReturn(ck, fv, params, url, config);
    }
    // 首次 / 写失效 / 401 清缓存：本地无副本，走全量同步（大 pageSize 一次取回）
    const v = await fetchFullSync(url, config, params);
    return await storeAndReturn(ck, v, params, url, config);
  } catch (e: any) {
    // 离线降级
    const fullNow = await getFull(ck);
    if (fullNow) return reconstruct(fullNow.items, fullNow.shape, params);
    const cached = await cacheGet(_reqKey("GET", url, config));
    if (cached !== null) return cached;
    throw e;
  }
}

async function _cachedGet<T = any>(url: string, config?: any): Promise<T> {
  if (!_cacheable(config)) {
    // 显式退出缓存的请求视为用户主动操作，仍正常弹错提示。
    return (api as any).get(url, config);
  }
  // 走本地全量副本 / 增量同步的 GET 均为「后台数据同步」，失败应静默降级
  // （缓存层已做离线/基线回退），不应向用户弹「权限不足」等提示，
  // 否则无权限的账号会被后台周期轮询频繁打扰。
  const silentConfig = { ...config, silent: true };
  const key = _reqKey("GET", url, silentConfig);
  const pending = _getInflight.get(key);
  if (pending) return pending as Promise<T>;

  // O3：窗口内且无该资源实时事件 → 直接返回内存副本，不打网络（含后台增量请求）。
  const resource = _resourceOf(url);
  const m = _memo.get(key);
  const lastEvt = _lastEventAt.get(resource) ?? -Infinity;
  if (m && Date.now() - m.time < STALE_WINDOW_MS && lastEvt <= m.time) {
    return m.value as T;
  }

  const p = cachedGetImpl(url, silentConfig).finally(() => _getInflight.delete(key));
  _getInflight.set(key, p);
  const result = await p;
  _memo.set(key, { time: Date.now(), value: result });
  return result as T;
}

function _mutating(
  method: "post" | "put" | "patch" | "delete",
  url: string,
  data?: any,
  config?: any,
) {
  const res =
    method === "delete"
      ? (api as any).delete(url, config)
      : (api as any)[method](url, data, config);
  // 写成功后按资源失效本地全量副本，保证后续读取走全量同步拿到最新；
  // 同时清空内存 memo，避免返回写失效前的陈旧增量数据（O3）。
  Promise.resolve(res).then(
    () => {
      invalidateResource(url);
      _resetMemo();
    },
    () => {},
  );
  return res;
}

// 反向映射：resource 名 → URL 首段（如 "material" → "materials"）
const RESOURCE_TO_SEG: Record<string, string> = Object.fromEntries(
  Object.entries(SEG_TO_RESOURCE).map(([seg, res]) => [res, seg]),
);

/**
 * 断线重连后主动对账：遍历本地已加载的全量副本，逐个发一次增量请求（带各自基线），
 * 用服务端回传的 existingIds 清理掉「断线 / 实时事件丢失期间」被删除的条目，
 * 无需等用户手动刷新或 5 分钟强制全量周期。仅对已有基线的集合生效（首次进入尚无
 * 副本的集合本就无脏数据，跳过）。
 */
export async function reconcileAllIncremental(): Promise<void> {
  try {
    const [cols, maps] = await Promise.all([listFullCollections(), listMapSyncKeys()]);

    // 普通集合：逐集合发一次增量请求
    await Promise.all(
      cols.map(async (c) => {
        // 公司产业字段：companyId 是路径参数，不能用通用的 `/<seg>` 拼法，单独处理
        if (c.resource === "companyField") {
          const m = c.rest.match(/companyId=(\d+)/);
          const cid = m ? Number(m[1]) : null;
          if (cid == null) return;
          const base = await getBaseline(c.collectionKey);
          if (!base) return;
          try {
            const v = await (api as any).get(`/company-fields/${cid}`, {
              params: { updatedAfter: base },
              silent: true,
            });
            if (v && v.incremental) {
              await patchFullItems(c.collectionKey, v.fields || [], v.existingIds);
              await setBaseline(c.collectionKey, v.serverTime || base);
            }
          } catch {
            /* 单个集合失败不影响其余 */
          }
          return;
        }
        const seg = RESOURCE_TO_SEG[c.resource];
        if (!seg || seg === "maps") return; // 复合地图单独处理
        if (c.rest.includes("_p=")) return; // 嵌套集合无独立增量接口，跳过（靠 5 分钟强制全量兜底）
        const baseline = await getBaseline(c.collectionKey);
        if (!baseline) return;
        const params: Record<string, any> = {};
        if (c.rest) {
          for (const kv of c.rest.split("&")) {
            const eq = kv.indexOf("=");
            if (eq > 0) params[kv.slice(0, eq)] = kv.slice(eq + 1);
          }
        }
        try {
          const v = await (api as any).get(`/${seg}`, {
            params: { ...params, updatedAfter: baseline, requireExistingIds: "true" },
            silent: true,
          });
          if (v && v.incremental) {
            await patchFullItems(c.collectionKey, v.items || [], v.existingIds);
            await setBaseline(c.collectionKey, v.serverTime || baseline);
          }
        } catch {
          /* 单个集合失败不影响其余 */
        }
      }),
    );

    // 复合地图：对每个已加载比赛发一次 /maps/full 增量请求
    await Promise.all(
      maps.map(async (m) => {
        const baseline = await getBaseline(m.syncKey);
        if (!baseline) return;
        try {
          const v = await (api as any).get("/maps/full", {
            params: { competitionId: m.competitionId, updatedAfter: baseline, requireExistingIds: "true" },
            silent: true,
          });
          if (v && v.incremental) {
            const subs = MAP_SUB_RESOURCES.map((r) => mapSubKey(r, m.competitionId));
            await patchFullItems(subs[0], v.nodes || [], v.existingIds?.nodes);
            await patchFullItems(subs[1], v.edges || [], v.existingIds?.edges);
            await patchFullItems(subs[2], v.nodeTypes || [], v.existingIds?.nodeTypes);
            await patchFullItems(subs[3], v.pathTypes || [], v.existingIds?.pathTypes);
            await setBaseline(m.syncKey, v.serverTime || baseline);
          }
        } catch {
          /* 忽略 */
        }
      }),
    );
  } catch {
    /* 忽略：对账失败不阻断主流程 */
  }
}

const cachedApi = {
  defaults: api.defaults,
  interceptors: api.interceptors,
  get: _cachedGet,
  post: (u: string, d?: any, c?: any) => _mutating("post", u, d, c),
  put: (u: string, d?: any, c?: any) => _mutating("put", u, d, c),
  patch: (u: string, d?: any, c?: any) => _mutating("patch", u, d, c),
  delete: (u: string, c?: any) => _mutating("delete", u, undefined, c),
} as unknown as ApiInstance;

export default cachedApi;
