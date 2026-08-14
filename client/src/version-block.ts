import { ref } from "vue";

/**
 * 全局版本封锁标志。
 *
 * 当客户端自身版本与服务端版本「不一致」时置为 true，作为请求拦截器与实时连接的
 * 唯一封锁真源：被封锁后所有业务请求（除版本校验请求本身）一律不发网络，实时通道
 * 也被断开，前端以不可关闭的提示层告知用户「请联系管理员获取最新版本」。
 *
 * 单独抽成模块是为了避免 request.ts（请求层）与 stores/version.ts（版本 store）互相
 * import 形成循环依赖——二者都只引用本文件的 `versionBlocked`，本文件不依赖任何业务模块。
 */
export const versionBlocked = ref(false);
