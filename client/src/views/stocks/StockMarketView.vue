<template>
  <div class="stock-market">
    <h2 class="page-title">股票行情</h2>
    <div class="toolbar">
      <el-tag type="info" effect="plain">轮次：{{ maxRound }}</el-tag>
      <el-button :icon="Refresh" @click="reloadAll">刷新</el-button>
    </div>

    <div class="market-body">
      <!-- 左：股票列表 + K线 -->
      <div class="market-main">
        <el-card shadow="never" class="block-card">
          <template #header>
            <span class="card-title">股票列表</span>
          </template>
          <div v-loading="loadingStocks" class="stock-grid">
            <div
              v-for="s in stocks"
              :key="s.id"
              class="stock-card"
              :class="{ active: s.id === selectedStockId }"
              @click="selectStock(s.id)"
            >
              <div class="stock-main">
                <div class="stock-name">{{ s.name }}</div>
                <div class="stock-code">{{ s.code }}</div>
              </div>
              <div class="stock-change" :class="changeClass(s.changePct)">
                <div class="chg-pct">{{ s.changePct > 0 ? "+" : "" }}{{ fmt(s.changePct) }}%</div>
                <div class="chg-price">{{ s.changePrice > 0 ? "+" : "" }}{{ fmt(s.changePrice) }}</div>
              </div>
            </div>
            <div v-if="!loadingStocks && stocks.length === 0" class="empty-hint">暂无股票</div>
          </div>
        </el-card>

        <el-card shadow="never" class="block-card chart-card">
          <template #header>
            <span v-if="selectedStock" class="card-title">
              K 线图 · {{ selectedStock.name }}
              <span class="muted">（{{ selectedStock.code }}）</span>
            </span>
          </template>
          <div v-if="selectedStock" ref="chartRef" class="kline-chart" v-loading="loadingCandles"></div>
          <div v-else class="chart-empty">
            <el-icon :size="40" class="chart-empty-icon"><TrendCharts /></el-icon>
            <p class="chart-empty-text">{{ emptyChartText }}</p>
          </div>
        </el-card>
      </div>

      <!-- 右：选购 / 买卖面板 -->
      <div class="market-side">
        <el-card shadow="never" class="block-card">
          <template #header><span class="card-title">交易面板</span></template>
          <el-form label-position="top" size="small">
            <el-form-item label="资金账户">
              <el-select
                v-model="selectedAccountId"
                placeholder="选择资金账户"
                style="width: 100%"
                @change="onAccountChange"
              >
                <el-option
                  v-for="a in accounts"
                  :key="a.id"
                  :label="`${a.name}（${a.ownerType === 'USER' ? '个人' : '公司'}）`"
                  :value="a.id"
                />
              </el-select>
            </el-form-item>
            <div v-if="currentAccount" class="cash-line">
              现金余额：<b>{{ fmt(currentAccount.cashBalance) }}</b> 元
            </div>

            <el-form-item label="方向">
              <el-radio-group v-model="trade.side">
                <el-radio-button value="BUY">买入</el-radio-button>
                <el-radio-button value="SELL">卖出</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <el-form-item label="委托价（元/股）">
              <el-input-number
                v-model="trade.price"
                :min="0.01"
                :step="0.01"
                :precision="2"
                style="width: 100%"
              />
            </el-form-item>

            <el-form-item label="数量（股）">
              <el-input-number
                v-model="trade.quantity"
                :min="1"
                :step="100"
                :precision="0"
                style="width: 100%"
              />
            </el-form-item>

            <div class="est-line">
              预计金额：<b>{{ fmt(estAmount) }}</b> 元
              <span v-if="trade.side === 'SELL' && myHoldingShares > 0" class="muted">
                （可卖 {{ fmt(myHoldingShares) }} 股）
              </span>
            </div>

            <el-button
              type="primary"
              style="width: 100%"
              :disabled="!canTrade"
              @click="submitOrder"
            >
              {{ trade.side === "BUY" ? "买入" : "卖出" }}
            </el-button>
          </el-form>

          <el-divider>我的持仓</el-divider>
          <el-table :data="holdings" size="small" v-if="holdings.length">
            <el-table-column prop="stock.code" label="代码" width="90" />
            <el-table-column label="持股" align="right">
              <template #default="{ row }">{{ fmt(row.shares) }}</template>
            </el-table-column>
            <el-table-column label="市值" align="right">
              <template #default="{ row }">{{ fmt(row.marketValue) }}</template>
            </el-table-column>
          </el-table>
          <div v-else class="empty-hint small">暂无持仓</div>

          <el-divider>我的订单</el-divider>
          <el-table :data="orders" size="small" v-if="orders.length" max-height="200">
            <el-table-column label="代码" width="80">
              <template #default="{ row }">{{ row.stock?.code }}</template>
            </el-table-column>
            <el-table-column label="方向" width="56">
              <template #default="{ row }">
                <span :class="row.side === 'BUY' ? 'up' : 'down'">{{ row.side === 'BUY' ? '买' : '卖' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="价/量" min-width="90">
              <template #default="{ row }">{{ fmt(row.price) }} ×{{ fmt(row.quantity) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="64">
              <template #default="{ row }">
                <el-tag size="small" :type="row.status === 'PENDING' ? 'warning' : row.status === 'FILLED' ? 'success' : 'info'">
                  {{ statusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="" width="40">
              <template #default="{ row }">
                <el-button
                  v-if="row.status === 'PENDING'"
                  size="small"
                  text
                  type="danger"
                  @click="cancelOrder(row.id)"
                  >撤</el-button
                >
              </template>
            </el-table-column>
          </el-table>
          <div v-else class="empty-hint small">暂无订单</div>
        </el-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from "vue";
import * as echarts from "echarts";
import { Refresh, TrendCharts } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { stockApi } from "@/api";
import { useCompetitionStore } from "@/stores/competition";
import { useAuthStore } from "@/stores/auth";

const compStore = useCompetitionStore();
const authStore = useAuthStore();

interface Stock {
  id: number;
  code: string;
  name: string;
  currentPrice: number;
  initPrice: number;
  round: number;
  industryPE: number;
  happiness: number;
  changePct: number;
  changePrice: number;
}
interface Candle {
  round: number;
  open: number;
  high: number;
  low: number;
  close: number;
  changePct: number;
}
interface Account {
  id: number;
  name: string;
  ownerType: string;
  cashBalance: number;
}
interface Holding {
  stock: { id: number; code: string; name: string };
  shares: number;
  costPrice: number;
  marketValue: number;
}
interface Order {
  id: number;
  stock?: { code: string };
  side: string;
  price: number;
  quantity: number;
  status: string;
}

const stocks = ref<Stock[]>([]);
const selectedStockId = ref<number | null>(null);
const selectedStock = computed(() => stocks.value.find((s) => s.id === selectedStockId.value) || null);
const emptyChartText = computed(() =>
  stocks.value.length ? "请选择左侧股票查看 K 线" : "当前比赛暂无股票，请先在「股票管理」中创建",
);
const candles = ref<Candle[]>([]);
const accounts = ref<Account[]>([]);
const selectedAccountId = ref<number | null>(null);
const currentAccount = computed(() => accounts.value.find((a) => a.id === selectedAccountId.value) || null);
const holdings = ref<Holding[]>([]);
const orders = ref<Order[]>([]);

const loadingStocks = ref(false);
const loadingCandles = ref(false);

const trade = ref({ side: "BUY", price: 0, quantity: 100 });
const maxRound = computed(() => stocks.value.reduce((m, s) => Math.max(m, s.round), 0));

const myHoldingShares = computed(() => {
  if (!selectedStockId.value) return 0;
  const h = holdings.value.find((x) => x.stock && x.stock.id === selectedStockId.value);
  return h ? h.shares : 0;
});
const estAmount = computed(() => Math.round(trade.value.price * trade.value.quantity * 100) / 100);
const canTrade = computed(() => !!selectedAccountId.value && !!selectedStockId.value && trade.value.price > 0 && trade.value.quantity > 0);

const chartRef = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

function fmt(n: number): string {
  if (n == null || isNaN(n)) return "—";
  return Number(n).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
function changeClass(v: number): string {
  if (v > 0) return "up";
  if (v < 0) return "down";
  return "";
}
function statusLabel(s: string): string {
  return s === "PENDING" ? "挂单" : s === "FILLED" ? "已成" : "已撤";
}

async function reloadStocks() {
  if (!compStore.competitionId) return;
  loadingStocks.value = true;
  try {
    const res = await stockApi.list(1, 200, compStore.competitionId);
    stocks.value = (res.items || res || []).map((s: any) => ({ ...s, changePct: 0, changePrice: 0 }) as Stock);
    // 计算每只股票最近一轮涨跌幅与涨跌额（取最后一根 K 线的 close-open）
    await Promise.all(
      stocks.value.map(async (s) => {
        try {
          const c = await stockApi.candles(s.id);
          const last = c.candles.length ? c.candles[c.candles.length - 1] : null;
          if (last) {
            s.changePct = last.changePct;
            s.changePrice = Math.round((last.close - last.open) * 100) / 100;
          }
        } catch {
          s.changePct = 0;
          s.changePrice = 0;
        }
      }),
    );
    const current = stocks.value.find((s) => s.id === selectedStockId.value);
    if (!current && stocks.value.length) selectStock(stocks.value[0].id);
  } finally {
    loadingStocks.value = false;
  }
}

async function reloadAccounts() {
  if (!compStore.competitionId) return;
  accounts.value = await stockApi.listAccounts(compStore.competitionId);
  if (!selectedAccountId.value && accounts.value.length) {
    selectedAccountId.value = accounts.value[0].id;
    await reloadAccountData();
  }
}

async function reloadAccountData() {
  if (!selectedAccountId.value) {
    holdings.value = [];
    orders.value = [];
    return;
  }
  holdings.value = await stockApi.accountHoldings(selectedAccountId.value);
  orders.value = await stockApi.listOrders(compStore.competitionId!, selectedStockId.value || undefined);
}

async function loadCandles(id: number) {
  loadingCandles.value = true;
  try {
    const res = await stockApi.candles(id);
    candles.value = res.candles || [];
    await nextTick();
    renderChart();
  } finally {
    loadingCandles.value = false;
  }
}

function selectStock(id: number) {
  selectedStockId.value = id;
  const s = stocks.value.find((x) => x.id === id);
  if (s) trade.value.price = s.currentPrice;
  loadCandles(id);
  reloadAccountData();
}
async function onAccountChange() {
  await reloadAccountData();
}

function renderChart() {
  if (!chartRef.value) return;
  if (!chart) chart = echarts.init(chartRef.value);
  const data = candles.value.map((c) => [c.open, c.close, c.low, c.high]);
  const vol = candles.value.map((c) => c.close);
  chart.setOption({
    backgroundColor: "transparent",
    grid: [{ left: 50, right: 16, top: 16, height: "70%" }, { left: 50, right: 16, top: "78%", height: "14%" }],
    xAxis: [
      { type: "category", data: candles.value.map((c) => `R${c.round}`), axisLine: { lineStyle: { color: "#c0c4cc" } } },
      { type: "category", gridIndex: 1, data: candles.value.map((c) => `R${c.round}`), axisLine: { show: false } },
    ],
    yAxis: [
      { scale: true, splitLine: { lineStyle: { color: "#f0f0f0" } } },
      { gridIndex: 1, scale: true, axisLabel: { show: false }, splitLine: { show: false } },
    ],
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
    series: [
      {
        type: "candlestick",
        data,
        itemStyle: {
          color: "#ec0000",
          color0: "#00a800",
          borderColor: "#ec0000",
          borderColor0: "#00a800",
        },
      },
      { type: "line", gridIndex: 1, data: vol, showSymbol: false, lineStyle: { color: "#8a8f99" }, areaStyle: { color: "#eef1f6" } },
    ],
  });
  chart.resize();
}

async function submitOrder() {
  if (!canTrade.value || !selectedStockId.value || !selectedAccountId.value) return;
  try {
    await stockApi.placeOrder({
      stockId: selectedStockId.value,
      fundsAccountId: selectedAccountId.value,
      side: trade.value.side,
      price: trade.value.price,
      quantity: trade.value.quantity,
    });
    ElMessage.success("委托已提交，将在下一轮撮合");
    await reloadAccountData();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || "下单失败");
  }
}
async function cancelOrder(id: number) {
  try {
    await stockApi.cancelOrder(id);
    await reloadAccountData();
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || "撤单失败");
  }
}

async function reloadAll() {
  await Promise.all([reloadStocks(), reloadAccounts()]);
}

function onResize() {
  chart?.resize();
}

watch(selectedStock, (val) => {
  if (!val) {
    chart?.dispose();
    chart = null;
  }
});

onMounted(async () => {
  window.addEventListener("resize", onResize);
  await reloadAll();
});
onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  chart?.dispose();
  chart = null;
});
</script>

<style scoped>
.stock-market {
  width: 100%;
}
.toolbar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.market-body {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 16px;
  align-items: start;
}
.market-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.stock-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.stock-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--color-border, #ebeef5);
  border-radius: var(--radius-sm, 10px);
  background: var(--color-surface, #fff);
  cursor: pointer;
  transition: border-color var(--dur-base) var(--ease-standard),
    box-shadow var(--dur-base) var(--ease-standard);
}
.stock-card:hover {
  border-color: var(--color-primary, #409eff);
}
.stock-card.active {
  border-color: var(--color-primary, #409eff);
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.15);
}
.stock-main {
  min-width: 0;
}
.stock-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stock-code {
  font-size: 12px;
  color: var(--color-text-tertiary, #92969e);
  margin-top: 2px;
}
.stock-change {
  text-align: right;
  flex-shrink: 0;
}
.chg-pct {
  font-size: 15px;
  font-weight: 600;
}
.chg-price {
  font-size: 12px;
  margin-top: 2px;
}
.block-card {
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border, #ebeef5);
}
.card-title {
  font-weight: 600;
  font-size: 14px;
}
.chart-card {
  position: relative;
}
.kline-chart {
  height: 360px;
  width: 100%;
}
.chart-empty {
  height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-tertiary, #92969e);
}
.chart-empty-icon {
  opacity: 0.45;
}
.chart-empty-text {
  margin: 0;
  font-size: 14px;
}
.market-side {
  position: sticky;
  top: 0;
}
.cash-line,
.est-line {
  font-size: 13px;
  margin-bottom: 10px;
  color: var(--color-text-secondary, #5a5f6a);
}
.est-line b {
  color: var(--color-primary, #409eff);
}
.muted {
  color: var(--color-text-tertiary, #92969e);
  font-size: 12px;
}
.up {
  color: #ec0000;
  font-weight: 600;
}
.down {
  color: #00a800;
  font-weight: 600;
}
.empty-hint {
  color: var(--color-text-tertiary, #92969e);
  text-align: center;
  padding: 24px 0;
}
.empty-hint.small {
  padding: 12px 0;
  font-size: 13px;
}
</style>
