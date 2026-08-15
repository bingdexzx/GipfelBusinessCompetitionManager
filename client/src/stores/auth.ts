import { defineStore } from "pinia";
import { ref, computed } from "vue";
import api, { authApi } from "@/api";
import { getAccountItem, setAccountItem, removeAccountItem, setActiveUser } from "@/utils/accountStorage";

export interface UserInfo {
  id: number;
  username: string;
  role: string;
  displayName?: string;
  /** 是否需要在首次登录后修改初始密码（后端强制改密机制） */
  mustChangePassword?: boolean;
  permissions?: string[];
  /** 公司审核范围：可作为管理员/审核员审核其合同的公司 id 列表 */
  companyScopes?: number[];
  /** 公司查看范围：仅持 company:view 的账号，仅在范围内公司可见全量 / 可列示 */
  viewCompanyScopes?: number[];
  /** 股票系统管理范围（stock:edit 低级管理专属）：仅可在范围内公司的资金账户 + 自己的账户操作 */
  stockCompanyScopes?: number[];
  /** 归属比赛 id：归属比赛的账号（PLAYER/COMPETITION_ADMIN 等）非空，登录后自动锁定该比赛；
   *  超管 / 未分配账号为空（null），保持手动选择。 */
  competitionId?: number | null;
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string>(getAccountItem("token") || "");
  const user = ref<UserInfo | null>(null);

  const isLoggedIn = computed(() => !!token.value);
  const isSuperAdmin = computed(() => user.value?.role === "SUPER_ADMIN");

  /** 权限判断：SUPER_ADMIN 隐式拥有全部权限；其余按各自 permissions 列表校验。
   *  同域蕴含（与后端 hasPermission 一致）：读（view）可由该域任意能力满足，
   *  即持有 domain:edit / domain:manage 等也视为拥有 domain:view，避免给读接口加 view 守卫后
   *  既有 edit/manage 授权失效。 */
  function can(perm: string): boolean {
    if (user.value?.role === "SUPER_ADMIN") return true;
    const owned = user.value?.permissions ?? [];
    if (owned.includes(perm)) return true;
    const colon = perm.lastIndexOf(":");
    if (colon !== -1) {
      const domain = perm.slice(0, colon);
      const action = perm.slice(colon + 1);
      if (action === "view") {
        // 读是某域内最弱能力：持有该域任意能力即视为可读
        if (owned.some((p) => p === domain || p.startsWith(domain + ":"))) return true;
      } else if (action === "edit") {
        // 编辑可由管理满足（与后端 hasPermission 一致）
        if (owned.includes(`${domain}:manage`)) return true;
      }
    }
    return false;
  }

  /** 拥有给定权限中的任意一个即返回 true */
  function canAny(perms: string[]): boolean {
    if (user.value?.role === "SUPER_ADMIN") return true;
    const owned = user.value?.permissions ?? [];
    return perms.some((p) => owned.includes(p));
  }

  /** 是否为某公司的审核员/管理员（用于合同审核范围判断） */
  function canAuditCompany(companyId: number): boolean {
    if (user.value?.role === "SUPER_ADMIN") return true;
    const owned = user.value?.permissions ?? [];
    if (owned.includes("contract:execute")) return true; // 比赛级执行不受公司限制
    if (!owned.includes("contract:audit")) return false;
    const scopes = user.value?.companyScopes ?? [];
    return scopes.includes(companyId);
  }

  /** 后端强制改密：标记当前账号是否仍需修改初始密码 */
  const needsPasswordChange = computed(() => !!user.value?.mustChangePassword);

  /** 自助改密：用于首次登录强制改密流程；成功后清除标记。 */
  async function changePassword(oldPassword: string, newPassword: string) {
    await authApi.changePassword({ oldPassword, newPassword });
    if (user.value) user.value.mustChangePassword = false;
  }

  async function login(username: string, password: string) {
    const res = await authApi.login({ username, password });
    token.value = res.token;
    user.value = res.user;
    // 账号隔离：先建立激活账号指针，再写入该账号命名空间下的 token，使后续请求 / 缓存都归属该账号。
    setActiveUser(res.user.id);
    setAccountItem("token", res.token);
    startHeartbeat();
  }

  async function fetchProfile() {
    if (!token.value) return;
    if (user.value) {
      // 已加载（如刷新后重入应用）：只需确保心跳在运行
      startHeartbeat();
      return;
    }
    try {
      user.value = await authApi.getProfile();
      startHeartbeat();
    } catch (e) {
      console.error("Failed to fetch profile:", e);
      logout();
    }
  }

  // ---------- 会话心跳（单设备登录顶号）----------
  // 绝大多数 GET 走本地缓存、不发网络，旧设备停在界面浏览时不会触发任何被守卫的请求，
  // 也就不会被后端 tokenVersion 校验踢掉。心跳周期性向 /auth/me 真实打网络，
  // 一旦被新设备登录顶号（tokenVersion 不一致 → 后端 401），响应拦截器会清空登录态并跳转登录页。
  const HEARTBEAT_INTERVAL_MS = 45 * 1000;
  let heartbeatTimer: number | null = null;

  function stopHeartbeat() {
    if (heartbeatTimer != null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function startHeartbeat() {
    stopHeartbeat(); // 避免重复启动
    if (!token.value) return;
    heartbeatTimer = window.setInterval(async () => {
      if (!token.value) {
        stopHeartbeat();
        return;
      }
      try {
        // cache:false 确保绕过本地缓存层真实打网络；silent:true 避免瞬时网络抖动打扰用户。
        // 成功无副作用；被顶号时后端返回 401，由响应拦截器统一处理（清空登录态 + 跳转 + 派发事件）。
        await api.get("/auth/me", { cache: false, silent: true });
      } catch {
        // 401 已由响应拦截器处理；其余错误静默忽略，不中断心跳。
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function logout() {
    stopHeartbeat();
    token.value = "";
    user.value = null;
    // 仅移除账号命名空间下的 token（保留该账号其余已持久化数据，下次登录可恢复）；
    // activeUserId 指针保留，由 token 是否存在决定登录态（见 competition.loadFromStorage 守卫）。
    removeAccountItem("token");
  }

  // 监听「被顶号 / 登录过期」事件（请求拦截器在收到 401 时派发），
  // 同步清空内存登录态，避免「localStorage 已清但内存 token 仍在、路由守卫把登录页弹回首页」的回弹。
  window.removeEventListener("auth:kicked", logout);
  window.addEventListener("auth:kicked", logout);

  return {
    token,
    user,
    isLoggedIn,
    isSuperAdmin,
    needsPasswordChange,
    can,
    canAny,
    canAuditCompany,
    changePassword,
    login,
    fetchProfile,
    logout,
    startHeartbeat,
    stopHeartbeat,
  };
});
