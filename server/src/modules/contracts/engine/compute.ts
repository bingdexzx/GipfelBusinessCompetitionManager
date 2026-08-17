/**
 * 合同引擎 - 计算逻辑
 *
 * 从 contract-engine.service.ts 提取的计算相关函数。
 * 这些函数负责从 Prisma 读取数据并计算聚合值。
 */

import { BadRequestException } from "@nestjs/common";
import { toNumber, toNumberArray, type EvalCtx } from "./values";

// ========== 原料计算 ==========

/**
 * 原料清单碳排放合计：给定 {"原料名称": 数量} 字典，按比赛查询每种原料的
 * carbonEmissionCoefficient，返回 Σ(系数 × 数量)。
 */
export async function computeMaterialListCarbon(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算原料清单碳排放缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const materials: any[] = await prisma.material.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, carbonEmissionCoefficient: true },
  });
  const coeffByName = new Map(
    materials.map((m) => [m.name as string, Number(m.carbonEmissionCoefficient) || 0]),
  );
  let total = 0;
  for (const [name, q] of entries) {
    total += (coeffByName.get(name) ?? 0) * Number(q);
  }
  return total;
}

/**
 * 原料清单总价格：给定 {"原料名称": 数量} 字典，按比赛查询每种原料的「价格(price)」，
 * 将「价格 × 数量」求和，返回单个浮点数（总价格）。
 */
export async function computeMaterialListPrice(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
  locationNodeId?: number,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算原料清单总价格缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const materials: any[] = await prisma.material.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, nodePrices: true },
  });
  let total = 0;
  for (const [name, q] of entries) {
    const mat = materials.find((m) => m.name === name);
    if (!mat) continue;
    // 优先使用地点价
    let price = 0;
    if (locationNodeId && mat.nodePrices) {
      try {
        const np = JSON.parse(mat.nodePrices);
        price = Number(np[String(locationNodeId)]) || 0;
      } catch {
        // JSON 解析失败，使用 0
      }
    }
    total += price * Number(q);
  }
  return total;
}

/**
 * 计算清单总数量：直接把清单字典各项目的数量相加求和。
 */
export function computeTotalQty(raw: any): number {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  return (Object.values(raw) as any[]).reduce((s: number, q: any) => s + toNumber(q), 0);
}

// ========== 零件/产品计算 ==========

/**
 * 零件清单输入源的「所需原料」端点：按比赛展开每个零件配比 → {原料: 总数量} 字典。
 */
export async function computePartMaterials(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<Record<string, number>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return {};
  if (!competitionId) {
    throw new BadRequestException("计算零件原料配比缺少比赛上下文（competitionId）");
  }
  const partNames = entries.map(([name]) => name);
  const parts = await prisma.part.findMany({
    where: { competitionId, name: { in: partNames } },
    include: { partMaterials: { include: { material: true } } },
  });
  const result: Record<string, number> = {};
  for (const [partName, qty] of entries) {
    const part = parts.find((p: any) => p.name === partName);
    if (!part) continue;
    for (const pm of part.partMaterials) {
      const matName = pm.material.name;
      const needed = (result[matName] || 0) + pm.ratio * Number(qty);
      result[matName] = needed;
    }
  }
  return result;
}

/**
 * 产品清单输入源的「需要的零件」端点：按比赛展开每个产品配比 → {零件: 总数量} 字典。
 */
export async function computeProductParts(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<Record<string, number>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return {};
  if (!competitionId) {
    throw new BadRequestException("计算产品零件配比缺少比赛上下文（competitionId）");
  }
  const productNames = entries.map(([name]) => name);
  const products = await prisma.product.findMany({
    where: { competitionId, name: { in: productNames } },
    include: { productParts: { include: { part: true } } },
  });
  const result: Record<string, number> = {};
  for (const [productName, qty] of entries) {
    const product = products.find((p: any) => p.name === productName);
    if (!product) continue;
    for (const pp of product.productParts) {
      const partName = pp.part.name;
      const needed = (result[partName] || 0) + pp.ratio * Number(qty);
      result[partName] = needed;
    }
  }
  return result;
}

/**
 * 零件清单输入源的「所需的科技节点」端点：按比赛查清单中每个零件的科技需求节点名，去重返回列表。
 */
export async function computePartTechNodes(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return [];
  if (!competitionId) {
    throw new BadRequestException("计算零件科技需求缺少比赛上下文（competitionId）");
  }
  const partNames = entries.map(([name]) => name);
  const parts = await prisma.part.findMany({
    where: { competitionId, name: { in: partNames } },
    include: { techRequirements: { include: { techNode: true } } },
  });
  const nodeNames = new Set<string>();
  for (const part of parts) {
    for (const tr of part.techRequirements) {
      nodeNames.add(tr.techNode.name);
    }
  }
  return Array.from(nodeNames);
}

/**
 * 产品清单输入源的「所需的科技节点」端点：按比赛查清单中每个产品的科技需求节点名，去重返回列表。
 */
