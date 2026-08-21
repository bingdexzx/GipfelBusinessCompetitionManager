/**
 * 客户端版本信息。
 *
 * 生产环境（Electron 打包）客户端自身版本由 Electron 运行时 app.getVersion() 提供
 * （取自 client/package.json 的 version），通过 preload 的 electronAPI.getAppVersion 暴露。
 * 非 Electron 环境（如纯 vite dev）无该接口，回退到 package.json 的 version。
 * 使用 Vite 内置的 __APP_VERSION__ 宏自动从 package.json 读取，无需手动同步。
 */
// Vite 不内置 __APP_VERSION__，通过 define 在 vite.config.ts 注入；
// 若未注入（如直接 ts-node 执行），回退到 package.json 当前版本。
declare const __APP_VERSION__: string | undefined;
export const CLIENT_VERSION_FALLBACK: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.3.16";

/** 解析客户端自身版本：优先 Electron app.getVersion()，失败回退常量。 */
export async function resolveClientVersion(): Promise<string> {
  try {
    const electronAPI = (window as any)?.electronAPI;
    if (electronAPI && typeof electronAPI.getAppVersion === "function") {
      const v = await electronAPI.getAppVersion();
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch {
    /* 忽略，回退常量 */
  }
  return CLIENT_VERSION_FALLBACK;
}
