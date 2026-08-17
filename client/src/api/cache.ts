// 客户端本地持久化缓存（IndexedDB）
// ===================================================================
// 增量同步设计（v2）：真正降低服务器压力的关键在网络层——
import { getActiveUserId } from "@/utils/accountStorage";
import { getServerRealm } from "@/utils/realm";
//   - 前端为每个「资源集合」（按 资源名 + 非分页查询参数 唯一标识）在本地维护一份「全量副本」；
//   - 列表刷新时：若本地已有全量副本且基线未过期，则携带 `updatedAfter=<基线>` 向服务器请求
//     「仅变更的数据」(服务端按 updatedAt 过滤)，前端按 id 增量 patch 本地全量副本；
//   - 服务端同时返回 `existingIds`（满足过滤条件的全部 id），前端据此 diff 出被删除的本地副本；
//   - 首次 / 基线过期 / 被写操作失效时，走「全量同步」（大 pageSize 一次取回），写入本地全量副本；
//   - 离线（请求失败）时，用本地全量副本构造响应降级，保证离线可读。
// IndexedDB 不可用时（如隐私模式）自动降级为「直接走网络」，不影响主流程。

const DB_VERSION = 1;
const STORE_NAME = "responses";

// IndexedDB 库按「服务器身份 realm + 账号」分库：库名含 realm 与当前激活账号 id，
// 使不同账号、不同服务器的全量副本 / 增量基线互不串档（参见 utils/realm.ts、utils/accountStorage.ts）。
const BASE_DB_NAME = "gipfel-client-cache";
function currentDbName(): string {
  const realm = getServerRealm();
  const id = getActiveUserId();
  return id == null ? `${BASE_DB_NAME}-${realm}-anon` : `${BASE_DB_NAME}-${realm}-u${id}`;
}

/**
 * 清理升级前「仅按账号、无 realm」的旧 IndexedDB 缓存库（gipfel-client-cache-u<id> / -anon）。
 * 新方案库名带 realm 段，旧库不再使用；启动时调用，fire-and-forget（不阻塞）。
 */
export function deleteOldAccountDbs(): void {
  try {
    if (typeof indexedDB === "undefined" || !(indexedDB as any).databases) return;
    (indexedDB as any)
      .databases()
      .then((dbs: any[]) => {
        for (const d of dbs) {
          const n = d.name || "";
          if (/^gipfel-client-cache-(u\d+|anon)$/.test(n)) {
            indexedDB.deleteDatabase(n);
          }
        }
      })
      .catch(() => {});
  } catch {
    /* 忽略 */
  }
}

// 本地全量副本的存储键格式：FULL|<资源名>|<非分页参数>
// 例如 FULL|material|competitionId=1
const FULL_PREFIX = "FULL|";
const BASELINE_PREFIX = "META|baseline|";
const FULLSYNC_PREFIX = "META|fullSyncAt|";

// URL 第一段 → 后端广播的资源名（单数）。用于把集合键与实时事件的 resource 对齐。
export const SEG_TO_RESOURCE: Record<string, string> = {
  materials: "material",
  parts: "part",
  products: "product",
  companies: "company",
  vehicles: "vehicle",
  infrastructures: "infrastructure",
  fuels: "fuel",
  contracts: "contract",
  "contract-types": "contractType",
  competitions: "competition",
  "industry-types": "industryType",
  users: "user",
  warehouses: "warehouse",
  "production-lines": "productionLine",
  "map-nodes": "mapNode",
  "map-edges": "mapEdge",
  "map-node-types": "mapNodeType",
  "path-types": "pathType",
  "tech-nodes": "techNode",
  regions: "region",
  stocks: "stock", // 股票主体
  "stock-accounts": "stockAccount", // 股票资金账户（细分资源，S6 修复）
  "stock-orders": "stockOrder", // 股票订单（细分资源，S6 修复）
  "stock-holdings": "stockHolding", // 股票持仓（细分资源，S6 修复）
  "stock-candles": "stockCandle", // 股票 K 线（细分资源，S6 修复）
  "company-fields": "companyField", // 公司产业字段（派生集合，由 request.ts 特殊处理）
  maps: "map", // 仅用于 /maps/full（复合地图由 request.ts 特殊处理）
};

