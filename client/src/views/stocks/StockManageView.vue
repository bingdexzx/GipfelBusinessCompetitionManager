<template>
  <div class="stock-manage">
    <div class="manage-head">
      <div>
        <h2 class="page-title">股票管理</h2>
        <p class="page-sub">
          高级管理可增删股票并推进轮次；低级管理仅能管理「权限范围内公司 + 自己」的资金账户。
        </p>
      </div>
      <el-button :icon="Refresh" @click="reloadAll">刷新</el-button>
    </div>

    <!-- 股票管理（仅高级管理） -->
    <el-card v-if="canManage" shadow="never" class="block-card">
      <template #header>
        <div class="card-head">
          <span class="card-title">股票（{{ stocks.length }}）</span>
          <div class="card-actions">
            <el-button type="primary" :icon="Plus" @click="openStockDialog()">新增股票</el-button>
            <el-button type="warning" :icon="VideoPlay" @click="advanceRound">推进一轮</el-button>
          </div>
        </div>
      </template>
      <el-table :data="stocks" size="small" v-loading="loadingStocks">
        <el-table-column prop="code" label="代码" width="90" />
        <el-table-column prop="name" label="名称" min-width="120" show-overflow-tooltip />
        <el-table-column label="当前价" width="90" align="right">
          <template #default="{ row }">{{ fmt(row.currentPrice) }}</template>
        </el-table-column>
        <el-table-column label="初始价" width="90" align="right">
          <template #default="{ row }">{{ fmt(row.initPrice) }}</template>
        </el-table-column>
        <el-table-column prop="round" label="轮次" width="64" align="center" />
        <el-table-column prop="totalShares" label="总股本(万)" width="90" align="right" />
        <el-table-column prop="industryPE" label="行业PE" width="72" align="right" />
        <el-table-column prop="happiness" label="幸福度" width="72" align="right" />
        <el-table-column prop="currentCarbon" label="碳排" width="72" align="right" />
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text @click="openStockDialog(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="removeStock(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 资金账户管理（低级 / 高级） -->
    <el-card v-if="canEdit" shadow="never" class="block-card">
      <template #header>
        <div class="card-head">
          <span class="card-title">资金账户（{{ accounts.length }}）</span>
          <el-button type="primary" :icon="Plus" @click="openAccountDialog()">新增账户</el-button>
        </div>
      </template>
      <el-table :data="accounts" size="small" v-loading="loadingAccounts">
        <el-table-column prop="name" label="账户名" min-width="120" />
        <el-table-column label="类型" width="80">
          <template #default="{ row }">{{ row.ownerType === "USER" ? "个人" : "公司" }}</template>
        </el-table-column>
        <el-table-column label="归属" min-width="120">
          <template #default="{ row }">
            <span v-if="row.ownerType === 'USER'">{{ row.userId === authStore.user?.id ? "我自己" : "用户#" + row.userId }}</span>
            <span v-else>{{ companyName(row.companyId) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="现金(元)" width="120" align="right">
          <template #default="{ row }">{{ fmt(row.cashBalance) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text @click="openAccountDialog(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="removeAccount(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 股票编辑对话框 -->
    <el-dialog v-model="stockDialogVisible" :title="stockForm.id ? '编辑股票' : '新增股票'" width="560px">
      <el-form :model="stockForm" label-width="110px" size="small">
        <el-form-item label="股票代码" required>
          <el-input v-model="stockForm.code" :disabled="!!stockForm.id" placeholder="如 600001" />
        </el-form-item>
        <el-form-item label="公司名称" required>
          <el-input v-model="stockForm.name" />
        </el-form-item>
        <el-form-item label="总股本(万股)" required>
          <el-input-number v-model="stockForm.totalShares" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="初始净利润(万)" required>
          <el-input-number v-model="stockForm.initNetProfit" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="行业PE" required>
          <el-input-number v-model="stockForm.industryPE" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="当前碳排" required>
          <el-input-number v-model="stockForm.currentCarbon" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="行业碳排均值" required>
          <el-input-number v-model="stockForm.industryAvgCarbon" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="当前幸福度" required>
          <el-input-number v-model="stockForm.happiness" :min="0" :max="100" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="关联公司">
          <el-select v-model="stockForm.companyId" placeholder="可选" clearable style="width: 100%">
            <el-option v-for="c in companies" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-alert
          v-if="!stockForm.id && previewInitPrice > 0"
          type="info"
          :closable="false"
          :title="`初始价将自动计算为 ${fmt(previewInitPrice)} 元/股`"
        />
      </el-form>
      <template #footer>
        <el-button @click="stockDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveStock">保存</el-button>
      </template>
    </el-dialog>

    <!-- 资金账户编辑对话框 -->
    <el-dialog v-model="accountDialogVisible" :title="accountForm.id ? '编辑账户' : '新增资金账户'" width="520px">
      <el-form :model="accountForm" label-width="100px" size="small">
        <el-form-item label="账户名" required>
          <el-input v-model="accountForm.name" :disabled="!!accountForm.id" />
        </el-form-item>
        <el-form-item label="账户类型" required>
          <el-radio-group v-model="accountForm.ownerType" :disabled="!!accountForm.id">
            <el-radio-button value="USER">个人</el-radio-button>
            <el-radio-button value="COMPANY">公司</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="accountForm.ownerType === 'COMPANY'" label="归属公司" required>
          <el-select v-model="accountForm.companyId" placeholder="选择公司" style="width: 100%">
            <el-option v-for="c in scopedCompanies" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="accountForm.ownerType === 'USER'" label="归属用户">
          <span class="muted">{{ authStore.user?.displayName || authStore.user?.username || "我自己" }}</span>
        </el-form-item>
        <el-form-item label="初始现金(元)">
          <el-input-number v-model="accountForm.cashBalance" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="accountDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveAccount">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { Plus, Refresh, VideoPlay } from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { stockApi, companiesApi } from "@/api";
import { useCompetitionStore } from "@/stores/competition";
import { useAuthStore } from "@/stores/auth";

const compStore = useCompetitionStore();
const authStore = useAuthStore();
const canManage = computed(() => authStore.can("stock:manage"));
const canEdit = computed(() => authStore.canAny(["stock:edit", "stock:manage"]));

interface Stock {
  id: number;
  code: string;
  name: string;
  currentPrice: number;
  initPrice: number;
  round: number;
  totalShares: number;
  industryPE: number;
  happiness: number;
  currentCarbon: number;
}
interface Account {
  id: number;
  name: string;
  ownerType: string;
  companyId: number | null;
  userId: number | null;
  cashBalance: number;
}
interface Company {
  id: number;
  name: string;
}

const stocks = ref<Stock[]>([]);
const accounts = ref<Account[]>([]);
const companies = ref<Company[]>([]);
const loadingStocks = ref(false);
const loadingAccounts = ref(false);

const stockDialogVisible = ref(false);
const stockForm = ref<any>({ code: "", name: "", totalShares: 0, initNetProfit: 0, industryPE: 0, currentCarbon: 0, industryAvgCarbon: 0, happiness: 50, companyId: null, id: null });
const previewInitPrice = computed(() => {
  const { initNetProfit, totalShares, industryPE } = stockForm.value;
  if (!totalShares || !industryPE) return 0;
  return Math.round((initNetProfit * 10000) / totalShares / industryPE * 100) / 100;
});

const accountDialogVisible = ref(false);
const accountForm = ref<any>({ id: null, name: "", ownerType: "USER", companyId: null, userId: null, cashBalance: 1000000 });

const scopedCompanies = computed(() => {
  if (canManage.value) return companies.value;
  const scopes = authStore.user?.stockCompanyScopes || [];
  return companies.value.filter((c) => scopes.includes(c.id));
});

function fmt(n: number): string {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
function companyName(id: number | null): string {
  if (id == null) return "—";
  return companies.value.find((c) => c.id === id)?.name || `公司#${id}`;
}

async function reloadStocks() {
  if (!compStore.competitionId) return;
  loadingStocks.value = true;
  try {
    const res = await stockApi.list(1, 200, compStore.competitionId);
    stocks.value = res.items || res || [];
  } finally {
    loadingStocks.value = false;
  }
}
async function reloadAccounts() {
  if (!compStore.competitionId) return;
  loadingAccounts.value = true;
  try {
    accounts.value = await stockApi.listAccounts(compStore.competitionId);
  } finally {
    loadingAccounts.value = false;
  }
}
async function reloadCompanies() {
  if (!compStore.competitionId) return;
  const res = await companiesApi.list({ competitionId: compStore.competitionId });
  companies.value = res.items || res || [];
}
async function reloadAll() {
  await Promise.all([reloadStocks(), reloadAccounts(), reloadCompanies()]);
}

function openStockDialog(row?: any) {
  stockForm.value = row
    ? { ...row }
    : { code: "", name: "", totalShares: 0, initNetProfit: 0, industryPE: 0, currentCarbon: 0, industryAvgCarbon: 0, happiness: 50, companyId: null, id: null };
  stockDialogVisible.value = true;
}
async function saveStock() {
  const f = stockForm.value;
  if (!f.code || !f.name) return ElMessage.warning("请填写代码与公司名称");
  const payload = {
    code: f.code,
    name: f.name,
    totalShares: f.totalShares,
    initNetProfit: f.initNetProfit,
    industryPE: f.industryPE,
    currentCarbon: f.currentCarbon,
    industryAvgCarbon: f.industryAvgCarbon,
    happiness: f.happiness,
    companyId: f.companyId || null,
  };
  try {
    if (f.id) await stockApi.update(f.id, payload);
    else await stockApi.create(payload);
    ElMessage.success("已保存");
    stockDialogVisible.value = false;
    await reloadStocks();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || "保存失败");
  }
}
async function removeStock(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除股票「${row.name}」？若有挂单或持仓将拒绝。`, "删除确认", { type: "warning" });
  } catch {
    return;
  }
  try {
    await stockApi.remove(row.id, compStore.competitionId);
    ElMessage.success("已删除");
    await reloadStocks();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || "删除失败");
  }
}

function openAccountDialog(row?: any) {
  accountForm.value = row
    ? { ...row, cashBalance: row.cashBalance }
    : { id: null, name: "", ownerType: "USER", companyId: null, userId: null, cashBalance: 1000000 };
  accountDialogVisible.value = true;
}
async function saveAccount() {
  const f = accountForm.value;
  if (!f.name) return ElMessage.warning("请填写账户名");
  try {
    if (f.id) {
      await stockApi.updateAccount(f.id, { name: f.name, cashBalance: f.cashBalance });
    } else {
      const payload: any = { name: f.name, ownerType: f.ownerType, cashBalance: f.cashBalance };
      if (f.ownerType === "COMPANY") {
        if (!f.companyId) return ElMessage.warning("请选择归属公司");
        payload.companyId = f.companyId;
      } else {
        payload.userId = authStore.user?.id;
      }
      await stockApi.createAccount(payload);
    }
    ElMessage.success("已保存");
    accountDialogVisible.value = false;
    await reloadAccounts();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || "保存失败");
  }
}
async function removeAccount(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除账户「${row.name}」？若有持仓/挂单将拒绝。`, "删除确认", { type: "warning" });
  } catch {
    return;
  }
  try {
    await stockApi.removeAccount(row.id);
    ElMessage.success("已删除");
    await reloadAccounts();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || "删除失败");
  }
}

async function advanceRound() {
  try {
    await ElMessageBox.confirm("将汇总本轮所有挂单并撮合，生成新价与 K 线。确认推进？", "推进一轮", { type: "warning" });
  } catch {
    return;
  }
  try {
    const res = await stockApi.advanceRound(compStore.competitionId!);
    ElMessage.success(`已推进，处理 ${res.advanced} 只股票`);
    await reloadStocks();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || "推进失败");
  }
}

onMounted(reloadAll);
</script>

<style scoped>
.stock-manage {
  padding: 18px 22px 28px;
}
.manage-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 14px;
}
.page-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
}
.page-sub {
  color: var(--color-text-tertiary, #92969e);
  font-size: 13px;
  margin: 4px 0 0;
  max-width: 760px;
}
.block-card {
  margin-bottom: 16px;
  border-radius: var(--radius-sm, 10px);
  border: 1px solid var(--color-border, #ebeef5);
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-title {
  font-weight: 600;
  font-size: 14px;
}
.card-actions {
  display: flex;
  gap: 8px;
}
.muted {
  color: var(--color-text-tertiary, #92969e);
}
</style>
