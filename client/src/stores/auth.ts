import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { authApi } from "@/api";

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
}

export const useAuthStore = defineStore("auth", () => {
  const token = ref<string>(localStorage.getItem("token") || "");
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
    if (colon !== -1 && perm.slice(colon + 1) === "view") {
      const domain = perm.slice(0, colon);
      if (owned.some((p) => p === domain || p.startsWith(domain + ":"))) return true;
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
    localStorage.setItem("token", res.token);
  }

  async function fetchProfile() {
    if (!token.value) return;
    if (user.value) return; // 已加载则跳过，避免每次布局挂载都重复请求服务器
    try {
      user.value = await authApi.getProfile();
    } catch (e) {
      console.error("Failed to fetch profile:", e);
      logout();
    }
  }

  function logout() {
    token.value = "";
    user.value = null;
    localStorage.removeItem("token");
  }

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
  };
});
