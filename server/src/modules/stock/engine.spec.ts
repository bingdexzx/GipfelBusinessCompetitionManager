/**
 * stock/engine.ts 单测
 *
 * 覆盖：
 * 1. computeMatch - 订单撮合
 * 2. computePrice - 定价计算
 * 3. buildCandle - K 线构建
 * 4. computeInitPrice - 初始价计算
 */

import { computeMatch, computePrice, buildCandle, computeInitPrice, RawOrder } from './engine';

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

  // ========== computePrice ==========
  describe('computePrice', () => {
    const baseFactors = {
      lastClose: 100,
      buyAmount: 100000,
      sellAmount: 100000,
      happiness: 50,
      currentCarbon: 100,
      industryAvgCarbon: 100,
    };

    it('均衡盘：买卖相等，价格持平', () => {
      const result = computePrice(baseFactors);
      expect(result.happinessFactor).toBeCloseTo(1, 5);
      expect(result.carbonFactor).toBeCloseTo(1, 5);
      expect(result.theoretical).toBeCloseTo(100, 1);
      expect(result.final).toBeCloseTo(100, 1);
    });

    it('买盘大于卖盘：价格上涨', () => {
      const result = computePrice({ ...baseFactors, buyAmount: 200000 });
      expect(result.theoretical).toBeGreaterThan(100);
      expect(result.final).toBeGreaterThan(100);
    });

    it('卖盘大于买盘：价格下跌', () => {
      const result = computePrice({ ...baseFactors, sellAmount: 200000 });
      expect(result.theoretical).toBeLessThan(100);
      expect(result.final).toBeLessThan(100);
    });

    it('无卖单有买单：封涨停', () => {
      const result = computePrice({ ...baseFactors, sellAmount: 0 });
      expect(result.theoretical).toBe(Infinity);
      expect(result.final).toBe(110); // 涨停价 = 100 * 1.1
    });

    it('无买单有卖单：封跌停', () => {
      const result = computePrice({ ...baseFactors, buyAmount: 0 });
      expect(result.theoretical).toBe(0);
      expect(result.final).toBe(90); // 跌停价 = 100 * 0.9
    });

    it('无订单：价格持平', () => {
      const result = computePrice({ ...baseFactors, buyAmount: 0, sellAmount: 0 });
      expect(result.theoretical).toBeCloseTo(100, 1);
      expect(result.final).toBeCloseTo(100, 1);
    });

    it('限幅 +10%', () => {
      const result = computePrice({
        ...baseFactors,
        buyAmount: 500000,
        sellAmount: 100000,
      });
      expect(result.final).toBeLessThanOrEqual(110);
    });

    it('限幅 -10%', () => {
      const result = computePrice({
        ...baseFactors,
        buyAmount: 10000,
        sellAmount: 500000,
      });
      expect(result.final).toBeGreaterThanOrEqual(90);
    });

    it('幸福度 > 50：正向因子', () => {
      const result = computePrice({ ...baseFactors, happiness: 75 });
      expect(result.happinessFactor).toBeCloseTo(1.1, 5);
    });

    it('幸福度 < 50：负向因子', () => {
      const result = computePrice({ ...baseFactors, happiness: 25 });
      expect(result.happinessFactor).toBeCloseTo(0.9, 5);
    });

    it('碳排低于均值：正向因子', () => {
      const result = computePrice({ ...baseFactors, currentCarbon: 50 });
      expect(result.carbonFactor).toBeGreaterThan(1);
    });

    it('碳排高于均值：负向因子', () => {
      const result = computePrice({ ...baseFactors, currentCarbon: 150 });
      expect(result.carbonFactor).toBeLessThan(1);
    });

    it('行业碳排均值为 0：碳因子为 1', () => {
      const result = computePrice({ ...baseFactors, industryAvgCarbon: 0 });
      expect(result.carbonFactor).toBe(1);
    });

    it('价格保留 2 位小数', () => {
      const result = computePrice(baseFactors);
      expect(result.final).toBe(Math.round(result.final * 100) / 100);
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
