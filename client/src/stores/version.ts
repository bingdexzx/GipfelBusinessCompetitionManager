import { defineStore } from "pinia";
import { ref } from "vue";
import api from "@/api/request";
import { CLIENT_VERSION_FALLBACK, resolveClientVersion } from "@/data/version";
import { versionBlocked } from "@/version-block";
import { disconnectRealtime } from "@/realtime/socket";

/**
 * 版本一致性校验 store（硬封锁）。
 *
 * 职责：
 *  - 应用启动（App.vue onMounted）及周期复核时请求公开接口 /api/version，与客户端自身版本比较；
 *  - 只要「服务端版本 ≠ 客户端版本」（无论谁新谁旧），即触发硬封锁：
 *      · 置全局 versionBlocked = true，请求拦截器据此拒绝一切业务请求（不发网络）；
 *      · 断开实时 WebSocket 通道；
 *      · 弹出不可关闭的提示层，告知「请联系管理员获取最新版本」。
 *  - 版本恢复一致时自动解除封锁，恢复全部功能。
 *  - 为保证校验请求自身不被封锁，调用接口时携带 bypassVersionBlock:true。
 */
export const useVersionStore = defineStore("appVersion", () => {
  const visible = ref(false);
  const serverVersion = ref("");
  const clientVersion = ref(CLIENT_VERSION_FALLBACK);

  /**
   * 校验版本一致性：请求公开接口 /api/version 并与自身版本比较，
   * 不一致即置 versionBlocked 并弹不可关闭提示，一致则解除封锁。
   */
  async function checkVersion() {
    clientVersion.value = await resolveClientVersion();
    try {
      // cache:false 走原始 axios（带 baseURL 与响应拦截器），不经本地缓存层；
      // silent:true 避免网络/服务端异常时弹出「网络错误」等打扰性提示；
      // bypassVersionBlock:true 确保本校验请求不受封锁影响（否则会被拦截器自我拒绝）。
      const res = await api.get("/version", {
        cache: false,
        silent: true,
        bypassVersionBlock: true,
      });
      const sv = (res && res.version) || "";
      if (!sv) return;
      serverVersion.value = sv;
      // 硬封锁：两者不一致即封锁（含客户端比服务端新、服务端比客户端新两种情况）。
      const mismatched = sv !== clientVersion.value;
      if (mismatched) {
        versionBlocked.value = true;
        disconnectRealtime();
        visible.value = true;
      } else {
        // 版本恢复一致：解除封锁，关闭提示层，恢复全部功能。
        versionBlocked.value = false;
        visible.value = false;
      }
    } catch {
      // 网络 / 服务端异常：不做封锁（避免服务器临时不可达把客户端锁死），
      // 也不弹提示，等下次复核再试。
    }
  }

  return { visible, serverVersion, clientVersion, checkVersion };
});
