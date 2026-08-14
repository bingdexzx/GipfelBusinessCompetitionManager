/**
 * 客户端版本信息。
 *
 * 生产环境（Electron 打包）客户端自身版本由 Electron 运行时 app.getVersion() 提供
 * （取自 client/package.json 的 version），通过 preload 的 electronAPI.getAppVersion 暴露。
 * 非 Electron 环境（如纯 vite dev）无该接口，回退到下方常量。
 * 发版时请确保该常量与 client/package.json 的 version 保持一致。
 */
export const CLIENT_VERSION_FALLBACK = "1.0.0";

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
