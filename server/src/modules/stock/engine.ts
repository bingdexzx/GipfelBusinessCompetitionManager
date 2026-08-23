/**
 * 股票撮合 / 定价引擎（纯函数，便于单测与复用）。
 * 逻辑严格对齐用户提供的 Excel「模拟股票系统.xlsx」：
 *  - 撮合结果：最高买价=MAX(买入价)，最低卖价=MIN(卖出价)，成交价=(最高买+最低卖)/2，
 *    是否成交=最高买>=最低卖。
 *  - 定价（新公式，消除一字板）：净买压力 pressure=(买量-卖量)/(买量+卖量+1)∈(-1,1)；
 *    趋势偏置 drift=happinessImpact*(幸福度-50)/50 + carbonImpact*clamp((均值-碳排)/均值,-1,1)；
 *    理论价=上轮收盘×(1+pressure*maxMovePct+drift*maxMovePct)；
 *    成交价参与定价 final=限幅(tradePriceWeight*tradePrice+(1-weight)*理论价, 上轮×(1±limitPct))；
 *    未成交(单边无对手盘)→平盘，价格不动（S5/S6）。
 *  - K线：开盘=上轮收盘；收盘=最终价；盘高/盘低在实体(开盘/收盘)与理论价之外
 *    叠加确定性盘中波动（上下影线，限幅在 ±10% 内）；涨跌幅=(收盘-开盘)/开盘×100。
 */

export interface RawOrder {
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
}

export interface MatchResult {
  highestBuy: number; // 最高买价
  lowestSell: number; // 最低卖价
  totalBuyQty: number; // 总买单数量（股）
  totalSellQty: number; // 总卖单数量（股）
  totalBuyAmount: number; // 买盘总额（元）
  totalSellAmount: number; // 卖盘总额（元）
  matched: boolean; // 是否成交（最高买>=最低卖）
  tradePrice: number | null; // 成交价=(最高买+最低卖)/2；不成交为 null
}

export function computeMatch(orders: RawOrder[]): MatchResult {
  const buys = orders.filter((o) => o.side === "BUY");
  const sells = orders.filter((o) => o.side === "SELL");

  const highestBuy = buys.length ? Math.max(...buys.map((o) => o.price)) : 0;
  const lowestSell = sells.length ? Math.min(...sells.map((o) => o.price)) : Infinity;

  const totalBuyQty = buys.reduce((s, o) => s + o.quantity, 0);
  const totalSellQty = sells.reduce((s, o) => s + o.quantity, 0);
  const totalBuyAmount = buys.reduce((s, o) => s + o.price * o.quantity, 0);
  const totalSellAmount = sells.reduce((s, o) => s + o.price * o.quantity, 0);

  const matched = buys.length > 0 && sells.length > 0 && highestBuy >= lowestSell;
  const tradePrice = matched ? (highestBuy + lowestSell) / 2 : null;

  return { highestBuy, lowestSell, totalBuyQty, totalSellQty, totalBuyAmount, totalSellAmount, matched, tradePrice };
}

/**
 * 股票引擎全局配置（比赛级 stockConfig 的默认值，S8）。
 * 全部魔法数字可配置；字段缺失时回退到 DEFAULT_STOCK_CONFIG。
 */
export interface StockConfig {
  limitPct: number; // 涨跌停硬限幅（±比例），默认 0.10
  maxMovePct: number; // 单轮价格相对买卖压力的最大移动，默认 0.05
  happinessImpact: number; // 幸福度趋势偏置强度，默认 0.2
  carbonImpact: number; // 碳排趋势偏置强度，默认 0.2
  mmDepthPct: number; // 做市商单档深度占总股本比例，默认 0.001
  mmMinQty: number; // 单档深度下限（股），默认 1000
  mmMaxQty: number; // 单档深度上限（股），默认 100000
  mmSpreadPct: number; // 做市商基准点差（比例），默认 0.02
  interventionMode: "regression" | "expand-limit"; // 连续封板干预模式，默认 regression
  regressionPct: number; // 回归锚干预价格偏移，默认 0.02
  tradePriceWeight: number; // 最终价中成交价的权重，默认 0.7
  carbonSaturateRatio: number; // 碳排对数压缩锚点 R：c(R 倍均值)=-1，默认 2
}

