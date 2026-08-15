/**
 * 股票撮合 / 定价引擎（纯函数，便于单测与复用）。
 * 逻辑严格对齐用户提供的 Excel「模拟股票系统.xlsx」：
 *  - 撮合结果：最高买价=MAX(买入价)，最低卖价=MIN(卖出价)，成交价=(最高买+最低卖)/2，
 *    是否成交=最高买>=最低卖。
 *  - 实时价格：买盘总额=Σ买入金额，卖盘总额=Σ卖出金额；
 *    幸福因子=1+0.2*(幸福度-50)/50；碳因子=1-0.5*(当前碳排-行业碳排均值)/行业碳排均值；
 *    理论价=上轮价×买盘总额/卖盘总额×幸福因子×碳因子；
 *    最终价=限幅(理论价, 上轮价×0.9, 上轮价×1.1)。
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

export interface PriceFactors {
  lastClose: number; // 上轮收盘价
  buyAmount: number; // 买盘总额
  sellAmount: number; // 卖盘总额
  happiness: number; // 当前幸福度
  currentCarbon: number; // 当前碳排
  industryAvgCarbon: number; // 行业碳排均值
}

export interface PriceResult {
  happinessFactor: number; // 幸福因子
  carbonFactor: number; // 碳因子
  theoretical: number; // 理论价（限幅前）
  final: number; // 最终价（限幅后）
}

export function computePrice(f: PriceFactors): PriceResult {
  const happinessFactor = 1 + (0.2 * (f.happiness - 50)) / 50;
  const carbonFactor =
    f.industryAvgCarbon !== 0
      ? 1 - (0.5 * (f.currentCarbon - f.industryAvgCarbon)) / f.industryAvgCarbon
      : 1;

  // 买卖压力比：无卖单且存在买单 -> 封顶；无买单且存在卖单 -> 封底；无单 -> 持平。
  let ratio: number;
  if (f.sellAmount > 0) ratio = f.buyAmount / f.sellAmount;
  else if (f.buyAmount > 0) ratio = Infinity;
  else ratio = 1;

  const theoretical = f.lastClose * ratio * happinessFactor * carbonFactor;
  const upper = f.lastClose * 1.1;
  const lower = f.lastClose * 0.9;
  let final = theoretical;
  if (!Number.isFinite(final)) final = upper;
  if (final > upper) final = upper;
  if (final < lower) final = lower;
  // 保留 2 位小数（股价精度）
  final = Math.round(final * 100) / 100;

  return { happinessFactor, carbonFactor, theoretical, final };
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
export function buildCandle(open: number, close: number, round: number, theoretical?: number) {
  const upper = round2(open * 1.1); // 涨停价
  const lower = round2(open * 0.9); // 跌停价
  const range = upper - lower; // 限幅区间宽度（约 20% 开盘价）

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
