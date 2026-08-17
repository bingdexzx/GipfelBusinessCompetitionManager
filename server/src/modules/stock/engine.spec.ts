/**
 * stock/engine.ts 单测
 *
 * 覆盖：
 * 1. computeMatch - 订单撮合
 * 2. computePrice - 定价计算
 * 3. buildCandle - K 线构建
 * 4. computeInitPrice - 初始价计算
 */

import { computeMatch, computePrice, buildCandle, computeInitPrice, computePressure, computeDrift, DEFAULT_STOCK_CONFIG, RawOrder } from './engine';

describe('stock/engine', () => {
  // ========== computeMatch ==========
  describe('computeMatch', () => {
    it('空订单', () => {
      const result = computeMatch([]);
      expect(result.highestBuy).toBe(0);
      expect(result.lowestSell).toBe(Infinity);
      expect(result.totalBuyQty).toBe(0);
      expect(result.totalSellQty).toBe(0);
      expect(result.totalBuyAmount).toBe(0);
      expect(result.totalSellAmount).toBe(0);
      expect(result.matched).toBe(false);
      expect(result.tradePrice).toBeNull();
    });

    it('仅有买单', () => {
      const orders: RawOrder[] = [
        { side: 'BUY', price: 10, quantity: 100 },
        { side: 'BUY', price: 12, quantity: 50 },
      ];
      const result = computeMatch(orders);
      expect(result.highestBuy).toBe(12);
      expect(result.totalBuyQty).toBe(150);
      expect(result.totalBuyAmount).toBe(10 * 100 + 12 * 50);
      expect(result.matched).toBe(false);
    });

    it('仅有卖单', () => {
      const orders: RawOrder[] = [
        { side: 'SELL', price: 15, quantity: 100 },
        { side: 'SELL', price: 20, quantity: 50 },
      ];
      const result = computeMatch(orders);
      expect(result.lowestSell).toBe(15);
      expect(result.totalSellQty).toBe(150);
      expect(result.matched).toBe(false);
    });

    it('买卖不成交（最高买 < 最低卖）', () => {
      const orders: RawOrder[] = [
        { side: 'BUY', price: 10, quantity: 100 },
        { side: 'SELL', price: 15, quantity: 100 },
      ];
      const result = computeMatch(orders);
      expect(result.matched).toBe(false);
      expect(result.tradePrice).toBeNull();
    });

    it('买卖可成交（最高买 >= 最低卖）', () => {
      const orders: RawOrder[] = [
        { side: 'BUY', price: 15, quantity: 100 },
        { side: 'SELL', price: 12, quantity: 100 },
      ];
      const result = computeMatch(orders);
      expect(result.matched).toBe(true);
      expect(result.tradePrice).toBe((15 + 12) / 2);
    });

    it('边界：最高买 = 最低卖（恰好成交）', () => {
      const orders: RawOrder[] = [
        { side: 'BUY', price: 10, quantity: 100 },
        { side: 'SELL', price: 10, quantity: 100 },
      ];
      const result = computeMatch(orders);
      expect(result.matched).toBe(true);
      expect(result.tradePrice).toBe(10);
    });

    it('多笔订单取极值', () => {
      const orders: RawOrder[] = [
        { side: 'BUY', price: 8, quantity: 100 },
        { side: 'BUY', price: 12, quantity: 50 },
        { side: 'BUY', price: 10, quantity: 200 },
        { side: 'SELL', price: 15, quantity: 100 },
        { side: 'SELL', price: 11, quantity: 150 },
        { side: 'SELL', price: 20, quantity: 50 },
      ];
      const result = computeMatch(orders);
      expect(result.highestBuy).toBe(12);
      expect(result.lowestSell).toBe(11);
      expect(result.matched).toBe(true);
      expect(result.tradePrice).toBe((12 + 11) / 2);
      expect(result.totalBuyQty).toBe(350);
      expect(result.totalSellQty).toBe(300);
    });
  });

  // ========== computePrice（新版：净买压力 + 趋势偏置 + 成交价权重）==========
  describe('computePrice', () => {
    const baseFactors = () => ({
      lastClose: 100,
      buyQty: 1000,
      sellQty: 1000,
      matched: true,
      tradePrice: 100,
      happiness: 50,
      currentCarbon: 100,
      industryAvgCarbon: 100,
      config: DEFAULT_STOCK_CONFIG,
    });

    it('均衡盘：买卖相等 → 价格基本持平', () => {
      const r = computePrice(baseFactors());
      expect(r.pressure).toBeCloseTo(0, 5);
      expect(r.drift).toBeCloseTo(0, 5);
      expect(r.theoretical).toBeCloseTo(100, 1);
      expect(r.final).toBeCloseTo(100, 1);
      expect(r.usedTradePrice).toBe(true);
    });

    it('单边买盘：pressure>0 → 价格上涨（温和，不瞬间封板）', () => {
      const r = computePrice({ ...baseFactors(), buyQty: 9000, sellQty: 1000 });
      expect(r.pressure).toBeGreaterThan(0);
      expect(r.final).toBeGreaterThan(100);
      // S1：单轮最大移动 = maxMovePct(5%)，不会直接顶到 +10% 涨停
      expect(r.final).toBeLessThanOrEqual(110);
      expect(r.final).toBeLessThanOrEqual(105.01);
    });

    it('单边卖盘：pressure<0 → 价格下跌', () => {
      const r = computePrice({ ...baseFactors(), buyQty: 1000, sellQty: 9000 });
      expect(r.pressure).toBeLessThan(0);
      expect(r.final).toBeLessThan(100);
      expect(r.final).toBeGreaterThanOrEqual(90);
      expect(r.final).toBeGreaterThanOrEqual(94.99);
    });

    it('幸福度偏置 > 50：drift 为正，理论价略升', () => {
      const r = computePrice({ ...baseFactors(), happiness: 75 });
      expect(r.drift).toBeCloseTo(0.1, 5); // 0.2*(75-50)/50
      expect(r.theoretical).toBeGreaterThan(100);
    });

    it('碳排低于均值：carbonDrift 为正，drift 略升', () => {
      const r = computePrice({ ...baseFactors(), currentCarbon: 50 });
      expect(r.drift).toBeCloseTo(0.1, 5); // 0.2*clamp((100-50)/100)
    });

    it('未成交（matched=false）：平盘，价格不动（S5/S6）', () => {
      const r = computePrice({ ...baseFactors(), matched: false, tradePrice: null });
      expect(r.final).toBeCloseTo(100, 1);
      expect(r.usedTradePrice).toBe(false);
    });

    it('限幅 +10%（极端压力也不超涨停）', () => {
      const r = computePrice({ ...baseFactors(), buyQty: 1_000_000, sellQty: 0, tradePrice: 109 });
      expect(r.final).toBeLessThanOrEqual(110);
    });

    it('限幅 -10%（极端压力也不跌破跌停）', () => {
      const r = computePrice({ ...baseFactors(), buyQty: 0, sellQty: 1_000_000, tradePrice: 91 });
      expect(r.final).toBeGreaterThanOrEqual(90);
    });

    it('价格保留 2 位小数', () => {
      const r = computePrice(baseFactors());
      expect(r.final).toBe(Math.round(r.final * 100) / 100);
    });
  });

  // ========== computePressure / computeDrift ==========
  describe('computePressure & computeDrift', () => {
    it('均衡 → 0', () => {
      expect(computePressure(1000, 1000)).toBeCloseTo(0, 6);
    });
    it('单边买 → 接近 1（非 Infinity）', () => {
      const p = computePressure(9000, 1000);
      expect(p).toBeGreaterThan(0.7);
      expect(p).toBeLessThan(1);
    });
    it('单边卖 → 接近 -1（非 0/-Infinity）', () => {
      const p = computePressure(1000, 9000);
      expect(p).toBeLessThan(-0.7);
      expect(p).toBeGreaterThan(-1);
    });
    it('drift 仅作微弱偏置（均衡 ≈ 0，极端 ≤ ±0.4）', () => {
      expect(computeDrift(50, 100, 100, 0.2, 0.2)).toBeCloseTo(0, 6);
      expect(computeDrift(100, 100, 100, 0.2, 0.2)).toBeCloseTo(0.2, 6);
      expect(computeDrift(0, 100, 100, 0.2, 0.2)).toBeCloseTo(-0.2, 6);
    });
  });

  // ========== 连续推进轨迹（T11）：不应出现一字封板/锯齿 ==========
  describe('连续推进轨迹（T11）', () => {
    it('玩家持续单边买入 5 轮：每轮温和上涨，不瞬间封板、无锯齿', () => {
      let price = 100;
      const closes: number[] = [];
      for (let round = 1; round <= 5; round++) {
        const factors = {
          lastClose: price,
          buyQty: 9000,
          sellQty: 1000,
          matched: true,
          tradePrice: Math.round(price * 1.02 * 100) / 100,
          happiness: 50,
          currentCarbon: 100,
          industryAvgCarbon: 100,
          config: DEFAULT_STOCK_CONFIG,
        };
        const r = computePrice(factors);
        // 单轮最大移动 ≤ 约 6%（maxMovePct 5% + drift ≤1%），绝不瞬间封板
        const move = Math.abs(r.final - price) / price;
        expect(move).toBeLessThanOrEqual(0.06 + 1e-9);
        expect(r.final).toBeLessThanOrEqual(price * 1.1);
        expect(r.final).toBeGreaterThanOrEqual(price * 0.9);
        closes.push(r.final);
        price = r.final;
      }
      // 无锯齿：相邻轮次单调（持续买压 → 单调上行，不出现涨↔跌交替）
      for (let i = 1; i < closes.length; i++) {
        expect(closes[i]).toBeGreaterThanOrEqual(closes[i - 1] - 1e-6);
      }
    });

    it('零成交轮次：价格不动（跳过推进，S6）', () => {
      const r = computePrice({
        lastClose: 100,
        buyQty: 5000,
        sellQty: 5000,
        matched: false,
        tradePrice: null,
        happiness: 50,
        currentCarbon: 100,
        industryAvgCarbon: 100,
        config: DEFAULT_STOCK_CONFIG,
      });
      expect(r.final).toBeCloseTo(100, 2);
    });
  });

  // ========== buildCandle ==========
  describe('buildCandle', () => {
    it('基本 K 线构建', () => {
      const candle = buildCandle(100, 105, 1);
      expect(candle.open).toBe(100);
      expect(candle.close).toBe(105);
      expect(candle.round).toBe(1);
      expect(candle.changePct).toBeCloseTo(5, 1);
    });

    it('high >= max(open, close)', () => {
      const candle = buildCandle(100, 105, 1);
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(100, 105));
    });

    it('low <= min(open, close)', () => {
      const candle = buildCandle(100, 95, 1);
      expect(candle.low).toBeLessThanOrEqual(Math.min(100, 95));
    });

    it('high <= 涨停价 (open * 1.1)', () => {
      const candle = buildCandle(100, 110, 1);
      expect(candle.high).toBeLessThanOrEqual(110.01); // 允许浮点误差
    });

    it('low >= 跌停价 (open * 0.9)', () => {
      const candle = buildCandle(100, 90, 1);
      expect(candle.low).toBeGreaterThanOrEqual(89.99);
    });

    it('涨跌幅计算', () => {
      const candle = buildCandle(100, 110, 1);
      expect(candle.changePct).toBeCloseTo(10, 1);

      const candleDown = buildCandle(100, 90, 1);
      expect(candleDown.changePct).toBeCloseTo(-10, 1);
    });

    it('理论价影响影线方向', () => {
      // 理论价高于收盘价，应有上影线
      const candle = buildCandle(100, 105, 1, 115);
      expect(candle.high).toBeGreaterThan(105);
    });

    it('平盘 K 线', () => {
      const candle = buildCandle(100, 100, 1);
      expect(candle.open).toBe(100);
      expect(candle.close).toBe(100);
      expect(candle.changePct).toBe(0);
    });

    it('确定性：同参数同结果', () => {
      const c1 = buildCandle(100, 105, 3);
      const c2 = buildCandle(100, 105, 3);
      expect(c1).toEqual(c2);
    });

    it('不同轮次产生不同影线', () => {
      const c1 = buildCandle(100, 105, 1);
      const c2 = buildCandle(100, 105, 2);
      // 影线高度可能不同（取决于伪随机）
      // 至少验证它们都是有效 K 线
      expect(c1.high).toBeGreaterThanOrEqual(105);
      expect(c2.high).toBeGreaterThanOrEqual(105);
    });
  });

  // ========== computeInitPrice ==========
  describe('computeInitPrice', () => {
    it('正常计算', () => {
      // initNetProfit=1000万, totalShares=1000万股, industryPE=10
      // = ROUND(1000*10000/1000/10, 2) = ROUND(1000, 2) = 1000
      expect(computeInitPrice(1000, 1000, 10)).toBe(1000);
    });

    it('PE <= 0 返回 0', () => {
      expect(computeInitPrice(1000, 1000, 0)).toBe(0);
      expect(computeInitPrice(1000, 1000, -5)).toBe(0);
    });

    it('totalShares <= 0 返回 0', () => {
      expect(computeInitPrice(1000, 0, 10)).toBe(0);
      expect(computeInitPrice(1000, -100, 10)).toBe(0);
    });

    it('保留 2 位小数', () => {
      // 1000*10000/300/7 = 4761.904761... -> 4761.9
      const price = computeInitPrice(1000, 300, 7);
      expect(price).toBe(Math.round(price * 100) / 100);
    });

    it('小额场景', () => {
      // initNetProfit=100万, totalShares=5000万股, industryPE=20
      // = ROUND(100*10000/5000/20, 2) = ROUND(10, 2) = 10
      expect(computeInitPrice(100, 5000, 20)).toBe(10);
    });
  });
});