let _dbPromise: Promise<IDBDatabase> | null = null;
let _dbName: string | null = null;

function openDB(): Promise<IDBDatabase> {
  const name = currentDbName();
  // 账号切换 / 库名变化（activeUserId 改变）：丢弃旧连接，按当前账号重新开库，
  // 使不同账号的全量副本物理隔离在各自 DB，互不串档。
  if (_dbPromise && _dbName === name) return _dbPromise;
  _dbPromise = null;
  _dbName = name;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB 不可用"));
      return;
    }
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

interface CacheRecord {
  key: string;
  data: any;
  savedAt: number;
}

/** 读取某 GET 请求的本地缓存；无 / 出错返回 null（调用方据此决定是否走网络）。 */
export async function cacheGet(key: string): Promise<any | null> {
  try {
    const db = await openDB();
    return await new Promise<any | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () =>
        resolve((req.result as CacheRecord | undefined)?.data ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** 写入某 GET 请求的本地缓存。失败静默忽略。 */
export async function cacheSet(key: string, data: any): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({
        key,
        data,
        savedAt: Date.now(),
      } as CacheRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 忽略：缓存写入失败不影响主流程 */
  }
}

// ===================== 本地全量副本（增量同步核心）=====================

export interface FullCopy {
  items: any[];
  shape: "array" | "paged";
}

const FULL_KEY = (collectionKey: string) => `${FULL_PREFIX}${collectionKey}`;
const BASELINE_KEY = (collectionKey: string) => `${BASELINE_PREFIX}${collectionKey}`;
const FULLSYNC_KEY = (collectionKey: string) => `${FULLSYNC_PREFIX}${collectionKey}`;

/** 读取某集合的本地全量副本；无返回 null。 */
export async function getFull(collectionKey: string): Promise<FullCopy | null> {
  const v = await cacheGet(FULL_KEY(collectionKey));
  return v && Array.isArray((v as FullCopy).items) ? (v as FullCopy) : null;
}

/** 写入某集合的本地全量副本。 */
export async function setFull(collectionKey: string, full: FullCopy): Promise<void> {
  await cacheSet(FULL_KEY(collectionKey), full);
}

/** 读取某集合的「同步基线」（上次增量同步见到的服务端时间 ISO）。 */
export async function getBaseline(collectionKey: string): Promise<string | null> {
  const v = await cacheGet(BASELINE_KEY(collectionKey));
  return typeof v === "string" ? v : null;
}

/** 写入某集合的「同步基线」。 */
export async function setBaseline(collectionKey: string, iso: string): Promise<void> {
  await cacheSet(BASELINE_KEY(collectionKey), iso);
}

/** 读取某集合「上次全量同步时间」（时间戳，用于周期强制全量对账）。 */
export async function getFullSyncAt(collectionKey: string): Promise<number | null> {
  const v = await cacheGet(FULLSYNC_KEY(collectionKey));
  return typeof v === "number" ? v : null;
}

/** 写入某集合「上次全量同步时间」。 */
export async function setFullSyncAt(collectionKey: string, ts: number): Promise<void> {
  await cacheSet(FULLSYNC_KEY(collectionKey), ts);
}

/**
 * 增量 patch：将服务端返回的「变更条目」按 id 合并进本地全量副本，
 * 若提供 existingIds（服务端满足过滤条件的全部 id），则移除本地不在其中的条目（被删除）。
 * 返回合并后的条目数组。
 */
export async function patchFullItems(
  collectionKey: string,
  changed: any[],
  existingIds?: number[],
): Promise<any[]> {
  const cur = await getFull(collectionKey);
  const map = new Map<number, any>();
  if (cur) for (const it of cur.items) if (it && it.id != null) map.set(it.id, it);
  for (const it of changed || []) {
    if (it && it.id != null) map.set(it.id, it);
  }
  let result = Array.from(map.values());
  // existingIds 为数组时（含空数组）视为服务端确认的全量 id 集合，
  // 本地不在其中的条目即为已删除，应移除。仅 undefined/null 表示「服务端未返回」跳过过滤。
  if (existingIds && Array.isArray(existingIds)) {
    const existSet = new Set(existingIds as number[]);
    result = result.filter((it) => it && existSet.has(it.id));
  }
  const shape: "array" | "paged" = cur ? cur.shape : result.length ? "paged" : "array";
  await setFull(collectionKey, { items: result, shape });
  return result;
}

/**
 * 精确删除：实时事件（action=deleted）时，从所有属于该资源的本地全量副本中移除指定 id，
 * 避免触发整表重拉。使用 IDBKeyRange 限定前缀扫描范围，避免遍历全部键。
 */
export async function removeFullItemByResource(resource: string, id: number): Promise<void> {
  const prefix = `${FULL_PREFIX}${resource}|`;
  const upperBound = prefix + "￿"; // 前缀范围上界
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const range = IDBKeyRange.bound(prefix, upperBound, false, false);
      const req = store.openCursor(range);
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const rec = cursor.value as CacheRecord;
          const data = rec?.data;
          if (data && Array.isArray(data.items)) {
            const filtered = data.items.filter((it: any) => !(it && it.id === id));
            if (filtered.length !== data.items.length) {
              cursor.update({ ...rec, data: { ...data, items: filtered } });
            }
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 忽略 */
  }
}

// ===================== 断线重连后主动对账 =====================

export interface FullCollectionInfo {
  collectionKey: string; // 不含 FULL| 前缀，如 "material|competitionId=1"
  resource: string; // 如 "material"
  rest: string; // 非视图参数拼接（可能为空），如 "competitionId=1"
}

/** 列出本地所有已加载的全量副本集合键（用于断线重连后主动增量对账）。 */
export async function listFullCollections(): Promise<FullCollectionInfo[]> {
  const out: FullCollectionInfo[] = [];
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const k = cursor.key as string;
          if (k.startsWith(FULL_PREFIX)) {
            const body = k.slice(FULL_PREFIX.length);
            const sep = body.indexOf("|");
            const resource = sep >= 0 ? body.slice(0, sep) : body;
            const rest = sep >= 0 ? body.slice(sep + 1) : "";
            out.push({ collectionKey: body, resource, rest });
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 忽略 */
  }
  return out;
}

/** 列出已加载的复合地图（/maps/full）及其比赛，用于重连后主动对账。 */
export async function listMapSyncKeys(): Promise<{ syncKey: string; competitionId: any }[]> {
  const out: { syncKey: string; competitionId: any }[] = [];
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const k = cursor.key as string;
          const p = `${BASELINE_PREFIX}mapFull|`;
          if (k.startsWith(p)) {
            const body = k.slice(p.length); // competitionId=1
            const ci = body.split("=")[1];
            out.push({
              syncKey: `mapFull|${body}`,
              competitionId: ci == null || ci === "" ? undefined : Number(ci),
            });
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 忽略 */
  }
  return out;
}

// ===================== 失效 / 清空 =====================

/**
 * 按资源失效本地全量副本与元数据：删除 FULL|<resource>|*、META|baseline|<resource>|*、
 * META|fullSyncAt|<resource>|* 三类键。写操作（POST/PUT/PATCH/DELETE）成功后调用，
 * 使下一次读取走「全量同步」，保证数据最新。
 *
 * 例外：公司产业字段（company-fields）是「每公司一份」的派生集合，副本键形如
 * companyField|companyId=123。写某企业字段时仅失效该企业副本，避免按资源前缀全清
 * 误伤其他企业的本地全量副本（过度失效）。
 */
export async function invalidateResource(url: string): Promise<void> {
  const rawPath = (url.split("?")[0]) || "";
  const seg = (rawPath.split("/").filter(Boolean)[0]) || "";
  const resource = SEG_TO_RESOURCE[seg] || seg;
  if (!resource) return;

  // 公司产业字段：解析路径中的 companyId，仅删除该企业对应的精确键。
  if (resource === "companyField") {
    const m = rawPath.match(/\/company-fields\/(\d+)/);
    const cid = m ? Number(m[1]) : null;
    if (cid != null) {
      const target = `companyField|companyId=${cid}`;
      const exactKeys = [
        `${FULL_PREFIX}${target}`,
        `${BASELINE_PREFIX}${target}`,
        `${FULLSYNC_PREFIX}${target}`,
      ];
      await deleteExact(exactKeys);
      return;
    }
  }

  const prefixes = [
    `${FULL_PREFIX}${resource}|`,
    `${BASELINE_PREFIX}${resource}|`,
    `${FULLSYNC_PREFIX}${resource}|`,
  ];
  await deleteByPrefixes(prefixes);
}

/** 精确删除给定键集合（用于 company-fields 等按 id 区分的派生集合）。 */
async function deleteExact(keys: string[]): Promise<void> {
  const keySet = new Set(keys);
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const k = cursor.key as string;
          if (keySet.has(k)) store.delete(k);
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 忽略 */
  }
}

/** 按前缀删除键（用于普通资源按资源名批量失效）。 */
async function deleteByPrefixes(prefixes: string[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const k = cursor.key as string;
          if (prefixes.some((p) => k.startsWith(p))) store.delete(k);
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 忽略 */
  }
}

/** 清空当前账号的本地缓存（登出 / 401 顶号 / 设置页「清空本地缓存」时调用）。
 *  仅清当前账号所属 DB 的存储，不影响其他账号——按账号分库天然隔离。 */
export async function clearCurrentAccountCache(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 忽略 */
  }
}

