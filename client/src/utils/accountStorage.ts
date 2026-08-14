// 账号隔离的本地存储真源（single source of truth）
// ==================================================
// 目标：同一浏览器 / 机器上不同账号的本地数据（token、当前比赛、已读公告版本，
// 以及 IndexedDB 全量副本）互不串档，根治「玩家账号之间缓存键如 competitionId=3 残留导致 403 串味」。
//
// 约定：
//  - 账号级 localStorage 键统一加前缀 `acct_u<id>__`，由 activeUserId 决定命名空间；
//  - 机器级配置（serverUrl 等）保持全局、不加前缀（在 config.ts 中直接读写，本模块不接管）；
//  - IndexedDB 缓存库按账号分库（见 api/cache.ts：库名 `gipfel-client-cache-u<id>`）。
//
// activeUserId 为内存级指针，同时持久化于全局键 `activeUserId`；登录 / 启动迁移时建立。

const ACTIVE_USER_KEY = "activeUserId";

// ---------- 激活账号指针（内存级，避免每次读 localStorage）----------
// null = 当前无激活账号（未登录 / 已登出）。该指针只决定「命名空间」，账号已持久化的数据不会因指针为 null 而丢失。
let _activeUserId: number | null = null;
let _initialized = false;

function readPersistedActiveUserId(): number | null {
  const raw = localStorage.getItem(ACTIVE_USER_KEY);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** 返回当前激活账号 id；首次访问时按需从持久化键恢复。 */
export function getActiveUserId(): number | null {
  if (!_initialized) {
    _activeUserId = readPersistedActiveUserId();
    _initialized = true;
  }
  return _activeUserId;
}

/** 设置激活账号（登录 / 迁移时调用）。
 *  id 为 null 表示清掉激活态（仅置空指针，仍保留该账号已持久化的数据，下次登录可恢复）。 */
export function setActiveUser(id: number | null): void {
  _activeUserId = id;
  _initialized = true;
  if (id == null) localStorage.removeItem(ACTIVE_USER_KEY);
  else localStorage.setItem(ACTIVE_USER_KEY, String(id));
}

function acctPrefix(id: number | null): string {
  return id == null ? "" : `acct_u${id}__`;
}

// ---------- 账号级 localStorage ----------
/** 读取当前账号命名空间下的字符串项；未设置激活账号时返回 null。 */
export function getAccountItem(key: string): string | null {
  const id = getActiveUserId();
  if (id == null) return null;
  return localStorage.getItem(acctPrefix(id) + key);
}

/** 写入当前账号命名空间下的字符串项；未设置激活账号时静默忽略。 */
export function setAccountItem(key: string, value: string): void {
  const id = getActiveUserId();
  if (id == null) return;
  localStorage.setItem(acctPrefix(id) + key, value);
}

/** 删除当前账号命名空间下的项。 */
export function removeAccountItem(key: string): void {
  const id = getActiveUserId();
  if (id == null) return;
  localStorage.removeItem(acctPrefix(id) + key);
}

// ---------- 启动一次性迁移（兼容升级前的旧顶层键）----------
function base64UrlDecode(str: string): string {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  // atob 仅支持 Latin1；JWT payload 的 sub 为数字（ASCII），解码足够取出用户 id。
  return decodeURIComponent(
    atob(b64 + pad)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join(""),
  );
}

/** 从 JWT（不校验签名）取出 payload.sub（用户 id）。失败返回 null。 */
function decodeJwtSub(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    const sub = payload?.sub;
    if (sub == null) return null;
    const n = Number(sub);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// 升级前（无账号隔离）的顶层键名
const OLD_TOP_LEVEL_KEYS = ["token", "currentCompetition", "announcementSeenVersion"];

/** 兼容升级前的旧顶层键：解码旧 token 的 sub，把顶层键搬进账号命名空间。返回迁移到的账号 id（无则 null）。 */
function migrateOldTopLevelKeys(): number | null {
  const oldToken = localStorage.getItem("token");
  if (!oldToken) return null;
  const sub = decodeJwtSub(oldToken);
  if (sub == null) {
    // 无法识别的旧 token：直接丢弃顶层键，避免污染。
    for (const k of OLD_TOP_LEVEL_KEYS) localStorage.removeItem(k);
    return null;
  }
  for (const k of OLD_TOP_LEVEL_KEYS) {
    const v = localStorage.getItem(k);
    if (v != null) {
      localStorage.setItem(`acct_u${sub}__${k}`, v);
      localStorage.removeItem(k);
    }
  }
  return sub;
}

/** 扫描已存在的账号 token 键，返回带 token 的账号 id（无则返回 null）。 */
function findAccountWithToken(): number | null {
  for (let i = 0; i < localStorage.length; i++) {
    const full = localStorage.key(i);
    if (full && full.startsWith("acct_u") && full.endsWith("__token")) {
      const token = localStorage.getItem(full);
      if (token) {
        const idStr = full.slice("acct_u".length, full.length - "__token".length);
        const n = Number(idStr);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

/** 删除升级前遗留的共享 IndexedDB 库（gipfel-client-cache）。新方案按账号分库，旧库不再使用。 */
function deleteOldSharedDb(): void {
  try {
    const req = indexedDB.deleteDatabase("gipfel-client-cache");
    req.onsuccess = () => {};
    req.onerror = () => {};
    req.onblocked = () => {};
  } catch {
    /* 忽略 */
  }
}

/**
 * 启动入口（main.ts 在 app.mount 前调用）：
 *  1. 兼容升级前的旧顶层 token：解码 sub 后搬入账号命名空间；
 *  2. 新方案：优先按持久化 activeUserId 恢复激活账号，否则扫描账号 token 键；
 *  3. 删除升级前遗留的共享 IndexedDB 库。
 * 幂等：可重复调用。迁移后，未显式登出的返回用户可继续保持登录态（token 仍在账号命名空间）。
 */
export function ensureStorageMigration(): void {
  const migratedSub = migrateOldTopLevelKeys();

  if (migratedSub != null) {
    setActiveUser(migratedSub);
  } else {
    const persisted = getActiveUserId();
    if (persisted != null) {
      // 即便该账号 token 已缺失（曾显式登出），也保持指针；competition.loadFromStorage 会据 token 守卫跳过。
      setActiveUser(persisted);
    } else {
      setActiveUser(findAccountWithToken());
    }
  }

  // 清理升级前遗留的共享 DB（新方案按账号分库，旧库不再使用）。
  deleteOldSharedDb();
}
