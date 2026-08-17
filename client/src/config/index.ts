// 默认服务端地址。用户可在“系统设置”中修改，修改后写入 localStorage 的 serverUrl。
// 集中定义以避免在多个文件中重复硬编码。
export const DEFAULT_SERVER_URL = "http://localhost:3000";

/**
 * 规范化服务器地址：去空白、无协议时补 http://、去掉尾部斜杠，保留用户显式输入的 https。
 * 单一真源，避免各模块各自实现导致不一致（曾出现 request.ts 未归一化、可能拼出 `//api`）。
 */
export function normalizeServerUrl(raw: string): string {
  let u = (raw || "").trim();
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  u = u.replace(/\/+$/, "");
  return u;
}

/**
 * 返回 API 基址：优先 localStorage 中的用户配置，回退默认地址，并始终归一化。
 * 形如 `http://host:port`（不含尾部斜杠，不含 /api），调用方自行拼接 `/api`。
 */
export function getApiBaseUrl(): string {
  const raw = localStorage.getItem("serverUrl") || DEFAULT_SERVER_URL;
  return normalizeServerUrl(raw);
}

import { setActiveUser } from "@/utils/accountStorage";
import { resetServerRealm, realmForUrl, clearRealmData } from "@/utils/realm";

/**
 * 设置服务器地址并清理「旧服务器身份」的本地数据，从根上避免不同服务器本地数据串档 / token 跨服冒用。
 * 返回归一化后的地址（便于调用方持久化到 Electron 配置等）。
 *
 * serverUrl 是全局唯一写入点（stores/config.ts 与登录页均走本函数），集中在此保证清理逻辑不被绕开：
 *  1. 按「旧 realm」删除其全部 localStorage 账号键 + IndexedDB 全量副本库；
 *  2. setActiveUser(null) 重置激活账号指针（旧 token 已删 → 强制对新服务器重新登录）；
 *  3. 重置 realm 缓存并派发 server:changed 事件，清空缓存层内存 memo，避免旧服务器响应被新服务器命中。
 */
export function setServerUrl(url: string): string {
  const oldRaw = localStorage.getItem("serverUrl");
  const norm = normalizeServerUrl(url);
  if (oldRaw === norm) return norm; // 未变化：不动本地数据，避免误清登录态
  const oldRealm = realmForUrl(oldRaw);
  const newRealm = realmForUrl(norm);
  // 仅当「服务器身份」真正变化时才清理旧本地数据；等价归一化（同一 origin）视为同一服务器，保留数据。
  // 先按「旧服务器身份」清理其全部本地数据（token + IndexedDB 全量副本），
  // 确保切换到新服务器后旧 token 不会被复用（即便两台 JWT_SECRET 相同）。
  if (oldRealm !== newRealm) clearRealmData(oldRealm);
  // 重置激活账号指针：旧 token 已删，强制对新服务器重新登录。
  setActiveUser(null);
  resetServerRealm();
  localStorage.setItem("serverUrl", norm);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("server:changed"));
  }
  return norm;
}
