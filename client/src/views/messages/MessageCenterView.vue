<template>
  <div class="message-center">
    <h2 class="page-title">消息中心</h2>

    <el-tabs v-model="activeTab" class="msg-tabs" @tab-change="onTabChange">
      <el-tab-pane name="inbox">
        <template #label>
          <span class="tab-label">
            收件箱
            <el-badge
              v-if="messageStore.unreadCount > 0"
              :value="messageStore.unreadCount"
              :max="99"
              type="danger"
              class="tab-badge"
            />
          </span>
        </template>
        <div class="toolbar">
          <el-button :icon="Refresh" @click="refresh">刷新</el-button>
          <el-button
            class="toolbar-right"
            :icon="Check"
            :disabled="messageStore.unreadCount === 0"
            @click="markAllRead"
            >全部标为已读</el-button
          >
        </div>
        <div class="list-wrap">
          <div v-if="loading" class="empty-tip"><el-icon class="is-loading"><Loading /></el-icon> 加载中…</div>
          <div v-else-if="!inboxItems.length" class="empty-tip">暂无消息</div>
          <div
            v-for="item in inboxItems"
            :key="item.recipientId"
            class="msg-card"
            :class="{ unread: !item.read }"
            @click="markRead(item)"
          >
            <span class="read-dot" :class="{ on: !item.read }"></span>
            <div class="msg-main">
              <div class="msg-row">
                <span class="msg-title">{{ item.message.title }}</span>
                <span class="msg-sender">{{ item.senderName }}</span>
                <span class="msg-time">{{ formatTime(item.message.createdAt) }}</span>
              </div>
              <div class="msg-content">{{ item.message.content }}</div>
            </div>
            <el-tag v-if="!item.read" size="small" type="primary" effect="plain" class="unread-tag"
              >未读</el-tag
            >
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane v-if="canManage" name="sent">
        <template #label><span class="tab-label">已发布</span></template>
        <div class="toolbar">
          <el-button :icon="Refresh" @click="refresh">刷新</el-button>
          <el-button
            class="toolbar-right"
            type="primary"
            :icon="Promotion"
            @click="openPublish"
            >发布消息</el-button
          >
        </div>
        <div class="list-wrap">
          <div v-if="loading" class="empty-tip"><el-icon class="is-loading"><Loading /></el-icon> 加载中…</div>
          <div v-else-if="!sentItems.length" class="empty-tip">尚未发布任何消息</div>
          <div v-for="item in sentItems" :key="item.id" class="msg-card sent">
            <div class="msg-main">
              <div class="msg-row">
                <span class="msg-title">{{ item.title }}</span>
                <span class="msg-time">{{ formatTime(item.createdAt) }}</span>
              </div>
              <div class="msg-content">{{ item.content }}</div>
              <div class="msg-meta">
                <el-tag size="small" effect="plain" type="info"
                  >接收 {{ item._count.recipients }} 人</el-tag
                >
                <el-tag v-if="item.targetsAll" size="small" effect="plain" type="success"
                  >本比赛全体</el-tag
                >
              </div>
            </div>
            <el-button
              class="del-btn"
              :icon="Delete"
              text
              type="danger"
              @click.stop="deleteSent(item)"
              >删除</el-button
            >
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 发布消息对话框 -->
    <el-dialog v-model="publishVisible" title="发布消息" width="560px" append-to-body @closed="resetPublish">
      <el-form ref="publishFormRef" :model="publishForm" :rules="publishRules" label-width="92px">
        <el-form-item label="标题" prop="title">
          <el-input v-model="publishForm.title" maxlength="80" show-word-limit placeholder="请输入消息标题" />
        </el-form-item>
        <el-form-item label="内容" prop="content">
          <el-input
            v-model="publishForm.content"
            type="textarea"
            :rows="5"
            maxlength="2000"
            show-word-limit
            placeholder="请输入消息内容"
          />
        </el-form-item>
        <el-form-item v-if="isSuperAdmin" label="按比赛筛选" prop="filterCompetitionId">
          <el-select
            v-model="publishForm.filterCompetitionId"
            placeholder="不筛选（全部比赛）"
            clearable
            filterable
            style="width: 100%"
            @change="onFilterCompetitionChange"
          >
            <el-option
              v-for="c in competitions"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="本比赛全部">
          <el-switch v-model="publishForm.targetsAll" />
          <span class="form-hint">开启后向范围内全部账号发送，下方选择失效。</span>
        </el-form-item>
        <el-form-item label="接收账号" prop="targetUserIds">
          <el-select
            v-model="publishForm.targetUserIds"
            multiple
            filterable
            :disabled="publishForm.targetsAll"
            placeholder="选择接收账号"
            style="width: 100%"
          >
            <el-option
              v-for="u in selectableUsers"
              :key="u.id"
              :label="u.displayName || u.username"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="publishVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitPublish">发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Refresh,
  Promotion,
  Loading,
  Check,
  Delete,
} from "@element-plus/icons-vue";
import api, { messagesApi, type InboxItem, type SentItem } from "@/api";
import { useAuthStore } from "@/stores/auth";
import { useMessageStore } from "@/stores/message";

