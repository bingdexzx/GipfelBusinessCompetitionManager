<template>
  <div class="settings">
    <h2 class="page-title">系统设置</h2>
    <div class="settings-section">
      <h3>服务器连接</h3>
      <el-form label-width="120px">
        <el-form-item label="服务器地址">
          <el-input v-model="serverUrl" :placeholder="DEFAULT_SERVER_URL" style="width: 360px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveServerUrl">保存</el-button>
          <el-button @click="testConnection">测试连接</el-button>
        </el-form-item>
      </el-form>
    </div>
    <div class="settings-section">
      <h3>关于</h3>
      <p>Gipfel商赛系统</p>
      <el-button @click="historyVisible = true">查看更新记录</el-button>
    </div>
    <AnnouncementHistoryDialog v-model="historyVisible" />
    <div class="settings-section">
      <h3>本地数据</h3>
      <p>
        客户端会将请求数据缓存在本地（IndexedDB）以加速加载并支持离线查看。若服务端已重置数据库，
        本地可能残留已不存在的内容。点击下方按钮可清空<strong>当前账号</strong>的本地缓存与当前比赛选择，
        下次将从服务端重新加载（其他账号的数据不受影响）。
      </p>
      <el-button type="warning" @click="clearLocalData">清空本地缓存</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useConfigStore } from "@/stores/config";
import { useCompetitionStore } from "@/stores/competition";
import { DEFAULT_SERVER_URL } from "@/config";
import { clearCurrentAccountCache } from "@/api/cache";
import { removeAccountItem } from "@/utils/accountStorage";
import axios from "axios";
import AnnouncementHistoryDialog from "@/components/AnnouncementHistoryDialog.vue";

const configStore = useConfigStore();
const serverUrl = ref(DEFAULT_SERVER_URL);
const competitionStore = useCompetitionStore();
const historyVisible = ref(false);

onMounted(async () => {
  await configStore.loadConfig();
  serverUrl.value = configStore.getBaseUrl();
});

async function saveServerUrl() {
  await configStore.setServerUrl(serverUrl.value);
  // serverUrl 变更后，HTTP 通道由请求拦截器即时切换；此处主动重建 WebSocket 通道，
  // 使其连到新服务器并按当前比赛重新订阅，避免实时更新仍指向旧地址而静默失效。
  competitionStore.reconnectRealtime();
  ElMessage.success("服务器地址已保存");
}

async function testConnection() {
  const base = serverUrl.value.replace(/\/$/, "");
  try {
    // 用真实的健康检查端点 /api/ping（返回 200），避免请求不存在的 GET /api/auth/login 产生 404 误报。
    await axios.get(`${base}/api/ping`, { timeout: 5000 });
    ElMessage.success("连接成功（服务端响应正常）");
  } catch (err: any) {
    if (err.response) {
      // 服务端有响应但非 2xx：仍说明网络可达，仅端点或状态异常。
      ElMessage.success("连接成功 (服务端已响应)");
    } else {
      ElMessage.warning("连接失败，请检查服务器地址和服务是否启动");
    }
  }
}

async function clearLocalData() {
  try {
    await ElMessageBox.confirm(
      "将清空当前账号的本地缓存（比赛、原料、公司等全部请求数据）与当前比赛选择，下次将从服务端重新加载。确定继续？",
      "清空本地缓存",
      { type: "warning" },
    );
  } catch {
    return; // 用户取消
  }
  // 仅清空当前账号的本地缓存（IndexedDB 全量副本）与当前比赛选择；
  // token（登录态）保留，不清空其他账号的数据——按账号分库天然隔离。
  await clearCurrentAccountCache();
  removeAccountItem("currentCompetition");
  ElMessage.success("本地缓存已清空，请刷新页面以重新加载数据");
}
</script>

<style scoped>
.page-title {
  font-size: 20px;
  font-weight: 500;
  color: #1f1f1f;
  margin: 0 0 24px;
}
.settings-section {
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 24px;
  margin-bottom: 16px;
}
.settings-section h3 {
  font-size: 16px;
  font-weight: 500;
  color: #1f1f1f;
  margin: 0 0 16px;
}
.settings-section p {
  font-size: 14px;
  color: #8c8c8c;
  margin: 4px 0;
}
</style>