export const DEFAULT_STOCK_CONFIG: StockConfig = {
  limitPct: 0.1,
  maxMovePct: 0.05,
  happinessImpact: 0.2,
  carbonImpact: 0.2,
  mmDepthPct: 0.001,
  mmMinQty: 1000,
  mmMaxQty: 100000,
  mmSpreadPct: 0.02,
  interventionMode: "regression",
  regressionPct: 0.02,
  tradePriceWeight: 0.7,
  carbonSaturateRatio: 2,
};

/** 将 STOCK_CONFIG 未知/缺失字段合并回默认值，保证运行期类型完整。 */
export function resolveStockConfig(input: Partial<StockConfig> | null | undefined): StockConfig {
  return { ...DEFAULT_STOCK_CONFIG, ...(input ?? {}) };
}

/** 限幅辅助：把 v 截断到 [lo, hi]。 */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 净买压力（S1）：买量-卖量 相对总量占比，∈ (-1, 1)，分母 +1 防除零。
 * 单边行情不再等于 ∞/0，而是趋近于 ±1，配合 maxMovePct 实现「温和波动」而非「直接封板」。
 */
export function computePressure(buyQty: number, sellQty: number): number {
  const denom = buyQty + sellQty + 1;
  return (buyQty - sellQty) / denom;
}

/**
 * 碳排趋势偏置分量（对数压缩，S2 改造）：
 * 以行业均值为基准，c = min(1, -ln(currentCarbon/industryAvgCarbon)/ln(R))。
 *  - 碳排=均值 → c=0；碳排=R 倍均值 → c=-1；之后随碳排继续增长而持续（但递减）更负，不再早饱和；
 *  - 碳排≤0（零碳排）→ c=+1（最优）；行业均值≤0 无法归一 → c=0；
 *  - 不钳制下界：逐轮跌幅由 computePrice 的 ±limitPct 硬限幅兜底。
 * R = carbonSaturateRatio（默认 2，与旧线性式在 ≤2× 段锚点一致）。
 * 对数把"指数级碳排增长"压缩为"线性变负"，消除原线性式在 2× 处 c 锁死 -1 的早饱和。
 */
export function computeCarbonDrift(
  currentCarbon: number,
  industryAvgCarbon: number,
  carbonSaturateRatio: number = 2,
): number {
  if (industryAvgCarbon <= 0) return 0;
  if (currentCarbon <= 0) return 1;
  const r = currentCarbon / industryAvgCarbon;
  const k = Math.log(carbonSaturateRatio > 1 ? carbonSaturateRatio : 2);
  return Math.min(1, -Math.log(r) / k);
}

/**
 * 趋势偏置（S2）：幸福度/碳排不再直接放大理论价，而是压缩为长期趋势偏置。
 * 均衡盘 drift≈0 → 价格基本持平；单轮影响上限收敛到 (happinessImpact+carbonImpact)*maxMovePct。
 */
export function computeDrift(
  happiness: number,
  currentCarbon: number,
  industryAvgCarbon: number,
  happinessImpact: number,
  carbonImpact: number,
  carbonSaturateRatio: number = 2,
): number {
  const h = (happiness - 50) / 50;
  const c = computeCarbonDrift(currentCarbon, industryAvgCarbon, carbonSaturateRatio);
  return happinessImpact * h + carbonImpact * c;
}

/** 理论价（S1）：上轮收盘 × (1 + 压力×maxMovePct + 偏置×maxMovePct)。 */
export function computeTheoretical(
  lastClose: number,
  pressure: number,
  drift: number,
  maxMovePct: number,
): number {
  return lastClose * (1 + pressure * maxMovePct + drift * maxMovePct);
}

export interface PriceFactors {
  lastClose: number; // 上轮收盘价
  buyQty: number; // 买单总量（股）
  sellQty: number; // 卖单总量（股）
  matched: boolean; // 是否存在真实成交（最高买 >= 最低卖）
  tradePrice: number | null; // 成交价（matched=false 时为 null）
  happiness: number; // 当前幸福度
  currentCarbon: number; // 当前碳排
  industryAvgCarbon: number; // 行业碳排均值
  config: StockConfig; // 比赛级配置
}

export interface PriceResult {
  pressure: number; // 净买压力
  drift: number; // 趋势偏置
  theoretical: number; // 理论价（限幅前）
  final: number; // 最终价（限幅后，2 位小数）
  usedTradePrice: boolean; // 是否采用成交价加权（false=平盘）
}