const authStore = useAuthStore();
const messageStore = useMessageStore();

const activeTab = ref<"inbox" | "sent">("inbox");
const loading = ref(false);
const inboxItems = ref<InboxItem[]>([]);
const sentItems = ref<SentItem[]>([]);

const canManage = computed(() => authStore.can("message:manage"));
const isSuperAdmin = computed(() => authStore.isSuperAdmin);

// ---------- 数据加载 ----------
async function loadInbox() {
  loading.value = true;
  try {
    inboxItems.value = await messagesApi.inbox();
  } catch (e) {
    console.error("加载收件箱失败:", e);
  } finally {
    loading.value = false;
    // 进入收件箱后以服务端权威未读数刷新红点（标读动作另行递减）。
    messageStore.fetchUnread();
  }
}

async function loadSent() {
  loading.value = true;
  try {
    sentItems.value = await messagesApi.sent();
  } catch (e) {
    console.error("加载已发布失败:", e);
  } finally {
    loading.value = false;
  }
}

function refresh() {
  if (activeTab.value === "inbox") loadInbox();
  else loadSent();
}

function onTabChange() {
  if (activeTab.value === "inbox") loadInbox();
  else loadSent();
}

async function markRead(item: InboxItem) {
  if (item.read) return;
  try {
    await messagesApi.markRead(item.message.id);
    item.read = true;
    if (messageStore.unreadCount > 0) messageStore.unreadCount--;
  } catch (e) {
    console.error("标记已读失败:", e);
  }
}

async function markAllRead() {
  try {
    await messageStore.markAllRead();
    inboxItems.value.forEach((i) => (i.read = true));
  } catch (e) {
    console.error("全部已读失败:", e);
  }
}