// ===================== 列表形态识别（兼容裸数组 / 分页对象 / 复合地图）=====================

/** 从响应中提取「对象数组」：兼容裸数组与分页对象 { items: [...] }。非列表形态返回 null。 */
export function extractItems(payload: unknown): { items: any[]; wrap: any | null } | null {
  if (Array.isArray(payload)) return { items: payload as any[], wrap: null };
  if (payload && typeof payload === "object" && Array.isArray((payload as any).items)) {
    return { items: (payload as any).items as any[], wrap: payload };
  }
  return null;
}

/** 取响应中所有条目的最大 updatedAt（原始字符串，保留精度）；无 updatedAt 时返回当前时间 ISO 作为 fallback。 */
export function maxUpdatedAtOf(payload: unknown): string | null {
  const ex = extractItems(payload);
  if (!ex) return null;
  let maxStr: string | null = null;
  let maxMs = -Infinity;
  for (const it of ex.items) {
    const u = (it as any)?.updatedAt;
    if (u != null) {
      const ms = Date.parse(String(u));
      if (!Number.isNaN(ms) && ms > maxMs) {
        maxMs = ms;
        maxStr = String(u);
      }
    }
  }
  // 无 updatedAt 的条目：用当前时间作为 fallback，确保基线被设置，后续增量请求能正常工作
  if (maxStr == null) maxStr = new Date().toISOString();
  return maxStr;
}

/**
 * 按响应形态生成/推断全量副本的 shape：
 * - 裸数组 → "array"
 * - 分页对象 { items, total } → "paged"
 * - 其它（详情对象）→ null（不视为可增量同步的列表）
 */
export function inferShape(payload: unknown): "array" | "paged" | null {
  if (Array.isArray(payload)) return "array";
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as any).items) &&
    (payload as any).total !== undefined
  ) {
    return "paged";
  }
  return null;
}
