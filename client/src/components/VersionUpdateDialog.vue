<template>
  <el-dialog
    :model-value="visible"
    title="版本不一致，功能已锁定"
    width="520px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    append-to-body
    :modal="true"
    class="version-block-dialog"
  >
    <div class="vb-body">
      <div class="vb-icon">!</div>
      <p class="vb-title">客户端版本与服务端版本不一致</p>
      <p class="vb-line">
        当前客户端：<b>v{{ clientVersion }}</b>　｜　服务端：<b>v{{ serverVersion }}</b>
      </p>
      <p class="vb-tip">
        为保证数据一致与功能正常，<b>已锁定全部功能并停止一切网络请求</b>。<br />
        请联系管理员获取最新版本后再继续使用。
      </p>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useVersionStore } from "@/stores/version";

const store = useVersionStore();
const { visible, serverVersion, clientVersion } = storeToRefs(store);
// 提示层不可手动关闭：锁定期间不提供任何关闭入口，版本恢复一致后由 store 自动隐藏。
</script>

<style scoped>
.version-block-dialog :deep(.el-dialog__header) {
  background: #b91c1c;
  color: #fff;
  margin-right: 0;
}
.version-block-dialog :deep(.el-dialog__title) {
  color: #fff;
  font-weight: 600;
}
.version-block-dialog :deep(.el-dialog__close) {
  display: none;
}
.vb-body {
  text-align: center;
  padding: 8px 4px 4px;
}
.vb-icon {
  width: 56px;
  height: 56px;
  line-height: 56px;
  margin: 0 auto 14px;
  border-radius: 50%;
  background: #fde2e2;
  color: #b91c1c;
  font-size: 32px;
  font-weight: 700;
}
.vb-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f1f1f;
  margin: 0 0 10px;
}
.vb-line {
  font-size: 14px;
  color: #4b5563;
  margin: 0 0 12px;
}
.vb-tip {
  font-size: 14px;
  line-height: 1.8;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 10px 14px;
  margin: 0;
}
</style>