async function deleteSent(item: SentItem) {
  try {
    await ElMessageBox.confirm(`确认删除消息《${item.title}》？`, "删除确认", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  try {
    await messagesApi.remove(item.id);
    sentItems.value = sentItems.value.filter((s) => s.id !== item.id);
    ElMessage.success("已删除");
  } catch (e) {
    console.error("删除失败:", e);
    ElMessage.error("删除失败");
  }
}

// ---------- 发布对话框 ----------
const publishVisible = ref(false);
const submitting = ref(false);
const publishFormRef = ref<any>(null);
const selectableUsers = ref<{ id: number; username: string; displayName?: string }[]>([]);
const competitions = ref<{ id: number; name: string }[]>([]);

const publishForm = reactive({
  title: "",
  content: "",
  targetsAll: false,
  targetUserIds: [] as number[],
  filterCompetitionId: undefined as number | undefined,
});

const publishRules = {
  title: [{ required: true, message: "请输入标题", trigger: "blur" }],
  content: [{ required: true, message: "请输入内容", trigger: "blur" }],
  targetUserIds: [
    {
      validator: (_r: any, value: number[], cb: (e?: Error) => void) => {
        if (!publishForm.targetsAll && (!value || value.length === 0)) {
          cb(new Error("请至少选择一个接收账号，或开启「本比赛全部」"));
        } else {
          cb();
        }
      },
      trigger: "change",
    },
  ],
};

function resetPublish() {
  publishForm.title = "";
  publishForm.content = "";
  publishForm.targetsAll = false;
  publishForm.targetUserIds = [];
  publishForm.filterCompetitionId = undefined;
  selectableUsers.value = [];
  publishFormRef.value?.clearValidate?.();
}

async function openPublish() {
  if (isSuperAdmin.value) {
    try {
      competitions.value = await api.get("/competitions").then((res: any) =>
        Array.isArray(res) ? res : res?.items ?? [],
      );
    } catch {
      competitions.value = [];
    }
  }
  await loadSelectableUsers();
  publishVisible.value = true;
}

async function loadSelectableUsers() {
  try {
    const cid = isSuperAdmin.value ? publishForm.filterCompetitionId : undefined;
    selectableUsers.value = await messagesApi.selectableUsers(cid);
  } catch (e) {
    console.error("加载可选账号失败:", e);
    selectableUsers.value = [];
  }
}

function onFilterCompetitionChange() {
  loadSelectableUsers();
  publishForm.targetUserIds = [];
}

async function submitPublish() {
  try {
    await publishFormRef.value.validate();
  } catch {
    return;
  }
  submitting.value = true;
  try {
    await messagesApi.create({
      title: publishForm.title.trim(),
      content: publishForm.content.trim(),
      targetsAll: publishForm.targetsAll,
      targetUserIds: publishForm.targetUserIds,
      // 超管经「按比赛筛选」选中的比赛 → 后端据此把「本比赛全体」/显式选人收敛到该比赛；
      // 不选则为全部比赛（全站广播）。归属账号恒以自身比赛为准，此字段被忽略。
      competitionId: publishForm.filterCompetitionId,
    });
    ElMessage.success("消息已发布");
    publishVisible.value = false;
    if (activeTab.value !== "sent" && canManage.value) {
      activeTab.value = "sent";
    }
    loadSent();
  } catch (e: any) {
    console.error("发布失败:", e);
    ElMessage.error(e?.response?.data?.message || "发布失败");
  } finally {
    submitting.value = false;
  }
}

function formatTime(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

onMounted(() => {
  loadInbox();
});
</script>

<style scoped>
.message-center {
  width: 100%;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.toolbar-right {
  margin-left: auto;
}
.msg-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tab-badge {
  margin-top: -2px;
}
.list-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 120px;
}
.empty-tip {
  text-align: center;
  color: var(--color-text-tertiary, #9aa1ad);
  padding: 40px 0;
  font-size: 14px;
}
.msg-card {
  position: relative;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 16px 18px;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #e8eaef);
  border-radius: var(--radius, 12px);
  cursor: pointer;
  transition: box-shadow 0.2s, border-color 0.2s, transform 0.2s;
}
.msg-card:hover {
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08);
  border-color: var(--color-primary, #6366f1);
}
.msg-card.sent {
  cursor: default;
}
.read-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-top: 6px;
  background: transparent;
}
.read-dot.on {
  background: var(--color-primary, #6366f1);
  box-shadow: 0 0 0 4px var(--gradient-brand-soft, #eef0ff);
}
.msg-main {
  flex: 1 1 auto;
  min-width: 0;
}
.msg-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}
.msg-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text, #1f2330);
}
.msg-sender {
  font-size: 12px;
  color: var(--color-text-tertiary, #9aa1ad);
}
.msg-time {
  margin-left: auto;
  font-size: 12px;
  color: var(--color-text-tertiary, #9aa1ad);
  white-space: nowrap;
}
.msg-content {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--color-text-secondary, #51586a);
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-meta {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.unread-tag {
  flex: 0 0 auto;
}
.del-btn {
  flex: 0 0 auto;
}
.form-hint {
  margin-left: 10px;
  font-size: 12px;
  color: var(--color-text-tertiary, #9aa1ad);
}
</style>