export async function computeProductTechNodes(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return [];
  if (!competitionId) {
    throw new BadRequestException("计算产品科技需求缺少比赛上下文（competitionId）");
  }
  const productNames = entries.map(([name]) => name);
  const products = await prisma.product.findMany({
    where: { competitionId, name: { in: productNames } },
    include: { techRequirements: { include: { techNode: true } } },
  });
  const nodeNames = new Set<string>();
  for (const product of products) {
    for (const tr of product.techRequirements) {
      nodeNames.add(tr.techNode.name);
    }
  }
  return Array.from(nodeNames);
}

// ========== 基建计算 ==========

/**
 * 基建清单输入源的聚合端点：按比赛查每种基建的指定字段 × 数量 求和。
 */
export async function computeInfraTotal(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
  field: string,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算基建总额缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const infras = await prisma.infrastructure.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, [field]: true },
  });
  let total = 0;
  for (const [name, qty] of entries) {
    const infra = infras.find((i: any) => i.name === name);
    if (!infra) continue;
    total += toNumber(infra[field]) * Number(qty);
  }
  return total;
}

// ========== 载具计算 ==========

/**
 * 载具清单输入源的「载具总价格」端点：按比赛查每种载具 price × 数量 求和。
 */
export async function computeVehicleTotalPrice(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算载具总价格缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const vehicles = await prisma.vehicle.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, price: true },
  });
  let total = 0;
  for (const [name, qty] of entries) {
    const v = vehicles.find((v: any) => v.name === name);
    if (!v) continue;
    total += toNumber(v.price) * Number(qty);
  }
  return total;
}

/**
 * 载具清单输入源的「载具总载货量」端点：按比赛查每种载具 maxCargo × 数量 求和。
 */
export async function computeVehicleTotalCargo(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算载具总载货量缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const vehicles = await prisma.vehicle.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, maxCargo: true },
  });
  let total = 0;
  for (const [name, qty] of entries) {
    const v = vehicles.find((v: any) => v.name === name);
    if (!v) continue;
    total += toNumber(v.maxCargo) * Number(qty);
  }
  return total;
}

/**
 * 载具清单输入源的「总每公里油耗」端点：按比赛查每种载具 fuelConsumptionPerKm × 数量 求和。
 */
export async function computeVehicleTotalFuelPerKm(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算载具总油耗缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const vehicles = await prisma.vehicle.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, fuelConsumptionPerKm: true },
  });
  let total = 0;
  for (const [name, qty] of entries) {
    const v = vehicles.find((v: any) => v.name === name);
    if (!v) continue;
    total += toNumber(v.fuelConsumptionPerKm) * Number(qty);
  }
  return total;
}

/**
 * 载具清单输入源的「总碳排数」端点：按比赛查每种载具 carbonEmission × 数量 求和。
 */
export async function computeVehicleTotalCarbon(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算载具总碳排缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const vehicles = await prisma.vehicle.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, carbonEmission: true },
  });
  let total = 0;
  for (const [name, qty] of entries) {
    const v = vehicles.find((v: any) => v.name === name);
    if (!v) continue;
    total += toNumber(v.carbonEmission) * Number(qty);
  }
  return total;
}

// ========== 燃料计算 ==========

/**
 * 燃料清单输入源的「燃料总价格」端点：按比赛查每种燃料 pricePerLiter × 数量 求和。
 */
export async function computeFuelTotalPrice(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算燃料总价格缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const fuels = await prisma.fuel.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, pricePerLiter: true },
  });
  let total = 0;
  for (const [name, qty] of entries) {
    const f = fuels.find((f: any) => f.name === name);
    if (!f) continue;
    total += toNumber(f.pricePerLiter) * Number(qty);
  }
  return total;
}

// ========== 仓库计算 ==========

/**
 * 仓库清单输入源的「每种种类的仓库总存储量」端点：按 type 聚合 Σ(capacity × 数量)。
 */
export async function computeWarehouseTotalStorage(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<Record<string, number>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return {};
  if (!competitionId) {
    throw new BadRequestException("计算仓库存储量缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const warehouses = await prisma.warehouse.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, type: true, capacity: true },
  });
  const result: Record<string, number> = {};
  for (const [name, qty] of entries) {
    const wh = warehouses.find((w: any) => w.name === name);
    if (!wh) continue;
    const type = wh.type || "UNKNOWN";
    result[type] = (result[type] || 0) + toNumber(wh.capacity) * Number(qty);
  }
  return result;
}

/**
 * 仓库清单输入源的「仓库总价格」端点：按比赛查每种仓库 price × 数量 求和。
 */
export async function computeWarehouseTotalPrice(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const entries = Object.entries(raw).filter(([, q]) => Number(q) > 0);
  if (!entries.length) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算仓库总价格缺少比赛上下文（competitionId）");
  }
  const names = entries.map(([name]) => name);
  const warehouses = await prisma.warehouse.findMany({
    where: { competitionId, name: { in: names } },
    select: { name: true, price: true },
  });
  let total = 0;
  for (const [name, qty] of entries) {
    const wh = warehouses.find((w: any) => w.name === name);
    if (!wh) continue;
    total += toNumber(wh.price) * Number(qty);
  }
  return total;
}

