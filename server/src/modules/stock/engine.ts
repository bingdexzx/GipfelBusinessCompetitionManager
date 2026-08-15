/**
 * 股票撮合 / 定价引擎（纯函数，便于单测与复用）。
 * 逻辑严格对齐用户提供的 Excel「模拟股票系统.xlsx」：
 *  - 撮合结果：最高买价=MAX(买入价)，最低卖价=MIN(卖出价)，成交价=(最高买+最低卖)/2，
 *    是否成交=最高买>=最低卖。
 *  - 实时价格：买盘总额=Σ买入金额，卖盘总额=Σ卖出金额；
 *    幸福因子=1+0.2*(幸福度-50)/50；碳因子=1-0.5*(当前碳排-行业碳排均值)/行业碳排均值；
 *    理论价=上轮价×买盘总额/卖盘总额×幸福因子×碳因子；
 *    最终价=限幅(理论价, 上轮价×0.9, 上轮价×1.1)。
 *  - K线：开盘=上轮收盘；收盘=最终价；盘高=MAX(开盘,收盘)；盘低=MIN(开盘,收盘)；
 *    涨跌幅=(收盘-开盘)/开盘×100。
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

/**
 * 构建 K 线数据。
 * @param open 开盘价（上轮收盘）
 * @param close 收盘价（本轮最终价，已限幅）
 * @param round 轮次
 * @param theoretical 理论价（限幅前），用于生成影线。不传则影线等于实体。
 */
export function buildCandle(open: number, close: number, round: number, theoretical?: number) {
  // 影线：如果理论价超出限幅范围，影线延伸到限幅边界
  const upper = open * 1.1;
  const lower = open * 0.9;
  let high = Math.max(open, close);
  let low = Math.min(open, close);

  if (theoretical != null && Number.isFinite(theoretical)) {
    if (theoretical > upper) {
      // 理论价超过上限，上影线延伸到上限
      high = Math.round(upper * 100) / 100;
    } else if (theoretical > high) {
      high = theoretical;
    }
    if (theoretical < lower) {
      // 理论价低于下限，下影线延伸到下限
      low = Math.round(lower * 100) / 100;
    } else if (theoretical < low) {
      low = theoretical;
    }
  }

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
