import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CreateStockDto,
  UpdateStockDto,
  CreateFundsAccountDto,
  UpdateFundsAccountDto,
  CreateOrderDto,
  AdvanceRoundDto,
} from "./dto/stock.dto";
import { computeMatch, computePrice, buildCandle, computeInitPrice } from "./engine";
import { hasPermission } from "../../permissions/catalog";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { RealtimeService } from "../../realtime/realtime.service";
import { RegionService } from "../regions/region.service";

export interface ReqUser {
  id: number;
  role: string;
  permissions: string[];
  competitionId: number | null;
  stockCompanyScopes?: number[];
}

@Injectable()
export class StockService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private regionService: RegionService,
  ) {}

  private isSuper(user: ReqUser) {
    return user.role === "SUPER_ADMIN";
  }
  private can(user: ReqUser, perm: string) {
    return this.isSuper(user) || hasPermission(user.role, user.permissions, perm);
  }
  /** 是否为「高级管理」：可见全部账户、增删股票、推进轮次 */
  private isHighManager(user: ReqUser) {
    return this.isSuper(user) || this.can(user, "stock:manage");
  }

  /**
   * 解析绑定引用字符串（JSON {region, cardId}）。空 / 非法返回 null。
   * 非法非空串（无法解析为 {region:string, cardId:number}）视为格式错误。
   */
  private parseFieldRef(raw?: string | null): { region: string; cardId: number } | null {
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      if (v && typeof v.region === "string" && typeof v.cardId === "number") {
        return { region: v.region, cardId: v.cardId };
      }
    } catch {
      /* 解析失败 */
    }
    return null;
  }

  /**
   * 构建「区域:卡片 -> 实时值」映射，供股票绑定字段实时引用。
   * 仅当 competitionId 存在时查询；否则返回空映射（全部回退手动值）。
   */
  private async resolveFieldValueMap(competitionId?: number): Promise<Map<string, number | null>> {
    const map = new Map<string, number | null>();
    if (!competitionId) return map;
    const overview = await this.regionService.getMapOverview(competitionId);
    for (const r of overview) {
      for (const card of r.cards) {
        const key = `${r.region}:${card.id}`;
        map.set(key, card.valid && typeof card.value === "number" ? (card.value as number) : null);
      }
    }
    return map;
  }

  /** 取当前碳排有效值：绑定且卡片有值则用实时值，否则（未绑定 / 失效）用手动值。 */
  private effectiveCarbon(stock: any, map: Map<string, number | null>): number {
    const ref = this.parseFieldRef(stock.carbonFieldRef);
    if (ref) {
      const v = map.get(`${ref.region}:${ref.cardId}`);
      if (typeof v === "number") return v;
    }
    return stock.currentCarbon;
  }

  /** 取当前幸福度有效值：绑定且卡片有值则用实时值，否则用手动值。 */
  private effectiveHappiness(stock: any, map: Map<string, number | null>): number {
    const ref = this.parseFieldRef(stock.happinessFieldRef);
    if (ref) {
      const v = map.get(`${ref.region}:${ref.cardId}`);
      if (typeof v === "number") return v;
    }
    return stock.happiness;
  }

  /** 给股票对象附加有效碳排 / 幸福度（绑定字段时取实时值）。 */
  private decorateEffective(stock: any, map: Map<string, number | null>): any {
    return {
      ...stock,
      effectiveCurrentCarbon: this.effectiveCarbon(stock, map),
      effectiveHappiness: this.effectiveHappiness(stock, map),
    };
  }

  /**
   * 解析当前用户可操作的资金账户 id 集合。
   *  - 超管 / 高级管理(stock:manage)：返回 null（代表全部账户）。
   *  - 低级管理(stock:edit)：仅自己名下的用户账户 + stockCompanyScopes 内公司的账户。
   *  - 仅有查看(stock:view)：仅自己名下的用户账户（可买卖自己的账户）。
   * 返回 number[]（可能为空）表示「仅这些账户」。
   */
  private async getOperableAccountIds(
    user: ReqUser,
    competitionId: number,
  ): Promise<number[] | null> {
    if (this.isHighManager(user)) return null;
    const scopes = user.stockCompanyScopes && user.stockCompanyScopes.length ? user.stockCompanyScopes : [];
    const accounts = await this.prisma.stockFundsAccount.findMany({
      where: {
        competitionId,
        OR: [{ ownerType: "USER", userId: user.id }, { ownerType: "COMPANY", companyId: { in: scopes } }],
      },
      select: { id: true },
    });
    return accounts.map((a) => a.id);
  }

  private assertAccountOperable(account: { ownerType: string; userId: number | null; companyId: number | null }, user: ReqUser) {
    if (this.isHighManager(user)) return;
    const scopes = user.stockCompanyScopes && user.stockCompanyScopes.length ? user.stockCompanyScopes : [];
    const own =
      (account.ownerType === "USER" && account.userId === user.id) ||
      (account.ownerType === "COMPANY" && account.companyId != null && scopes.includes(account.companyId));
    if (!own) throw new ForbiddenException("无权操作该资金账户");
  }

  // ---------------- 股票 ----------------

  async findAllStocks(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    const fieldMap = await this.resolveFieldValueMap(competitionId);
    const decorate = (items: any[]) => items.map((s) => this.decorateEffective(s, fieldMap));
    if (incremental) {
      const items = await this.prisma.stock.findMany({ where, orderBy: { code: "asc" } });
      const decorated = decorate(items);
      const existingIds = requireExistingIds
        ? (await this.prisma.stock.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(decorated, existingIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.stock.findMany({ where, skip, take: pageSize, orderBy: { code: "asc" } }),
      this.prisma.stock.count({ where }),
    ]);
    return { items: decorate(items), total, page, pageSize };
  }

  async findOneStock(id: number) {
    const item = await this.prisma.stock.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("股票不存在");
    return item;
  }

  async getCandles(stockId: number) {
    const stock = await this.findOneStock(stockId);
    const candles = await this.prisma.stockCandle.findMany({
      where: { stockId, competitionId: stock.competitionId ?? undefined },
      orderBy: { round: "asc" },
    });
    return { stock, candles };
  }

  async createStock(user: ReqUser, dto: CreateStockDto) {
    if (!this.isHighManager(user)) throw new ForbiddenException("仅高级管理可增删股票");
    const competitionId = dto.competitionId ?? user.competitionId;
    if (!competitionId) throw new BadRequestException("缺少比赛上下文");
    const existing = await this.prisma.stock.findFirst({ where: { competitionId, code: dto.code } });
    if (existing) throw new ConflictException("股票代码已存在");
    // 校验绑定引用格式（非空但非法则拒绝）
    if (dto.carbonFieldRef && !this.parseFieldRef(dto.carbonFieldRef)) {
      throw new BadRequestException("carbonFieldRef 格式非法，应为 JSON {region, cardId}");
    }
    if (dto.happinessFieldRef && !this.parseFieldRef(dto.happinessFieldRef)) {
      throw new BadRequestException("happinessFieldRef 格式非法，应为 JSON {region, cardId}");
    }
    const initPrice = computeInitPrice(dto.initNetProfit, dto.totalShares, dto.industryPE);
    const stock = await this.prisma.stock.create({
      data: {
        code: dto.code,
        name: dto.name,
        totalShares: dto.totalShares,
        initNetProfit: dto.initNetProfit,
        industryPE: dto.industryPE,
        currentCarbon: dto.currentCarbon,
        industryAvgCarbon: dto.industryAvgCarbon,
        happiness: dto.happiness,
        carbonFieldRef: dto.carbonFieldRef ?? null,
        happinessFieldRef: dto.happinessFieldRef ?? null,
        initPrice,
        currentPrice: initPrice,
        round: 0,
        companyId: dto.companyId ?? null,
        competitionId,
      },
    });
    this.realtime.emitResourceChanged("stocks", stock.id, competitionId, "created");
    return stock;
  }

  async updateStock(user: ReqUser, id: number, dto: UpdateStockDto) {
    if (!this.isHighManager(user)) throw new ForbiddenException("仅高级管理可增删股票");
    const item = await this.findOneStock(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.companyId !== undefined) data.companyId = dto.companyId;
    if (dto.currentCarbon !== undefined) data.currentCarbon = dto.currentCarbon;
    if (dto.industryAvgCarbon !== undefined) data.industryAvgCarbon = dto.industryAvgCarbon;
    if (dto.happiness !== undefined) data.happiness = dto.happiness;
    if (dto.carbonFieldRef !== undefined) {
      if (dto.carbonFieldRef && !this.parseFieldRef(dto.carbonFieldRef)) {
        throw new BadRequestException("carbonFieldRef 格式非法，应为 JSON {region, cardId}");
      }
      data.carbonFieldRef = dto.carbonFieldRef ?? null;
    }
    if (dto.happinessFieldRef !== undefined) {
      if (dto.happinessFieldRef && !this.parseFieldRef(dto.happinessFieldRef)) {
        throw new BadRequestException("happinessFieldRef 格式非法，应为 JSON {region, cardId}");
      }
      data.happinessFieldRef = dto.happinessFieldRef ?? null;
    }
    // 修改股本 / 净利润 / 行业 PE 会重算初始价
    const recompute =
      dto.totalShares !== undefined || dto.initNetProfit !== undefined || dto.industryPE !== undefined;
    if (recompute) {
      const totalShares = dto.totalShares ?? item.totalShares;
      const initNetProfit = dto.initNetProfit ?? item.initNetProfit;
      const industryPE = dto.industryPE ?? item.industryPE;
      data.initPrice = computeInitPrice(initNetProfit, totalShares, industryPE);
    }
    if (dto.totalShares !== undefined) data.totalShares = dto.totalShares;
    if (dto.initNetProfit !== undefined) data.initNetProfit = dto.initNetProfit;
    if (dto.industryPE !== undefined) data.industryPE = dto.industryPE;
    const updated = await this.prisma.stock.update({ where: { id }, data });
    this.realtime.emitResourceChanged("stocks", updated.id, updated.competitionId ?? null, "updated");
    return updated;
  }

  async removeStock(user: ReqUser, id: number, competitionId?: number) {
    if (!this.isHighManager(user)) throw new ForbiddenException("仅高级管理可增删股票");
    const item = await this.findOneStock(id);
    assertSameCompetition(item.competitionId, competitionId);
    const orderCount = await this.prisma.stockOrder.count({ where: { stockId: id } });
    const holdingCount = await this.prisma.stockHolding.count({ where: { stockId: id } });
    if (orderCount > 0 || holdingCount > 0) {
      throw new BadRequestException("该股票仍有挂单或持仓，无法删除");
    }
    await this.prisma.stock.delete({ where: { id } });
    this.realtime.emitResourceChanged("stocks", id, item.competitionId ?? null, "deleted");
    return { message: "已删除" };
  }

  // ---------------- 资金账户 ----------------

  async findAllFundsAccounts(user: ReqUser, competitionId: number) {
    const operable = await this.getOperableAccountIds(user, competitionId);
    const where: Record<string, unknown> = { competitionId };
    if (operable) where.id = { in: operable };
    const accounts = await this.prisma.stockFundsAccount.findMany({ where, orderBy: { name: "asc" } });
    return accounts;
  }

  async findOneFundsAccount(user: ReqUser, id: number) {
    const account = await this.prisma.stockFundsAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("资金账户不存在");
    if (this.isHighManager(user)) return account;
    this.assertAccountOperable(account, user);
    return account;
  }

  async getAccountHoldings(user: ReqUser, accountId: number) {
    const account = await this.findOneFundsAccount(user, accountId);
    const holdings = await this.prisma.stockHolding.findMany({
      where: { fundsAccountId: accountId, competitionId: account.competitionId ?? undefined },
      include: { stock: { select: { id: true, code: true, name: true, currentPrice: true } } },
    });
    return holdings.map((h) => ({
      ...h,
      marketValue: Math.round(h.shares * h.stock.currentPrice * 100) / 100,
    }));
  }

  async createFundsAccount(user: ReqUser, dto: CreateFundsAccountDto) {
    if (!this.can(user, "stock:edit")) throw new ForbiddenException("无股票管理权限");
    const competitionId = dto.competitionId ?? user.competitionId;
    if (!competitionId) throw new BadRequestException("缺少比赛上下文");
    const existing = await this.prisma.stockFundsAccount.findFirst({ where: { competitionId, name: dto.name } });
    if (existing) throw new ConflictException("资金账户名已存在");

    let ownerType = dto.ownerType;
    let companyId = dto.companyId ?? null;
    let userId = dto.userId ?? null;
    if (ownerType === "USER") {
      userId = userId ?? user.id;
      companyId = null;
      // 低级管理只能建自己的用户账户
      if (!this.isHighManager(user) && userId !== user.id) {
        throw new ForbiddenException("只能为自己创建用户资金账户");
      }
    } else {
      if (!companyId) throw new BadRequestException("公司账户必须指定 companyId");
      // 低级管理只能建自己范围内的公司账户
      if (!this.isHighManager(user)) {
        const scopes = user.stockCompanyScopes && user.stockCompanyScopes.length ? user.stockCompanyScopes : [];
        if (!scopes.includes(companyId)) throw new ForbiddenException("只能为权限范围内的公司创建资金账户");
      }
    }
    const account = await this.prisma.stockFundsAccount.create({
      data: {
        name: dto.name,
        ownerType,
        companyId,
        userId,
        cashBalance: dto.cashBalance ?? 1000000,
        competitionId,
      },
    });
    this.realtime.emitResourceChanged("stocks", account.id, competitionId, "created");
    return account;
  }

  async updateFundsAccount(user: ReqUser, id: number, dto: UpdateFundsAccountDto) {
    if (!this.can(user, "stock:edit")) throw new ForbiddenException("无股票管理权限");
    const account = await this.prisma.stockFundsAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("资金账户不存在");
    this.assertAccountOperable(account, user);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.cashBalance !== undefined) data.cashBalance = dto.cashBalance;
    if (dto.companyId !== undefined) data.companyId = dto.companyId;
    if (dto.userId !== undefined) data.userId = dto.userId;
    const updated = await this.prisma.stockFundsAccount.update({ where: { id }, data });
    this.realtime.emitResourceChanged("stocks", updated.id, updated.competitionId ?? null, "updated");
    return updated;
  }

  async removeFundsAccount(user: ReqUser, id: number) {
    if (!this.can(user, "stock:edit")) throw new ForbiddenException("无股票管理权限");
    const account = await this.prisma.stockFundsAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("资金账户不存在");
    this.assertAccountOperable(account, user);
    const holdingCount = await this.prisma.stockHolding.count({ where: { fundsAccountId: id } });
    const orderCount = await this.prisma.stockOrder.count({ where: { fundsAccountId: id, status: "PENDING" } });
    if (holdingCount > 0) throw new BadRequestException("该账户仍有持仓，无法删除");
    if (orderCount > 0) throw new BadRequestException("该账户仍有挂单，无法删除");
    await this.prisma.stockFundsAccount.delete({ where: { id } });
    this.realtime.emitResourceChanged("stocks", id, account.competitionId ?? null, "deleted");
    return { message: "已删除" };
  }

  // ---------------- 订单 ----------------

  async findOrders(user: ReqUser, competitionId: number, stockId?: number) {
    const operable = await this.getOperableAccountIds(user, competitionId);
    const where: Record<string, unknown> = { competitionId };
    if (stockId) where.stockId = stockId;
    if (operable) where.fundsAccountId = { in: operable };
    return this.prisma.stockOrder.findMany({ where, orderBy: { createdAt: "desc" }, include: { stock: { select: { code: true, name: true } } } });
  }

  async placeOrder(user: ReqUser, dto: CreateOrderDto) {
    if (!this.can(user, "stock:view")) throw new ForbiddenException("无股票查看/交易权限");
    const stock = await this.findOneStock(dto.stockId);
    const competitionId = stock.competitionId ?? user.competitionId;
    if (!competitionId) throw new BadRequestException("缺少比赛上下文");
    const account = await this.prisma.stockFundsAccount.findUnique({ where: { id: dto.fundsAccountId } });
    if (!account || account.competitionId !== competitionId) throw new NotFoundException("资金账户不存在");
    if (this.isHighManager(user)) {
      // 高级管理可代任意账户下单
    } else {
      this.assertAccountOperable(account, user);
    }
    if (dto.side === "BUY") {
      const need = dto.price * dto.quantity;
      if (account.cashBalance < need - 1e-6) throw new BadRequestException("现金余额不足");
    } else {
      const holding = await this.prisma.stockHolding.findUnique({
        where: { fundsAccountId_stockId: { fundsAccountId: account.id, stockId: stock.id } },
      });
      if (!holding || holding.shares < dto.quantity - 1e-9) throw new BadRequestException("持仓不足");
    }
    const order = await this.prisma.stockOrder.create({
      data: {
        stockId: stock.id,
        fundsAccountId: account.id,
        side: dto.side,
        price: dto.price,
        quantity: dto.quantity,
        amount: Math.round(dto.price * dto.quantity * 100) / 100,
        status: "PENDING",
        round: stock.round,
        competitionId,
      },
    });
    this.realtime.emitResourceChanged("stocks", order.id, competitionId, "created");
    return order;
  }

  async cancelOrder(user: ReqUser, id: number) {
    if (!this.can(user, "stock:view")) throw new ForbiddenException("无股票查看/交易权限");
    const order = await this.prisma.stockOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException("订单不存在");
    const account = await this.prisma.stockFundsAccount.findUnique({ where: { id: order.fundsAccountId } });
    if (!account) throw new NotFoundException("资金账户不存在");
    if (!this.isHighManager(user)) this.assertAccountOperable(account, user);
    if (order.status !== "PENDING") throw new BadRequestException("仅可撤销挂单");
    const updated = await this.prisma.stockOrder.update({ where: { id }, data: { status: "CANCELLED" } });
    this.realtime.emitResourceChanged("stocks", id, order.competitionId ?? null, "updated");
    return updated;
  }

  // ---------------- 持仓 ----------------

  async findHoldings(user: ReqUser, competitionId: number, accountId?: number) {
    const operable = await this.getOperableAccountIds(user, competitionId);
    const where: Record<string, unknown> = { competitionId };
    if (accountId) where.fundsAccountId = accountId;
    if (operable && !accountId) where.fundsAccountId = { in: operable };
    const holdings = await this.prisma.stockHolding.findMany({
      where,
      include: { stock: { select: { id: true, code: true, name: true, currentPrice: true } } },
    });
    return holdings.map((h) => ({
      ...h,
      marketValue: Math.round(h.shares * h.stock.currentPrice * 100) / 100,
    }));
  }

  // ---------------- 推进轮次 ----------------

  async advanceRound(user: ReqUser, competitionId: number, dto: AdvanceRoundDto = {}) {
    if (!this.isHighManager(user)) throw new ForbiddenException("仅高级管理可推进轮次");
    const where: Record<string, unknown> = { competitionId };
    if (dto.stockIds && dto.stockIds.length) where.id = { in: dto.stockIds };
    const stocks = await this.prisma.stock.findMany({ where });
    const fieldMap = await this.resolveFieldValueMap(competitionId);
    const results: any[] = [];
    for (const stock of stocks) {
      const r = await this.advanceOneStock(stock, competitionId, fieldMap);
      if (r) results.push(r);
    }
    this.realtime.broadcastToCompetition(competitionId, "stock:round-advanced", { competitionId, count: results.length });
    return { advanced: results.length, results };
  }

  private async advanceOneStock(stock: any, competitionId: number, fieldMap: Map<string, number | null>) {
    const orders = await this.prisma.stockOrder.findMany({
      where: { stockId: stock.id, competitionId, round: stock.round, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { fundsAccount: true },
    });
    if (orders.length === 0) return null;

    const match = computeMatch(
      orders.map((o) => ({ side: o.side as "BUY" | "SELL", price: o.price, quantity: o.quantity })),
    );
    const price = computePrice({
      lastClose: stock.currentPrice,
      buyAmount: match.totalBuyAmount,
      sellAmount: match.totalSellAmount,
      happiness: this.effectiveHappiness(stock, fieldMap),
      currentCarbon: this.effectiveCarbon(stock, fieldMap),
      industryAvgCarbon: stock.industryAvgCarbon,
    });

    // 账户现金 / 持仓运行时快照（撮合过程中实时扣减）
    const cashMap = new Map<number, number>();
    const holdingMap = new Map<number, { shares: number; costPrice: number }>();
    for (const o of orders) {
      if (!cashMap.has(o.fundsAccountId)) cashMap.set(o.fundsAccountId, o.fundsAccount.cashBalance);
    }
    const accountIds = Array.from(cashMap.keys());
    const existingHoldings = await this.prisma.stockHolding.findMany({
      where: { stockId: stock.id, fundsAccountId: { in: accountIds } },
    });
    for (const h of existingHoldings) {
      holdingMap.set(h.fundsAccountId, { shares: h.shares, costPrice: h.costPrice });
    }
    const touchedAccounts = new Set<number>();

    const buys = orders.filter((o) => o.side === "BUY").sort((a, b) => b.price - a.price || a.createdAt.getTime() - b.createdAt.getTime());
    const sells = orders.filter((o) => o.side === "SELL").sort((a, b) => a.price - b.price || a.createdAt.getTime() - b.createdAt.getTime());
    const buyRem = new Map<number, number>(buys.map((o) => [o.id, o.quantity]));
    const sellRem = new Map<number, number>(sells.map((o) => [o.id, o.quantity]));
    const filled = new Map<number, number>();
    const tradePrice = match.tradePrice!;

    let bi = 0;
    let si = 0;
    const EPS = 1e-9;
    while (bi < buys.length && si < sells.length) {
      const buy = buys[bi];
      const sell = sells[si];
      if (buy.price < sell.price) break;
      let qty = Math.min(buyRem.get(buy.id)!, sellRem.get(sell.id)!);
      const buyCash = cashMap.get(buy.fundsAccountId)!;
      if (qty * tradePrice > buyCash + EPS) {
        qty = buyCash / tradePrice;
        if (qty <= EPS) {
          buyRem.set(buy.id, 0);
          bi++;
          continue;
        }
      }
      const sellHold = holdingMap.get(sell.fundsAccountId);
      const sellShares = sellHold ? sellHold.shares : 0;
      if (qty > sellShares + EPS) {
        qty = sellShares;
        if (qty <= EPS) {
          sellRem.set(sell.id, 0);
          si++;
          continue;
        }
      }
      qty = Math.round(qty * 1e6) / 1e6;

      // 买入方：现金减少，持仓增加（加权成本）
      cashMap.set(buy.fundsAccountId, cashMap.get(buy.fundsAccountId)! - qty * tradePrice);
      const bh = holdingMap.get(buy.fundsAccountId) ?? { shares: 0, costPrice: 0 };
      const newShares = bh.shares + qty;
      const newCost = newShares > 0 ? (bh.shares * bh.costPrice + qty * tradePrice) / newShares : tradePrice;
      holdingMap.set(buy.fundsAccountId, { shares: newShares, costPrice: newCost });
      // 卖出方：现金增加，持仓减少
      cashMap.set(sell.fundsAccountId, cashMap.get(sell.fundsAccountId)! + qty * tradePrice);
      const sh = holdingMap.get(sell.fundsAccountId) ?? { shares: 0, costPrice: 0 };
      holdingMap.set(sell.fundsAccountId, { shares: Math.max(0, sh.shares - qty), costPrice: sh.costPrice });

      touchedAccounts.add(buy.fundsAccountId);
      touchedAccounts.add(sell.fundsAccountId);
      filled.set(buy.id, (filled.get(buy.id) ?? 0) + qty);
      filled.set(sell.id, (filled.get(sell.id) ?? 0) + qty);

      buyRem.set(buy.id, buyRem.get(buy.id)! - qty);
      sellRem.set(sell.id, sellRem.get(sell.id)! - qty);
      if (buyRem.get(buy.id)! <= EPS) bi++;
      if (sellRem.get(sell.id)! <= EPS) si++;
    }

    const candle = buildCandle(stock.currentPrice, price.final, stock.round + 1);
    const newRound = stock.round + 1;

    await this.prisma.$transaction(async (tx) => {
      // 现金
      for (const [accId, cash] of cashMap) {
        await tx.stockFundsAccount.update({ where: { id: accId }, data: { cashBalance: Math.round(cash * 100) / 100 } });
      }
      // 持仓（仅被撮合涉及的账户）
      for (const accId of touchedAccounts) {
        const h = holdingMap.get(accId)!;
        if (h.shares > EPS) {
          await tx.stockHolding.upsert({
            where: { fundsAccountId_stockId: { fundsAccountId: accId, stockId: stock.id } },
            create: { fundsAccountId: accId, stockId: stock.id, shares: h.shares, costPrice: h.costPrice, competitionId },
            update: { shares: h.shares, costPrice: h.costPrice },
          });
        } else {
          await tx.stockHolding.deleteMany({ where: { fundsAccountId: accId, stockId: stock.id } });
        }
      }
      // 订单状态
      for (const o of orders) {
        const f = filled.get(o.id) ?? 0;
        const status = f > EPS ? "FILLED" : "CANCELLED";
        await tx.stockOrder.update({ where: { id: o.id }, data: { status } });
      }
      // K 线
      await tx.stockCandle.create({ data: { ...candle, stockId: stock.id, competitionId } });
      // 股票价 / 轮次
      await tx.stock.update({ where: { id: stock.id }, data: { currentPrice: price.final, round: newRound } });
    });

    this.realtime.emitResourceChanged("stocks", stock.id, competitionId, "updated");
    this.realtime.emitResourceChanged("stocks", stock.id, competitionId, "created");
    this.realtime.emitResourceChanged("stocks", stock.id, competitionId, "bulk");
    this.realtime.emitResourceChanged("stocks", stock.id, competitionId, "bulk");
    this.realtime.emitResourceChanged("stocks", stock.id, competitionId, "bulk");

    return { stockId: stock.id, code: stock.code, tradePrice, finalPrice: price.final, candle, matched: match.matched };
  }
}
