/**
 * contracts/engine/compute.ts 单元测试
 *
 * 覆盖：computeTotalQty, computeMaterialListCarbon, computeVehicleTotalPrice,
 *       computeMaterialListPrice, computeFuelTotalPrice, computeWarehouseTotalStorage
 *
 * 使用 jest.fn() 模拟 Prisma client，无需真实数据库。
 */

import {
  computeTotalQty,
  computeMaterialListCarbon,
  computeVehicleTotalPrice,
  computeMaterialListPrice,
  computeFuelTotalPrice,
  computeWarehouseTotalStorage,
} from './compute';

/** 创建 mock prisma client */
function createMockPrisma() {
  return {
    material: { findMany: jest.fn().mockResolvedValue([]) },
    vehicle: { findMany: jest.fn().mockResolvedValue([]) },
    fuel: { findMany: jest.fn().mockResolvedValue([]) },
    warehouse: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
}

describe('contracts/engine/compute', () => {
  // ========== computeTotalQty（纯函数） ==========
  describe('computeTotalQty', () => {
    it('正常字典求和', () => {
      expect(computeTotalQty({ a: 10, b: 20, c: 30 })).toBe(60);
    });

    it('空字典', () => {
      expect(computeTotalQty({})).toBe(0);
    });

    it('null / undefined / 非对象', () => {
      expect(computeTotalQty(null)).toBe(0);
      expect(computeTotalQty(undefined)).toBe(0);
      expect(computeTotalQty('string')).toBe(0);
      expect(computeTotalQty([1, 2, 3])).toBe(0);
    });

    it('非数字值转为 0', () => {
      expect(computeTotalQty({ a: 5, b: 'abc', c: 10 })).toBe(15);
    });
  });

  // ========== computeMaterialListCarbon ==========
  describe('computeMaterialListCarbon', () => {
    it('计算碳排放合计', async () => {
      const prisma = createMockPrisma();
      prisma.material.findMany.mockResolvedValue([
        { name: '钢材', carbonEmissionCoefficient: 1.5 },
        { name: '塑料', carbonEmissionCoefficient: 0.8 },
      ]);
      const raw = { '钢材': 100, '塑料': 50 };
      const result = await computeMaterialListCarbon(raw, 1, prisma);
      // 1.5*100 + 0.8*50 = 150 + 40 = 190
      expect(result).toBe(190);
      expect(prisma.material.findMany).toHaveBeenCalledWith({
        where: { competitionId: 1, name: { in: ['钢材', '塑料'] } },
        select: { name: true, carbonEmissionCoefficient: true },
      });
    });

    it('null / 非对象返回 0', async () => {
      const prisma = createMockPrisma();
      expect(await computeMaterialListCarbon(null, 1, prisma)).toBe(0);
      expect(await computeMaterialListCarbon([1, 2], 1, prisma)).toBe(0);
      expect(await computeMaterialListCarbon({}, 1, prisma)).toBe(0);
    });

    it('数量为 0 的条目被过滤', async () => {
      const prisma = createMockPrisma();
      prisma.material.findMany.mockResolvedValue([
        { name: '钢材', carbonEmissionCoefficient: 2 },
      ]);
      const result = await computeMaterialListCarbon({ '钢材': 10, '废料': 0 }, 1, prisma);
      expect(result).toBe(20);
      // findMany 应只包含数量 > 0 的名称
      expect(prisma.material.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ name: { in: ['钢材'] } }),
        }),
      );
    });

    it('缺少 competitionId 抛出 BadRequestException', async () => {
      const prisma = createMockPrisma();
      await expect(
        computeMaterialListCarbon({ '钢材': 10 }, undefined, prisma),
      ).rejects.toThrow('缺少比赛上下文');
    });
  });

  // ========== computeVehicleTotalPrice ==========
  describe('computeVehicleTotalPrice', () => {
    it('载具总价格 = Σ(price × 数量)', async () => {
      const prisma = createMockPrisma();
      prisma.vehicle.findMany.mockResolvedValue([
        { name: '卡车', price: 50000 },
        { name: '货车', price: 30000 },
      ]);
      const result = await computeVehicleTotalPrice({ '卡车': 2, '货车': 3 }, 1, prisma);
      // 50000*2 + 30000*3 = 100000 + 90000 = 190000
      expect(result).toBe(190000);
    });

    it('未查到的载具跳过', async () => {
      const prisma = createMockPrisma();
      prisma.vehicle.findMany.mockResolvedValue([
        { name: '卡车', price: 50000 },
      ]);
      const result = await computeVehicleTotalPrice({ '卡车': 1, '飞机': 1 }, 1, prisma);
      expect(result).toBe(50000);
    });

    it('null / 非对象返回 0', async () => {
      const prisma = createMockPrisma();
      expect(await computeVehicleTotalPrice(null, 1, prisma)).toBe(0);
      expect(await computeVehicleTotalPrice('str', 1, prisma)).toBe(0);
    });

    it('缺少 competitionId 抛错', async () => {
      const prisma = createMockPrisma();
      await expect(
        computeVehicleTotalPrice({ '卡车': 1 }, undefined, prisma),
      ).rejects.toThrow('缺少比赛上下文');
    });
  });

  // ========== computeMaterialListPrice ==========
  describe('computeMaterialListPrice', () => {
    it('原料总价格（地点价优先）', async () => {
      const prisma = createMockPrisma();
      prisma.material.findMany.mockResolvedValue([
        { name: '钢材', nodePrices: '{"1":120,"2":100}' },
      ]);
      // locationNodeId=1，使用节点 1 的价格 120
      const result = await computeMaterialListPrice({ '钢材': 10 }, 1, prisma, 1);
      expect(result).toBe(1200);
    });

    it('无地点价时价格为 0', async () => {
      const prisma = createMockPrisma();
      prisma.material.findMany.mockResolvedValue([
        { name: '钢材', nodePrices: null },
      ]);
      const result = await computeMaterialListPrice({ '钢材': 10 }, 1, prisma);
      expect(result).toBe(0);
    });

    it('null / 非对象返回 0', async () => {
      const prisma = createMockPrisma();
      expect(await computeMaterialListPrice(null, 1, prisma)).toBe(0);
      expect(await computeMaterialListPrice([], 1, prisma)).toBe(0);
    });
  });

  // ========== computeFuelTotalPrice ==========
  describe('computeFuelTotalPrice', () => {
    it('燃料总价格 = Σ(pricePerLiter × 数量)', async () => {
      const prisma = createMockPrisma();
      prisma.fuel.findMany.mockResolvedValue([
        { name: '汽油', pricePerLiter: 8.5 },
        { name: '柴油', pricePerLiter: 7.2 },
      ]);
      const result = await computeFuelTotalPrice({ '汽油': 100, '柴油': 50 }, 1, prisma);
      // 8.5*100 + 7.2*50 = 850 + 360 = 1210
      expect(result).toBe(1210);
    });

    it('null 返回 0', async () => {
      const prisma = createMockPrisma();
      expect(await computeFuelTotalPrice(null, 1, prisma)).toBe(0);
    });
  });

  // ========== computeWarehouseTotalStorage ==========
  describe('computeWarehouseTotalStorage', () => {
    it('按类型聚合容量', async () => {
      const prisma = createMockPrisma();
      prisma.warehouse.findMany.mockResolvedValue([
        { name: '仓库A', type: '常温', capacity: 1000 },
        { name: '仓库B', type: '冷藏', capacity: 500 },
        { name: '仓库C', type: '常温', capacity: 800 },
      ]);
      const result = await computeWarehouseTotalStorage(
        { '仓库A': 2, '仓库B': 1, '仓库C': 3 },
        1,
        prisma,
      );
      // 常温: 1000*2 + 800*3 = 2000 + 2400 = 4400
      // 冷藏: 500*1 = 500
      expect(result).toEqual({ '常温': 4400, '冷藏': 500 });
    });

    it('null / 非对象返回空对象', async () => {
      const prisma = createMockPrisma();
      expect(await computeWarehouseTotalStorage(null, 1, prisma)).toEqual({});
      expect(await computeWarehouseTotalStorage([], 1, prisma)).toEqual({});
    });
  });
});
