import { defineStore } from "pinia";
import { ref } from "vue";
import {
  DEFAULT_SERVER_URL,
  normalizeServerUrl,
  getApiBaseUrl,
  setServerUrl as persistServerUrl,
} from "@/config";

// 重新导出地址规范化工具，供视图层（如登录页）直接从本模块导入，保持一致来源。
export { normalizeServerUrl, getApiBaseUrl };

export const useConfigStore = defineStore("config", () => {
  const serverUrl = ref(DEFAULT_SERVER_URL);

  async function loadConfig() {
    try {
      const url = await window.electronAPI?.getConfig("serverUrl");
      if (url) serverUrl.value = url;
    } catch (e) {
      console.error("Failed to load config:", e);
    }
  }

  async function setServerUrl(url: string) {
    // 集中式写入：清理旧服务器身份的本地数据 + 重置登录态 + 写 localStorage（见 config/index.ts）。
    const norm = persistServerUrl(url);
    serverUrl.value = norm;
    try {
      await window.electronAPI?.setConfig("serverUrl", norm);
    } catch (e) {
      console.error("Failed to set server url:", e);
    }
  }

  function getBaseUrl(): string {
    return serverUrl.value || localStorage.getItem("serverUrl") || DEFAULT_SERVER_URL;
  }

  return { serverUrl, loadConfig, setServerUrl, getBaseUrl, normalizeServerUrl, getApiBaseUrl };
});