export function computePrice(f: PriceFactors): PriceResult {
  const pressure = computePressure(f.buyQty, f.sellQty);
  const drift = computeDrift(
    f.happiness,
    f.currentCarbon,
    f.industryAvgCarbon,
    f.config.happinessImpact,
    f.config.carbonImpact,
    f.config.carbonSaturateRatio,
  );
  const theoretical = computeTheoretical(f.lastClose, pressure, drift, f.config.maxMovePct);

  const upper = f.lastClose * (1 + f.config.limitPct);
  const lower = f.lastClose * (1 - f.config.limitPct);

  // S5/S6：未成交（单边无对手盘）→ 平盘，价格不动；成交价参与定价（权重可配）。
  let final: number;
  let usedTradePrice = false;
  if (f.matched && f.tradePrice != null && Number.isFinite(f.tradePrice)) {
    const w = f.config.tradePriceWeight;
    const blended = w * f.tradePrice + (1 - w) * theoretical;
    final = clamp(blended, lower, upper);
    usedTradePrice = true;
  } else {
    final = clamp(f.lastClose, lower, upper); // = lastClose（限幅内）
  }
  final = round2(final);

  return { pressure, drift, theoretical, final, usedTradePrice };
}

export interface CandleInput {
  open: number;
  close: number;
}

/** 保留 2 位小数（股价精度）。 */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * 确定性伪随机：由两个种子派生 [0,1) 的伪随机数。
 * 采用正弦哈希，保证同一轮（seedA=round）下结果可复现——纯函数，便于单测与前后端一致性。
 */
function candleNoise(seedA: number, seedB: number): number {
  const x = Math.sin(seedA * 127.1 + seedB * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 构建 K 线数据。
 * @param open 开盘价（上轮收盘）
 * @param close 收盘价（本轮最终价，已限幅）
 * @param round 轮次
 * @param theoretical 理论价（限幅前），用于决定影线方向性极端
 *
 * 影线设计：盘中价格围绕「开盘 → 理论价 → 收盘」运动。
 *  1) 理论价在 ±10% 限幅内的投影 t 决定方向性极端：理论价高于实体则上影线可触 t、低于实体则下影线可触 t；
 *  2) 再在实体 / 理论价之外叠加一段确定性盘中波动（上下影线），使 K 线不再恒为「光头光脚」
 *     （避免最高价恒=开盘、最低价恒=收盘）。
 * 所有价位均限幅在 [开盘×0.9, 开盘×1.1] 内，涨跌幅仍由 (收盘-开盘)/开盘 计算。
 */
export function buildCandle(open: number, close: number, round: number, theoretical?: number, limitPct = 0.1) {
  const upper = round2(open * (1 + limitPct)); // 涨停价
  const lower = round2(open * (1 - limitPct)); // 跌停价
  const range = upper - lower; // 限幅区间宽度

  // 实体边界
  const bodyHigh = Math.max(open, close);
  const bodyLow = Math.min(open, close);

  // 理论价在限幅内的投影：盘中价格会朝理论价运动，可能触及它（影线方向依据）
  let high = bodyHigh;
  let low = bodyLow;
  if (theoretical != null && Number.isFinite(theoretical)) {
    const t = Math.min(Math.max(theoretical, lower), upper);
    high = Math.max(high, t);
    low = Math.min(low, t);
  }

  // 确定性盘中波动：在实体 / 理论价之外延伸上下影线（限幅内），避免 K 线恒为光头光脚。
  const wick = range * 0.12; // 影线波动基准（限幅区间 12%，即约开盘价 2.4%）
  const upWick = wick * candleNoise(round, open);
  const downWick = wick * candleNoise(round * 3 + 7, open);
  high = round2(Math.min(upper, high + upWick));
  low = round2(Math.max(lower, low - downWick));

  const changePct = open !== 0 ? Math.round(((close - open) / open) * 100 * 100) / 100 : 0;
  return { round, open, high, low, close, changePct };
}

/** 初始价公式：ROUND(initNetProfit*10000/totalShares/industryPE, 2) */
export function computeInitPrice(
  initNetProfit: number,
  totalShares: number,
  industryPE: number,
): number {
  if (industryPE <= 0 || totalShares <= 0) return 0;
  return Math.round((initNetProfit * 10000) / totalShares / industryPE * 100) / 100;
}
