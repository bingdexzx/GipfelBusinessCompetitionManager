/**
 * 登录失败限流（零依赖，进程级内存实现）：
 *
 * 仅对「失败」登录尝试计数——成功登录不计入阈值，避免管理员调试时正常登录被误锁。
 * 5 分钟内同一「IP + 用户名」失败超过 10 次锁定 15 分钟，抵御默认超管 admin 的口令爆破。
 *
 * 多实例部署建议改为 Redis 等共享存储；当前为单进程内存实现。
 */
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX = 10;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

interface LoginRecord {
  count: number;
  first: number;
  lockedUntil: number;
}

const loginFailures = new Map<string, LoginRecord>();

export function loginKey(ip: string, username: string): string {
  return `${ip}:${username || ""}`;
}

/** 当前是否处于锁定状态（锁定期间所有登录尝试直接拦截）。 */
export function isLoginLocked(ip: string, username: string): boolean {
  const rec = loginFailures.get(loginKey(ip, username));
  return !!rec && rec.lockedUntil > Date.now();
}

/** 记录一次登录失败；达到阈值则锁定。 */
export function registerLoginFailure(ip: string, username: string): void {
  const now = Date.now();
  const key = loginKey(ip, username);
  const rec = loginFailures.get(key);
  const fresh = !rec || now - rec.first > LOGIN_WINDOW_MS;
  const next: LoginRecord = fresh
    ? { count: 1, first: now, lockedUntil: 0 }
    : { count: rec!.count + 1, first: rec!.first, lockedUntil: rec!.lockedUntil };
  if (!fresh && next.count >= LOGIN_MAX) {
    next.lockedUntil = now + LOGIN_LOCK_MS;
  }
  loginFailures.set(key, next);
}

/** 登录成功后清除该主体的失败计数，使其不被历史失败拖入锁定。 */
export function resetLoginFailure(ip: string, username: string): void {
  loginFailures.delete(loginKey(ip, username));
}

// 周期清理过期记录，避免内存无限增长。
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginFailures) {
    if (now - v.first > LOGIN_WINDOW_MS && v.lockedUntil < now) loginFailures.delete(k);
  }
}, LOGIN_WINDOW_MS).unref();