// ========== 科技树计算 ==========

/**
 * 科技树节点输入源的「前置节点」端点：按比赛查该科技节点的前置依赖节点名列表。
 */
export async function computeTechPrerequisites(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<string[]> {
  if (!raw || typeof raw !== "string" || !raw.trim()) return [];
  if (!competitionId) {
    throw new BadRequestException("计算科技前置节点缺少比赛上下文（competitionId）");
  }
  const node = await prisma.techNode.findFirst({
    where: { competitionId, name: raw },
    include: { prerequisites: { include: { node: true } } },
  });
  if (!node) return [];
  return node.prerequisites.map((p: any) => p.node.name);
}

/**
 * 科技树节点输入源的「研发费用」端点：按比赛查该科技节点的 researchCost。
 */
export async function computeTechResearchCost(
  raw: any,
  competitionId: number | undefined,
  prisma: any,
): Promise<number> {
  if (!raw || typeof raw !== "string" || !raw.trim()) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算科技研发费用缺少比赛上下文（competitionId）");
  }
  const node = await prisma.techNode.findFirst({
    where: { competitionId, name: raw },
    select: { researchCost: true },
  });
  return node ? toNumber(node.researchCost) : 0;
}

// ========== 地图路程计算 ==========

/**
 * 计算地图路程距离：按比赛查相邻节点最短路距离之和。
 */
export async function computeRouteDistance(
  nodeIds: number[],
  competitionId: number | undefined,
  cache: Map<number, Map<number, { to: number; d: number }[]>> | undefined,
  prisma: any,
): Promise<number> {
  if (!nodeIds || nodeIds.length < 2) return 0;
  if (!competitionId) {
    throw new BadRequestException("计算路程距离缺少比赛上下文（competitionId）");
  }

  // 构建/获取邻接表
  let adj = cache?.get(competitionId);
  if (!adj) {
    const edges = await prisma.mapEdge.findMany({
      where: { competitionId },
      select: { fromNodeId: true, toNodeId: true, distance: true },
    });
    adj = new Map();
    for (const e of edges) {
      if (!adj.has(e.fromNodeId)) adj.set(e.fromNodeId, []);
      if (!adj.has(e.toNodeId)) adj.set(e.toNodeId, []);
      adj.get(e.fromNodeId)!.push({ to: e.toNodeId, d: e.distance });
      adj.get(e.toNodeId)!.push({ to: e.fromNodeId, d: e.distance });
    }
    if (!cache) cache = new Map();
    cache.set(competitionId, adj);
  }

  // 计算相邻节点距离之和
  let total = 0;
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const from = nodeIds[i];
    const to = nodeIds[i + 1];
    const neighbors = adj.get(from) || [];
    const edge = neighbors.find((n) => n.to === to);
    total += edge ? edge.d : 0;
  }
  return total;
}

/**
 * 计算路程中的路径类型：按比赛查与任一路点相连的边，取这些边所用路径类型名称，组成去重后的字符串列表。
 */
export async function computeRoutePathTypes(
  nodeIds: number[],
  competitionId: number | undefined,
  prisma: any,
): Promise<string[]> {
  if (!nodeIds || nodeIds.length === 0) return [];
  if (!competitionId) {
    throw new BadRequestException("计算路程路径类型缺少比赛上下文（competitionId）");
  }
  const edges = await prisma.mapEdge.findMany({
    where: {
      competitionId,
      OR: [
        { fromNodeId: { in: nodeIds } },
        { toNodeId: { in: nodeIds } },
      ],
    },
    include: { pathType: true },
  });
  const types = new Set<string>();
  for (const e of edges) {
    if (e.pathType) types.add(e.pathType.name);
  }
  return Array.from(types);
}

/**
 * 解析参与方所在地节点 ID
 */
export async function resolvePartyLocationNodeId(
  party: string,
  ctx: EvalCtx | undefined,
  prisma: any,
): Promise<number | null> {
  if (!ctx?.parties) return null;
  const p = ctx.parties.get(party);
  if (!p || p.isHost || p.companyId == null) return null;
  // 读取公司的「所在地」字段值
  const fieldValue = await prisma.companyFieldValue.findFirst({
    where: {
      companyId: p.companyId,
      industryField: { fieldKey: "location" },
    },
    select: { value: true },
  });
  if (!fieldValue) return null;
  // 尝试解析为数字（节点 ID）
  const n = Number(fieldValue.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 读取公司产业字段现值
 */
export async function readCompanyFieldValue(
  party: string,
  fieldKey: string,
  ctx: EvalCtx | undefined,
  prisma: any,
): Promise<any> {
  if (!ctx?.parties) return 0;
  const p = ctx.parties.get(party);
  if (!p || p.isHost || p.companyId == null) return 0;
  const fieldValue = await prisma.companyFieldValue.findFirst({
    where: {
      companyId: p.companyId,
      industryField: { fieldKey },
    },
    select: { value: true },
  });
  if (!fieldValue) return 0;
  try {
    return JSON.parse(fieldValue.value);
  } catch {
    return fieldValue.value;
  }
}
