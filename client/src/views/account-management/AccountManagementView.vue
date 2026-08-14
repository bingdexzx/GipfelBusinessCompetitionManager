<template>
  <div class="account-management">
    <h2 class="page-title">账号管理</h2>

    <el-tabs v-model="activeTab">
      <!-- 系统账号：不归属任何比赛（全局账号） -->
      <el-tab-pane label="账号（系统）" name="system">
        <div class="toolbar">
          <el-button type="primary" @click="showCreateDialog('system')">新建账号</el-button>
        </div>
        <el-table :data="systemUsers" border stripe style="width: 100%; margin-top: 16px">
          <el-table-column prop="username" label="用户名" />
          <el-table-column prop="displayName" label="显示名称" />
          <el-table-column prop="role" label="角色">
            <template #default="{ row }">
              <el-tag :type="roleTag(row.role)">{{ roleLabel(row.role) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="权限" width="110">
            <template #default="{ row }">
              <el-tag :type="permSummary(row).type" size="small">{{
                permSummary(row).text
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="创建时间" />
          <el-table-column label="操作" width="300" fixed="right">
            <template #default="{ row }">
              <el-button size="small" @click="openPermDialog(row)">权限</el-button>
              <el-button size="small" @click="handleEdit(row, 'system')">编辑</el-button>
              <el-button size="small" @click="handleResetPassword(row)">重置密码</el-button>
              <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 比赛用账号：归属于当前选中的比赛，比赛删除时联级删除 -->
      <el-tab-pane label="账号（比赛用）" name="competition">
        <div v-if="!compStore.competitionId" class="no-comp-warning">
          请先在「比赛管理」中选择一个比赛
        </div>
        <template v-else>
          <div class="toolbar">
            <span class="comp-label">所属比赛：{{ competitionName }}</span>
            <el-button type="primary" @click="showCreateDialog('competition')"
              >新建账号（比赛用）</el-button
            >
          </div>
          <el-table :data="competitionUsers" border stripe style="width: 100%; margin-top: 16px">
            <el-table-column prop="username" label="用户名" />
            <el-table-column prop="displayName" label="显示名称" />
            <el-table-column prop="role" label="角色">
              <template #default="{ row }">
                <el-tag :type="roleTag(row.role)">{{ roleLabel(row.role) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="权限" width="110">
              <template #default="{ row }">
                <el-tag :type="permSummary(row).type" size="small">{{
                  permSummary(row).text
                }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="创建时间" />
            <el-table-column label="操作" width="300" fixed="right">
              <template #default="{ row }">
                <el-button size="small" @click="openPermDialog(row)">权限</el-button>
                <el-button size="small" @click="handleEdit(row, 'competition')">编辑</el-button>
                <el-button size="small" @click="handleResetPassword(row)">重置密码</el-button>
                <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </el-tab-pane>
    </el-tabs>

    <!-- 新建 / 编辑账号 -->
    <el-dialog append-to-body v-model="dialogVisible" :title="dialogTitle" width="720px" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="100px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" :disabled="isEdit" />
        </el-form-item>
        <el-form-item v-if="!isEdit" label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password />
          <div class="form-tip">密码至少 8 位，且含字母和数字</div>
        </el-form-item>
        <el-form-item label="显示名称" prop="displayName">
          <el-input v-model="form.displayName" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role">
            <el-option
              label="超级管理员"
              value="SUPER_ADMIN"
              :disabled="createScope === 'competition'"
            />
            <el-option label="管理员" value="COMPETITION_ADMIN" />
            <el-option label="参赛选手" value="PLAYER" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="createScope === 'competition'" label="所属比赛">
          <el-input :model-value="competitionName" disabled />
        </el-form-item>

        <el-divider content-position="left">账号权限</el-divider>
        <div v-if="form.role === 'SUPER_ADMIN'" class="perm-note">
          超级管理员默认拥有全部权限，无需单独配置。
        </div>
        <template v-else>
          <div class="perm-toolbar">
            <el-button size="small" @click="selectAllPerms">全选全部</el-button>
            <el-button size="small" @click="clearAllPerms">清空全部</el-button>
            <span class="perm-count">已选 {{ permBuffer.length }} 项</span>
          </div>
          <div class="perm-editor">
            <div v-for="grp in PERMISSION_GROUPS" :key="grp.group" class="perm-group">
              <div class="perm-group-title">{{ grp.group }}</div>
              <div v-for="domain in grp.domains" :key="domain.key" class="perm-domain">
                <el-checkbox
                  :model-value="isDomainChecked(domain)"
                  :indeterminate="isDomainIndeterminate(domain)"
                  class="perm-domain-check"
                  @change="(v: any) => toggleDomain(domain, !!v)"
                  >{{ domain.label }}</el-checkbox
                >
                <el-checkbox-group v-model="permBuffer" class="perm-actions">
                  <el-checkbox v-for="act in domain.actions" :key="act.key" :label="act.key">{{
                    act.label
                  }}</el-checkbox>
                </el-checkbox-group>
              </div>
            </div>
          </div>
          <el-divider content-position="left">合同审核范围（公司）</el-divider>
          <div class="perm-note" style="margin-bottom: 10px">
            勾选上方「合同 ·
            审核（公司范围）」后，在此选择该账号可审核的合同所属公司；仅这些公司的合同可被其审核。该范围与「可查看的公司字段（范围）」「可查看的合同（范围）」相互独立。
          </div>
          <el-select
            v-model="companyScopeBuffer"
            multiple
            filterable
            placeholder="选择可审核的公司"
            style="width: 100%"
          >
            <el-option v-for="c in companyOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>

          <el-divider content-position="left">可查看的公司字段（范围）</el-divider>
          <div class="perm-note" style="margin-bottom: 10px">
            勾选上方「公司 · 查看（读取产业字段等子资源）」后，在此选择该账号可读取<strong>全量字段</strong>的公司；范围外公司只能读「已发布到区域总览」的公开字段。为空
            = 不限制（全部公司全量可读）。该范围与上方「合同审核范围（公司）」相互独立。
          </div>
          <el-select
            v-model="viewCompanyScopeBuffer"
            multiple
            filterable
            placeholder="选择可查看全量字段的公司"
            style="width: 100%"
          >
            <el-option v-for="c in companyOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>

          <el-divider content-position="left">可查看的合同（范围）</el-divider>
          <div class="perm-note" style="margin-bottom: 10px">
            勾选上方「合同 · 查看」后，在此选择该账号可查看的<strong>合同所涉及的参与方公司</strong>；仅这些公司担任参与方的合同对其可见（任一参与方公司落在范围内即可）。为空
            = 不限制（可见全部合同）。该范围与上方「合同审核范围（公司）」「可查看的公司字段（范围）」相互独立。
          </div>
          <el-select
            v-model="contractViewCompanyScopeBuffer"
            multiple
            filterable
            placeholder="选择可查看合同的参与方公司"
            style="width: 100%"
          >
            <el-option v-for="c in companyOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 单独设置权限 -->
    <el-dialog append-to-body v-model="permOnlyVisible" title="设置账号权限" width="720px">
      <div v-if="permTargetRole === 'SUPER_ADMIN'" class="perm-note">
        该账号为超级管理员，默认拥有全部权限，无需单独配置。
      </div>
      <template v-else>
        <div class="perm-toolbar">
          <el-button size="small" @click="selectAllPerms">全选全部</el-button>
          <el-button size="small" @click="clearAllPerms">清空全部</el-button>
          <span class="perm-count">已选 {{ permBuffer.length }} 项</span>
        </div>
        <div class="perm-editor">
          <div v-for="grp in PERMISSION_GROUPS" :key="grp.group" class="perm-group">
            <div class="perm-group-title">{{ grp.group }}</div>
            <div v-for="domain in grp.domains" :key="domain.key" class="perm-domain">
              <el-checkbox
                :model-value="isDomainChecked(domain)"
                :indeterminate="isDomainIndeterminate(domain)"
                class="perm-domain-check"
                @change="(v: any) => toggleDomain(domain, !!v)"
                >{{ domain.label }}</el-checkbox
              >
              <el-checkbox-group v-model="permBuffer" class="perm-actions">
                <el-checkbox v-for="act in domain.actions" :key="act.key" :label="act.key">{{
                  act.label
                }}</el-checkbox>
              </el-checkbox-group>
            </div>
          </div>
        </div>
        <el-divider content-position="left">合同审核范围（公司）</el-divider>
        <div class="perm-note" style="margin-bottom: 10px">
          勾选上方「合同 ·
          审核（公司范围）」后，在此选择该账号可审核的合同所属公司；仅这些公司的合同可被其审核。为空 = 不限制（可审核全部公司合同）。该范围与「可查看的公司字段（范围）」「可查看的合同（范围）」相互独立。
        </div>
        <el-select
          v-model="companyScopeBuffer"
          multiple
          filterable
          placeholder="选择可审核的公司"
          style="width: 100%"
        >
          <el-option v-for="c in companyOptions" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>

        <el-divider content-position="left">可查看的公司字段（范围）</el-divider>
        <div class="perm-note" style="margin-bottom: 10px">
          勾选上方「公司 · 查看（读取产业字段等子资源）」后，在此选择该账号可读取<strong>全量字段</strong>的公司；范围外公司只能读「已发布到区域总览」的公开字段。为空
          = 不限制（全部公司全量可读）。该范围与上方「合同审核范围（公司）」相互独立。
        </div>
        <el-select
          v-model="viewCompanyScopeBuffer"
          multiple
          filterable
          placeholder="选择可查看全量字段的公司"
          style="width: 100%"
        >
          <el-option v-for="c in companyOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>

          <el-divider content-position="left">可查看的合同（范围）</el-divider>
          <div class="perm-note" style="margin-bottom: 10px">
            勾选上方「合同 · 查看」后，在此选择该账号可查看的<strong>合同所涉及的参与方公司</strong>；仅这些公司担任参与方的合同对其可见（任一参与方公司落在范围内即可）。为空
            = 不限制（可见全部合同）。该范围与上方「合同审核范围（公司）」「可查看的公司字段（范围）」相互独立。
          </div>
          <el-select
            v-model="contractViewCompanyScopeBuffer"
            multiple
            filterable
            placeholder="选择可查看合同的参与方公司"
            style="width: 100%"
          >
            <el-option v-for="c in companyOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
      </template>
      <template #footer>
        <el-button @click="permOnlyVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="savePermDialog">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { usersApi, companiesApi } from "@/api";
import { useCompetitionStore } from "@/stores/competition";
import { PERMISSION_GROUPS, ALL_PERMISSION_KEYS } from "@/permissions/catalog";
import type { FormInstance } from "element-plus";
import { useResourceChanged } from "@/realtime/useResourceChanged";

interface UserItem {
  id: number;
  username: string;
  role: string;
  displayName?: string;
  competitionId?: number | null;
  permissions?: string[];
  companyScopes?: number[];
  viewCompanyScopes?: number[];
  contractViewCompanyScopes?: number[];
  createdAt?: string;
}

interface CompanyOption {
  id: number;
  name: string;
}

type AccountScope = "system" | "competition";

const compStore = useCompetitionStore();
const competitionId = computed(() => compStore.competitionId);
const competitionName = computed(() => compStore.competitionName);

const activeTab = ref<AccountScope>("system");
const systemUsers = ref<UserItem[]>([]);
const competitionUsers = ref<UserItem[]>([]);

const dialogVisible = ref(false);
const isEdit = ref(false);
const editingId = ref<number | null>(null);
const submitting = ref(false);
const formRef = ref<FormInstance>();
const createScope = ref<AccountScope>("system");
const dialogTitle = ref("新建账号");

const form = reactive({ username: "", password: "", displayName: "", role: "PLAYER" });
const formRules = {
  username: [{ required: true, message: "请输入用户名", trigger: "blur" }],
  password: [
    { required: true, message: "请输入密码", trigger: "blur" },
    { min: 8, max: 64, message: "密码长度需 8-64 位", trigger: "blur" },
    { pattern: /^(?=.*[a-zA-Z])(?=.*\d).+$/, message: "密码需同时包含字母和数字", trigger: "blur" },
  ],
};

// 权限编辑器缓冲区（与身份表单共享）
const permBuffer = ref<string[]>([]);
// 公司审核范围缓冲区（contract:audit 生效时，限定可审核合同的公司）
const companyScopeBuffer = ref<number[]>([]);
// 公司可见字段范围缓冲区（company:view 生效时，限定可读取全量字段的公司；与审核范围独立）
const viewCompanyScopeBuffer = ref<number[]>([]);
// 合同查看范围缓冲区（contract:view 生效时，限定可查看「参与方在这些公司」的合同；与前两者独立）
const contractViewCompanyScopeBuffer = ref<number[]>([]);
const companyOptions = ref<CompanyOption[]>([]);
let companiesLoaded = false;

async function loadCompanies() {
  if (companiesLoaded) return;
  try {
    const list = await companiesApi.list();
    companyOptions.value = (list || []).map((c: any) => ({ id: c.id, name: c.name }));
    companiesLoaded = true;
  } catch (e) {
    console.error("加载公司列表失败:", e);
  }
}

const permOnlyVisible = ref(false);
const permTargetId = ref<number | null>(null);
const permTargetRole = ref<string>("");

function roleTag(role: string) {
  const map: Record<string, string> = {
    SUPER_ADMIN: "danger",
    COMPETITION_ADMIN: "warning",
    PLAYER: "info",
  };
  return map[role] || "info";
}

function roleLabel(role: string) {
  const map: Record<string, string> = {
    SUPER_ADMIN: "超级管理员",
    COMPETITION_ADMIN: "管理员",
    PLAYER: "参赛选手",
  };
  return map[role] || role;
}

function permSummary(row: UserItem) {
  if (row.role === "SUPER_ADMIN") return { text: "全部权限", type: "danger" };
  const n = row.permissions?.length || 0;
  if (n === 0) return { text: "只读", type: "info" };
  return { text: `${n} 项`, type: "success" };
}

// ===== 权限编辑器辅助 =====
function isDomainChecked(domain: { actions: { key: string }[] }) {
  return domain.actions.every((a) => permBuffer.value.includes(a.key));
}
function isDomainIndeterminate(domain: { actions: { key: string }[] }) {
  const checked = domain.actions.filter((a) => permBuffer.value.includes(a.key)).length;
  return checked > 0 && checked < domain.actions.length;
}
function toggleDomain(domain: { actions: { key: string }[] }, checked: boolean) {
  const keys = domain.actions.map((a) => a.key);
  const set = new Set(permBuffer.value);
  if (checked) keys.forEach((k) => set.add(k));
  else keys.forEach((k) => set.delete(k));
  permBuffer.value = Array.from(set);
}
function selectAllPerms() {
  permBuffer.value = [...ALL_PERMISSION_KEYS];
}
function clearAllPerms() {
  permBuffer.value = [];
}

async function loadSystemUsers() {
  try {
    const res = await usersApi.list({ competitionId: "null" });
    systemUsers.value = res.items;
  } catch (e) {
    console.error("加载系统账号失败:", e);
  }
}

async function loadCompetitionUsers() {
  if (!competitionId.value) {
    competitionUsers.value = [];
    return;
  }
  try {
    const res = await usersApi.list({ competitionId: competitionId.value });
    competitionUsers.value = res.items;
  } catch (e) {
    console.error("加载比赛账号失败:", e);
  }
}

async function loadAll() {
  await Promise.all([loadSystemUsers(), loadCompetitionUsers()]);
}

function showCreateDialog(scope: AccountScope) {
  createScope.value = scope;
  isEdit.value = false;
  editingId.value = null;
  dialogTitle.value = scope === "competition" ? "新建账号（比赛用）" : "新建账号";
  form.username = "";
  form.password = "";
  form.displayName = "";
  form.role = "PLAYER";
  permBuffer.value = [];
  companyScopeBuffer.value = [];
  viewCompanyScopeBuffer.value = [];
  contractViewCompanyScopeBuffer.value = [];
  loadCompanies();
  dialogVisible.value = true;
}

function handleEdit(row: UserItem, scope: AccountScope) {
  createScope.value = scope;
  isEdit.value = true;
  editingId.value = row.id;
  dialogTitle.value = "编辑账号";
  form.username = row.username;
  form.displayName = row.displayName || "";
  form.role = row.role;
  form.password = "";
  permBuffer.value = [...(row.permissions || [])];
  companyScopeBuffer.value = [...(row.companyScopes || [])];
  viewCompanyScopeBuffer.value = [...(row.viewCompanyScopes || [])];
  contractViewCompanyScopeBuffer.value = [...(row.contractViewCompanyScopes || [])];
  loadCompanies();
  dialogVisible.value = true;
}

function openPermDialog(row: UserItem) {
  permTargetId.value = row.id;
  permTargetRole.value = row.role;
  permBuffer.value = [...(row.permissions || [])];
  companyScopeBuffer.value = [...(row.companyScopes || [])];
  viewCompanyScopeBuffer.value = [...(row.viewCompanyScopes || [])];
  contractViewCompanyScopeBuffer.value = [...(row.contractViewCompanyScopes || [])];
  loadCompanies();
  permOnlyVisible.value = true;
}

async function savePermDialog() {
  if (permTargetId.value == null) return;
  submitting.value = true;
  try {
    const payload = {
      permissions: permTargetRole.value === "SUPER_ADMIN" ? [] : permBuffer.value,
      companyScopes: permTargetRole.value === "SUPER_ADMIN" ? [] : companyScopeBuffer.value,
      viewCompanyScopes: permTargetRole.value === "SUPER_ADMIN" ? [] : viewCompanyScopeBuffer.value,
      contractViewCompanyScopes:
        permTargetRole.value === "SUPER_ADMIN" ? [] : contractViewCompanyScopeBuffer.value,
    };
    await usersApi.update(permTargetId.value, payload);
    ElMessage.success("权限已保存");
    permOnlyVisible.value = false;
    loadAll();
  } catch {
    ElMessage.error("保存失败，请重试");
  } finally {
    submitting.value = false;
  }
}

function handleResetPassword(row: UserItem) {
  ElMessageBox.prompt("请输入新密码（至少 8 位，含字母和数字）", "重置密码", {
    confirmButtonText: "确定",
    inputType: "password",
    inputValidator: (val: string) =>
      val && /^(?=.*[a-zA-Z])(?=.*\d).{8,64}$/.test(val) ? true : "密码需 8-64 位且含字母和数字",
  })
    .then(async ({ value }) => {
      await usersApi.updatePassword(row.id, { password: value });
      ElMessage.success("密码已重置");
    })
    .catch(() => {});
}

function handleDelete(row: UserItem) {
  ElMessageBox.confirm(`确定删除用户 "${row.username}" 吗？`, "确认删除", { type: "warning" })
    .then(async () => {
      await usersApi.remove(row.id);
      ElMessage.success("已删除");
      loadAll();
    })
    .catch(() => {});
}

async function handleSubmit() {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    submitting.value = true;
    try {
      const permissions = form.role === "SUPER_ADMIN" ? [] : permBuffer.value;
      const companyScopes = form.role === "SUPER_ADMIN" ? [] : companyScopeBuffer.value;
      const viewCompanyScopes = form.role === "SUPER_ADMIN" ? [] : viewCompanyScopeBuffer.value;
      const contractViewCompanyScopes =
        form.role === "SUPER_ADMIN" ? [] : contractViewCompanyScopeBuffer.value;
      if (isEdit.value && editingId.value) {
        await usersApi.update(editingId.value, {
          role: form.role,
          displayName: form.displayName,
          permissions,
          companyScopes,
          viewCompanyScopes,
          contractViewCompanyScopes,
        });
      } else {
        const payload: Record<string, unknown> = {
          username: form.username,
          password: form.password,
          displayName: form.displayName,
          role: form.role,
          permissions,
          companyScopes,
          viewCompanyScopes,
          contractViewCompanyScopes,
          competitionId:
            createScope.value === "competition" && competitionId.value
              ? competitionId.value
              : undefined,
        };
        await usersApi.create(payload);
      }
      ElMessage.success(isEdit.value ? "已更新" : "已创建");
      dialogVisible.value = false;
      loadAll();
    } catch {
      ElMessage.error("操作失败，请重试");
    } finally {
      submitting.value = false;
    }
  });
}

function resetForm() {
  formRef.value?.resetFields();
}

// 切换比赛时刷新“比赛用账号”列表
watch(competitionId, () => {
  loadCompetitionUsers();
});

onMounted(loadAll);

useResourceChanged("users", () => {
  loadAll();
});
</script>

<style scoped>
.page-title {
  font-size: 20px;
  font-weight: 500;
  color: #1f1f1f;
  margin: 0 0 16px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.comp-label {
  font-size: 14px;
  color: #606266;
}
.no-comp-warning {
  text-align: center;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--color-warning-soft);
  border: 1px solid rgba(var(--color-warning-soft-rgb), 0.3);
  border-radius: 6px;
  color: #b45309;
  font-size: 13px;
}
.form-tip {
  font-size: 12px;
  line-height: 1.4;
  color: #909399;
  margin-top: 4px;
}
.perm-note {
  padding: 10px 14px;
  background: #f4f4f5;
  border-radius: 6px;
  color: #909399;
  font-size: 13px;
}
.perm-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.perm-count {
  font-size: 13px;
  color: #606266;
}
.perm-editor {
  max-height: 420px;
  overflow-y: auto;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 8px 12px;
}
.perm-group {
  padding: 6px 0;
}
.perm-group-title {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  background: #f5f7fa;
  padding: 4px 8px;
  border-radius: 4px;
  margin-bottom: 6px;
}
.perm-domain {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 4px 0;
  border-bottom: 1px dashed #f0f0f0;
}
.perm-domain-check {
  width: 120px;
  flex-shrink: 0;
  margin-top: 2px;
}
.perm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}
</style>
