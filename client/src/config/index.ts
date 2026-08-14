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
