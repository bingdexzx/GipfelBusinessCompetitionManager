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
   * cardId 为区域总览卡片 id（字符串，如 "c-1690000000000-123"），兼容历史数字写法（自动转为字符串）。
   * 非法非空串（无法解析为 {region:string, cardId:string|number}）视为格式错误。
   */
  private parseFieldRef(raw?: string | null): { region: string; cardId: string } | null {
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      const region = v?.region;
      const cardId = v?.cardId;
      if (typeof region === "string" && (typeof cardId === "string" || typeof cardId === "number")) {
        return { region, cardId: String(cardId) };
      }
    } catch {
      /* 解析失败 */
    }
    return null;
  }

  /**
   * 解析绑定引用数组字符串（JSON [{region, cardId}, ...]）。空 / 非法返回 []。
   * 用于行业碳排均值「多字段绑定」：对多个区域总览字段取平均值。
   */
  private parseFieldRefs(raw?: string | null): { region: string; cardId: string }[] {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      if (!Array.isArray(v)) return [];
      return v
        .filter(
          (x: any) =>
            x &&
            typeof x.region === "string" &&
            (typeof x.cardId === "string" || typeof x.cardId === "number"),
        )
        .map((x: any) => ({ region: x.region, cardId: String(x.cardId) }));
    } catch {
      return [];
    }
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
        // 卡片值可能以字符串形式存储数字（CompanyFieldValue.value 为 String 列，NUMBER 字段存如 "50"），
        // 需解析为 number 才能命中 effective 取值；否则会静默回退到手动值，导致列表显示的绑定值与弹窗不一致。
        let val: number | null = null;
        if (card.valid && card.value != null) {
          const n = typeof card.value === "number" ? card.value : Number(card.value);
          val = Number.isFinite(n) ? n : null;
        }
        map.set(key, val);
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

  /**
   * 取行业碳排均值有效值：绑定多个区域总览字段时取「有效值的平均值」；
   * 无有效绑定值（未绑定 / 全部失效 / 无值）时回退手动值 industryAvgCarbon。
   */
  private effectiveIndustryAvgCarbon(stock: any, map: Map<string, number | null>): number {
    const refs = this.parseFieldRefs(stock.industryAvgCarbonRefs);
    const vals: number[] = [];
    for (const ref of refs) {
      const v = map.get(`${ref.region}:${ref.cardId}`);
      if (typeof v === "number") vals.push(v);
    }
    if (vals.length) {
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      return Math.round(avg * 100) / 100;
    }
    return stock.industryAvgCarbon;
  }

  /** 给股票对象附加有效碳排 / 幸福度 / 行业碳排均值（绑定字段时取实时值）与有效 PE。 */
  private decorateEffective(stock: any, map: Map<string, number | null>, pbMap?: Map<number, number>): any {
    return {
      ...stock,
      effectiveCurrentCarbon: this.effectiveCarbon(stock, map),
      effectiveHappiness: this.effectiveHappiness(stock, map),
      effectiveIndustryAvgCarbon: this.effectiveIndustryAvgCarbon(stock, map),
      effectivePb: pbMap?.get(stock.id) ?? stock.industryPE,
      pbMode: stock.pbCompanyId && stock.pbFieldId ? "linked" : "random",
    };
  }

  // ---------------- 行业 PE 动态化 ----------------

  /** 将 PE 值钳制到 [0, 20] 并保留两位小数。 */
  private clampPb(v: number): number {
    if (!Number.isFinite(v)) return this.randomPb();
    const c = Math.min(20, Math.max(0, v));
    return Math.round(c * 100) / 100;
  }

  /** 生成一个 0~20 的随机 PE（保留两位小数）。 */
  private randomPb(): number {
    return Math.round(Math.random() * 20 * 100) / 100;
  }

  /**
   * 解析股票的有效 PE 与联动字段。
   * - 联动模式（pbCompanyId + pbFieldId 同时非空）：PE 取该公司产业字段实时值，pbRandom 置空。
   * - 随机模式（二者均空）：PE 取自 pbRandom（dto.pbRandom 优先，其次 dto.industryPE 作种子，否则沿用/随机生成）。
   * item 为 null 表示创建；否则表示原有股票（用于沿用未变更的字段与随机源）。
   */
  private async computePbData(item: any | null, dto: any): Promise<{
    industryPE: number;
    pbCompanyId: number | null;
    pbFieldId: number | null;
    pbRandom: number | null;
  }> {
    const pbCompanyId = dto.pbCompanyId !== undefined ? (dto.pbCompanyId ?? null) : (item?.pbCompanyId ?? null);
    const pbFieldId = dto.pbFieldId !== undefined ? (dto.pbFieldId ?? null) : (item?.pbFieldId ?? null);

    if ((pbCompanyId && !pbFieldId) || (!pbCompanyId && pbFieldId)) {
      throw new BadRequestException("PE 联动需同时选择公司与绑定字段，或二者均不填（随机模式）");
    }

    let pbRandom: number | null = item?.pbRandom ?? null;
    let industryPE: number;

    if (pbCompanyId && pbFieldId) {
      const company = await this.prisma.company.findUnique({
        where: { id: pbCompanyId },
        select: { industryTypeId: true },
      });
      const field = await this.prisma.industryField.findUnique({
        where: { id: pbFieldId },
        select: { industryTypeId: true },
      });
      if (!company || !field || company.industryTypeId !== field.industryTypeId) {
        throw new BadRequestException("绑定的产业字段不属于该公司所属产业类型");
      }
      const fv = await this.prisma.companyFieldValue.findFirst({
        where: { companyId: pbCompanyId, industryFieldId: pbFieldId },
      });
      const v = fv?.value != null ? Number(fv.value) : NaN;
      industryPE = Number.isFinite(v) && v > 0 ? v : (item?.industryPE ?? this.randomPb());
      pbRandom = null; // 联动模式不使用随机源
    } else {
      let seed: number | null = null;
      if (dto.pbRandom !== undefined && dto.pbRandom !== null) seed = dto.pbRandom;
      else if (dto.industryPE !== undefined && dto.industryPE !== null) seed = dto.industryPE;
      else if (pbRandom === null) seed = this.randomPb();
      pbRandom = seed !== null ? this.clampPb(seed) : this.randomPb();
      industryPE = pbRandom;
    }

    return { industryPE, pbCompanyId, pbFieldId, pbRandom };
  }

  /** 批量计算股票的有效 PE：联动模式读实时字段值，随机模式用缓存 industryPE。 */
  private async resolveEffectivePbs(stocks: any[]): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    const linked = stocks.filter((s) => s.pbCompanyId && s.pbFieldId);
    if (linked.length) {
      const companyIds = [...new Set(linked.map((s) => s.pbCompanyId))];
      const fieldIds = [...new Set(linked.map((s) => s.pbFieldId))];
      const fvs = await this.prisma.companyFieldValue.findMany({
        where: { companyId: { in: companyIds }, industryFieldId: { in: fieldIds } },
      });
      const valMap = new Map<string, number>();
      for (const fv of fvs) {
        const n = fv.value != null ? Number(fv.value) : NaN;
        if (Number.isFinite(n)) valMap.set(`${fv.companyId}:${fv.industryFieldId}`, n);
      }
      for (const s of linked) {
        const v = valMap.get(`${s.pbCompanyId}:${s.pbFieldId}`);
        map.set(s.id, v != null ? v : s.industryPE);
      }
    }
    for (const s of stocks) {
      if (!map.has(s.id)) map.set(s.id, s.industryPE);
    }
    return map;
  }

  /**
   * 推进一轮时更新 PE 并据最新有效 PE 实时重算初始价：
   * - 联动模式刷新实时字段值；
   * - 随机模式做 ±2 随机游走并钳制到 [0,20]。
   * 两种模式下初始价均按 computeInitPrice(净利润, 总股本, 有效PE) 实时重算（满足"每轮根据字段数据重算初始价"需求）。
   */
  private async applyPbRound(stock: any): Promise<void> {
    let industryPE: number;
    let pbRandom: number | null = stock.pbRandom ?? null;
    if (stock.pbCompanyId && stock.pbFieldId) {
      const fv = await this.prisma.companyFieldValue.findFirst({
        where: { companyId: stock.pbCompanyId, industryFieldId: stock.pbFieldId },
      });
      const v = fv?.value != null ? Number(fv.value) : NaN;
      industryPE = Number.isFinite(v) && v > 0 ? v : stock.industryPE;
      pbRandom = null;
    } else {
      const prev = stock.pbRandom ?? this.randomPb();
      const step = Math.random() * 4 - 2; // [-2, 2]
      const next = this.clampPb(prev + step);
      industryPE = next;
      pbRandom = next;
    }
    // 每轮根据当轮有效 PE 实时重算初始价
    const initPrice = computeInitPrice(stock.initNetProfit, stock.totalShares, industryPE);
    const data: Record<string, unknown> = { industryPE, initPrice };
    if (pbRandom !== (stock.pbRandom ?? null)) data.pbRandom = pbRandom;
    await this.prisma.stock.update({ where: { id: stock.id }, data });
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
    if (incremental) {
      const items = await this.prisma.stock.findMany({ where, orderBy: { code: "asc" } });
      const pbMap = await this.resolveEffectivePbs(items);
      const decorated = items.map((s) => this.decorateEffective(s, fieldMap, pbMap));
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
    const pbMap = await this.resolveEffectivePbs(items);
    return { items: items.map((s) => this.decorateEffective(s, fieldMap, pbMap)), total, page, pageSize };
  }

  /** PE 联动下拉数据源：返回比赛内公司及其可绑定的数值型产业字段。 */
  async listPbSources(competitionId?: number): Promise<{ companies: any[] }> {
    if (!competitionId) return { companies: [] };
    const companies = await this.prisma.company.findMany({
      where: { competitionId },
      select: { id: true, name: true, industryTypeId: true },
      orderBy: { name: "asc" },
    });
    const result: any[] = [];
    for (const c of companies) {
      // 无产业类型的公司没有可绑定字段，直接给空字段列表（同时避免 industryTypeId 为 null 触发的类型错误）
      if (c.industryTypeId == null) {
        result.push({ id: c.id, name: c.name, industryTypeId: null, fields: [] });
        continue;
      }
      const fields = await this.prisma.industryField.findMany({
        where: { industryTypeId: c.industryTypeId, fieldType: "NUMBER" },
        select: { id: true, fieldKey: true, name: true, fieldType: true },
        orderBy: { sortOrder: "asc" },
      });
      result.push({ id: c.id, name: c.name, industryTypeId: c.industryTypeId, fields });
    }
    return { companies: result };
  }

  async findOneStock(id: number) {
    const item = await this.prisma.stock.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("股票不存在");
    const pbMap = await this.resolveEffectivePbs([item]);
    return this.decorateEffective(item, new Map(), pbMap);
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
    // 行业碳排均值多字段绑定：非空但非法（非数组或含非法项）则拒绝。
    if (dto.industryAvgCarbonRefs && this.parseFieldRefs(dto.industryAvgCarbonRefs).length === 0) {
      throw new BadRequestException("industryAvgCarbonRefs 格式非法，应为 JSON [{region, cardId}, ...]");
    }
    const pb = await this.computePbData(null, dto);
    const initPrice = computeInitPrice(dto.initNetProfit, dto.totalShares, pb.industryPE);
    const stock = await this.prisma.stock.create({
      data: {
        code: dto.code,
        name: dto.name,
        totalShares: dto.totalShares,
        initNetProfit: dto.initNetProfit,
        industryPE: pb.industryPE,
        currentCarbon: dto.currentCarbon,
        industryAvgCarbon: dto.industryAvgCarbon,
        happiness: dto.happiness,
        carbonFieldRef: dto.carbonFieldRef ?? null,
        happinessFieldRef: dto.happinessFieldRef ?? null,
        industryAvgCarbonRefs: dto.industryAvgCarbonRefs ?? null,
        pbCompanyId: pb.pbCompanyId,
        pbFieldId: pb.pbFieldId,
        pbRandom: pb.pbRandom,
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
    if (dto.industryAvgCarbonRefs !== undefined) {
      if (dto.industryAvgCarbonRefs && this.parseFieldRefs(dto.industryAvgCarbonRefs).length === 0) {
        throw new BadRequestException("industryAvgCarbonRefs 格式非法，应为 JSON [{region, cardId}, ...]");
      }
      data.industryAvgCarbonRefs = dto.industryAvgCarbonRefs ?? null;
    }
    // 行业 PE 联动 / 随机：变更时重新解析有效 PE 并写入 industryPE（按需求不重算初始价）
    const pbChanged =
      dto.pbCompanyId !== undefined || dto.pbFieldId !== undefined || dto.pbRandom !== undefined;
    let effectivePE = item.industryPE;
    if (pbChanged) {
      const pb = await this.computePbData(item, dto);
      data.pbCompanyId = pb.pbCompanyId;
      data.pbFieldId = pb.pbFieldId;
      data.pbRandom = pb.pbRandom;
      data.industryPE = pb.industryPE;
      effectivePE = pb.industryPE;
    }
    // 修改股本 / 净利润会重算初始价（行业 PE 现由 PE 联动/随机派生，重算时取最新有效 PE）
    if (dto.totalShares !== undefined || dto.initNetProfit !== undefined) {
      const totalShares = dto.totalShares ?? item.totalShares;
      const initNetProfit = dto.initNetProfit ?? item.initNetProfit;
      data.initPrice = computeInitPrice(initNetProfit, totalShares, effectivePE);
    }
    if (dto.totalShares !== undefined) data.totalShares = dto.totalShares;
    if (dto.initNetProfit !== undefined) data.initNetProfit = dto.initNetProfit;
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
    const where: Record<string, unknown> = { competitionId, name: { not: "AI做市商" } };
    if (operable) where.id = { in: operable };
    const accounts = await this.prisma.stockFundsAccount.findMany({ where, orderBy: { name: "asc" } });
    // 为绑定了字段的账户附加字段余额，并同步 cashBalance
    const result: any[] = [];
    for (const acc of accounts) {
      if (acc.bindFieldId && acc.companyId) {
        const fv = await this.prisma.companyFieldValue.findFirst({
          where: { companyId: acc.companyId, industryFieldId: acc.bindFieldId },
        });
        const fieldBalance = fv?.value != null ? Number(fv.value) : null;
        // 同步 cashBalance，避免其他接口读到旧值
        if (fieldBalance != null && fieldBalance !== acc.cashBalance) {
          await this.prisma.stockFundsAccount.update({
            where: { id: acc.id },
            data: { cashBalance: fieldBalance },
          });
          acc.cashBalance = fieldBalance;
        }
        result.push({ ...acc, fieldBalance });
      } else {
        result.push({ ...acc, fieldBalance: null });
      }
    }
    return result;
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
    let bindFieldId = dto.bindFieldId ?? null;
    let cashBalance = dto.cashBalance ?? 1000000;

    if (ownerType === "USER") {
      userId = userId ?? user.id;
      companyId = null;
      bindFieldId = null; // 个人账户不绑定字段
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
      // 如果绑定了字段，获取字段值作为初始现金
      if (bindFieldId) {
        const fv = await this.prisma.companyFieldValue.findFirst({
          where: { companyId, industryFieldId: bindFieldId },
        });
        if (fv?.value != null) {
          cashBalance = Number(fv.value);
        }
      }
    }
    const account = await this.prisma.stockFundsAccount.create({
      data: {
        name: dto.name,
        ownerType,
        companyId,
        userId,
        cashBalance,
        bindFieldId,
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
    if (account.name === "AI做市商") throw new BadRequestException("做市商账户不可修改");
    this.assertAccountOperable(account, user);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.cashBalance !== undefined) data.cashBalance = dto.cashBalance;
    if (dto.companyId !== undefined) data.companyId = dto.companyId;
    if (dto.userId !== undefined) data.userId = dto.userId;
    if (dto.bindFieldId !== undefined) {
      data.bindFieldId = dto.bindFieldId;
      // 如果绑定了字段，获取字段值更新现金
      if (dto.bindFieldId && account.companyId) {
        const fv = await this.prisma.companyFieldValue.findFirst({
          where: { companyId: account.companyId, industryFieldId: dto.bindFieldId },
        });
        if (fv?.value != null) {
          data.cashBalance = Number(fv.value);
        }
      }
    }
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

  async findOrders(user: ReqUser, competitionId: number, stockId?: number, fundsAccountId?: number) {
    // 如果指定了资金账户，直接按该账户过滤（前端按当前选中账户过滤）
    if (fundsAccountId) {
      const where: Record<string, unknown> = { competitionId, fundsAccountId };
      if (stockId) where.stockId = stockId;
      return this.prisma.stockOrder.findMany({ where, orderBy: { createdAt: "desc" }, include: { stock: { select: { code: true, name: true } } } });
    }
    // 否则按用户可操作的账户范围过滤
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
    // 委托价限制：不得超过当前价 ±10%（与涨跌幅限制一致）
    const priceLimit = stock.currentPrice * 0.1;
    const upperLimit = Math.round((stock.currentPrice + priceLimit) * 100) / 100;
    const lowerLimit = Math.round((stock.currentPrice - priceLimit) * 100) / 100;
    if (dto.price > upperLimit + 0.001) {
      throw new BadRequestException(`委托价不能超过 ¥${upperLimit}（当前价 ¥${stock.currentPrice} 的 +10%）`);
    }
    if (dto.price < lowerLimit - 0.001) {
      throw new BadRequestException(`委托价不能低于 ¥${lowerLimit}（当前价 ¥${stock.currentPrice} 的 -10%）`);
    }
    // 获取账户可用余额（绑定字段时取字段值）
    let availableBalance = account.cashBalance;
    if (account.bindFieldId && account.companyId) {
      const fv = await this.prisma.companyFieldValue.findFirst({
        where: { companyId: account.companyId, industryFieldId: account.bindFieldId },
      });
      if (fv?.value != null) {
        availableBalance = Number(fv.value);
      }
    }
    if (dto.side === "BUY") {
      const need = dto.price * dto.quantity;
      if (availableBalance < need - 1e-6) throw new BadRequestException("现金余额不足");
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

  /**
   * AI 做市商：为指定股票自动生成买卖挂单，提供流动性。
   *
   * 做市商在每轮推进时、撮合前自动挂单：
   * - 以当前价为基准，在上下各挂 N 档订单
   * - 每档价格偏离基准价 spreadPct%（如 2%）
   * - 每档挂单量为 baseQuantity 股（越远越深）
   * - 买单价格递减，卖单价格递增，形成买卖盘深度
   *
   * 关键：做市商需要持有足够的股票才能卖，所以每轮先买入建仓，再卖出提供流动性。
   * 撮合顺序是买价高的优先，所以做市商的买单（低于市价）通常不会与自己的卖单撮合。
   *
   * @param stock 股票对象
   * @param competitionId 比赛 id
   * @param config 做市商配置 { enabled, spreadPct, levels, baseQuantity }
   * @returns 生成的订单数量
   */
  private async generateMarketMakerOrders(
    stock: any,
    competitionId: number,
    config: { enabled?: boolean; spreadPct?: number; levels?: number; baseQuantity?: number },
  ): Promise<number> {
    if (!config.enabled) return 0;

    const spreadPct = (config.spreadPct ?? 2) / 100; // 默认 2% 点差
    const levels = config.levels ?? 3; // 默认 3 档
    const baseQuantity = config.baseQuantity ?? 1000; // 默认每档 1000 股

    const basePrice = stock.currentPrice;
    if (basePrice <= 0) return 0;

    // 查询最近3轮K线，判断是否连续涨停/跌停
    const recentCandles = await this.prisma.stockCandle.findMany({
      where: { stockId: stock.id, competitionId },
      orderBy: { round: "desc" },
      take: 3,
    });

    // 判断连续涨停/跌停（涨跌幅接近±10%）
    let consecutiveLimitUp = 0;
    let consecutiveLimitDown = 0;
    for (const candle of recentCandles) {
      if (candle.changePct >= 9.9) {
        consecutiveLimitUp++;
        consecutiveLimitDown = 0;
      } else if (candle.changePct <= -9.9) {
        consecutiveLimitDown++;
        consecutiveLimitUp = 0;
      } else {
        break;
      }
    }

    // 查找或创建做市商资金账户
    let mmAccount = await this.prisma.stockFundsAccount.findFirst({
      where: { competitionId, name: "AI做市商" },
    });
    if (!mmAccount) {
      mmAccount = await this.prisma.stockFundsAccount.create({
        data: {
          name: "AI做市商",
          ownerType: "COMPANY",
          cashBalance: 1_000_000_000, // 10 亿初始资金
          competitionId,
        },
      });
    }

    // 计算做市商需要的总卖量，确保持仓足够
    let totalSellQty = 0;
    for (let i = 1; i <= levels; i++) {
      totalSellQty += baseQuantity * i;
    }

    // 检查做市商当前持仓，不足则先买入建仓（以当前价买入）
    const mmHolding = await this.prisma.stockHolding.findUnique({
      where: { fundsAccountId_stockId: { fundsAccountId: mmAccount.id, stockId: stock.id } },
    });
    const currentShares = mmHolding?.shares ?? 0;
    const needShares = totalSellQty - currentShares;

    const orders: any[] = [];
    const currentRound = stock.round;

    // 如果持仓不足，先以当前价买入建仓（这些买单会与玩家卖单或下一轮撮合）
    if (needShares > 0) {
      orders.push({
        stockId: stock.id,
        fundsAccountId: mmAccount.id,
        side: "BUY",
        price: basePrice, // 以当前价买入
        quantity: needShares,
        amount: Math.round(basePrice * needShares * 100) / 100,
        status: "PENDING",
        round: currentRound,
        competitionId,
      });
      // 同时直接写入持仓（保证本轮卖单有库存）
      // 注意：这样做是为了避免"先有鸡还是先有蛋"的问题
      await this.prisma.stockHolding.upsert({
        where: { fundsAccountId_stockId: { fundsAccountId: mmAccount.id, stockId: stock.id } },
        create: {
          fundsAccountId: mmAccount.id,
          stockId: stock.id,
          shares: totalSellQty,
          costPrice: basePrice,
          competitionId,
        },
        update: { shares: { increment: needShares } },
      });
      // 扣减做市商现金
      await this.prisma.stockFundsAccount.update({
        where: { id: mmAccount.id },
        data: { cashBalance: { decrement: Math.round(basePrice * needShares * 100) / 100 } },
      });
    }

    // 防止连续涨停/跌停的干预机制
    const interventionQty = baseQuantity * 10; // 干预数量更大

    if (consecutiveLimitUp >= 2) {
      // 连续涨停2轮及以上，在当前价+5%挂大量卖单阻止继续涨停
      const interventionPrice = Math.round(basePrice * 1.05 * 100) / 100;
      orders.push({
        stockId: stock.id,
        fundsAccountId: mmAccount.id,
        side: "SELL",
        price: interventionPrice,
        quantity: interventionQty,
        amount: Math.round(interventionPrice * interventionQty * 100) / 100,
        status: "PENDING",
        round: currentRound,
        competitionId,
      });
      // 同时在涨停价也挂卖单
      const limitUpPrice = Math.round(basePrice * 1.1 * 100) / 100;
      orders.push({
        stockId: stock.id,
        fundsAccountId: mmAccount.id,
        side: "SELL",
        price: limitUpPrice,
        quantity: interventionQty,
        amount: Math.round(limitUpPrice * interventionQty * 100) / 100,
        status: "PENDING",
        round: currentRound,
        competitionId,
      });
    } else if (consecutiveLimitDown >= 2) {
      // 连续跌停2轮及以上，在当前价-5%挂大量买单阻止继续跌停
      const interventionPrice = Math.round(basePrice * 0.95 * 100) / 100;
      orders.push({
        stockId: stock.id,
        fundsAccountId: mmAccount.id,
        side: "BUY",
        price: interventionPrice,
        quantity: interventionQty,
        amount: Math.round(interventionPrice * interventionQty * 100) / 100,
        status: "PENDING",
        round: currentRound,
        competitionId,
      });
      // 同时在跌停价也挂买单
      const limitDownPrice = Math.round(basePrice * 0.9 * 100) / 100;
      orders.push({
        stockId: stock.id,
        fundsAccountId: mmAccount.id,
        side: "BUY",
        price: limitDownPrice,
        quantity: interventionQty,
        amount: Math.round(limitDownPrice * interventionQty * 100) / 100,
        status: "PENDING",
        round: currentRound,
        competitionId,
      });
    }

    for (let i = 1; i <= levels; i++) {
      const offset = spreadPct * i;
      // 卖单：价格递增、数量递增（越远越深）
      const sellPrice = Math.round(basePrice * (1 + offset) * 100) / 100;
      const sellQty = baseQuantity * i;
      const sellAmount = Math.round(sellPrice * sellQty * 100) / 100;
      // 买单：价格递减；数量按「金额对称」放大——买价低于卖价，故低价多买，使买单金额 = 卖单金额，
      // 保证做市商自身对买卖压力中性，不因卖价 > 买价而产生结构性卖压（否则理论价会被恒压低、持续阴跌）。
      const buyPrice = Math.round(basePrice * (1 - offset) * 100) / 100;
      const buyQty = buyPrice > 0 ? Math.round((sellAmount / buyPrice) * 1e6) / 1e6 : 0;
      if (buyPrice > 0 && buyQty > 0) {
        orders.push({
          stockId: stock.id,
          fundsAccountId: mmAccount.id,
          side: "BUY",
          price: buyPrice,
          quantity: buyQty,
          amount: Math.round(buyPrice * buyQty * 100) / 100,
          status: "PENDING",
          round: currentRound,
          competitionId,
        });
      }

      orders.push({
        stockId: stock.id,
        fundsAccountId: mmAccount.id,
        side: "SELL",
        price: sellPrice,
        quantity: sellQty,
        amount: sellAmount,
        status: "PENDING",
        round: currentRound,
        competitionId,
      });
    }

    if (orders.length > 0) {
      await this.prisma.stockOrder.createMany({ data: orders });
    }
    return orders.length;
  }

  async advanceRound(user: ReqUser, competitionId: number, dto: AdvanceRoundDto = {}) {
    if (!this.isHighManager(user)) throw new ForbiddenException("仅高级管理可推进轮次");
    const where: Record<string, unknown> = { competitionId };
    if (dto.stockIds && dto.stockIds.length) where.id = { in: dto.stockIds };
    const stocks = await this.prisma.stock.findMany({ where });
    const fieldMap = await this.resolveFieldValueMap(competitionId);
    const results: any[] = [];

    // 做市商配置：从 dto 中读取，未传则使用默认值
    const mmConfig = {
      enabled: dto.marketMaker?.enabled ?? true, // 默认启用
      spreadPct: dto.marketMaker?.spreadPct ?? 2,
      levels: dto.marketMaker?.levels ?? 3,
      baseQuantity: dto.marketMaker?.baseQuantity ?? 1000,
    };

    let totalMmOrders = 0;
    for (const stock of stocks) {
      await this.applyPbRound(stock);
      // AI 做市商：在撮合前自动生成买卖挂单，提供流动性
      const mmCount = await this.generateMarketMakerOrders(stock, competitionId, mmConfig);
      totalMmOrders += mmCount;
      const r = await this.advanceOneStock(stock, competitionId, fieldMap);
      if (r) results.push(r);
    }
    this.realtime.broadcastToCompetition(competitionId, "stock:round-advanced", {
      competitionId,
      count: results.length,
      marketMakerOrders: totalMmOrders,
    });
    return { advanced: results.length, results, marketMakerOrders: totalMmOrders };
  }

  private async advanceOneStock(stock: any, competitionId: number, fieldMap: Map<string, number | null>) {
    // 获取所有 PENDING 订单（不限轮次），未成交的订单会保留到下一轮继续撮合
    const orders = await this.prisma.stockOrder.findMany({
      where: { stockId: stock.id, competitionId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { fundsAccount: true },
    });
    if (orders.length === 0) return null;

    // 撮合（含 AI 做市商，提供流动性）：成交价由全部订单的最高买 / 最低卖决定。
    const match = computeMatch(
      orders.map((o) => ({ side: o.side as "BUY" | "SELL", price: o.price, quantity: o.quantity })),
    );
    // 买卖压力（定价）：仅统计玩家订单，排除 AI 做市商——做市商「低买高卖」的对称挂单
    // 不应引导价格方向，否则其卖单金额恒大于买单金额会导致股价被结构性压低、持续阴跌。
    const playerOrders = orders.filter((o) => o.fundsAccount?.name !== "AI做市商");
    const pressure = computeMatch(
      playerOrders.map((o) => ({ side: o.side as "BUY" | "SELL", price: o.price, quantity: o.quantity })),
    );
    const price = computePrice({
      lastClose: stock.currentPrice,
      buyAmount: pressure.totalBuyAmount,
      sellAmount: pressure.totalSellAmount,
      happiness: this.effectiveHappiness(stock, fieldMap),
      currentCarbon: this.effectiveCarbon(stock, fieldMap),
      industryAvgCarbon: this.effectiveIndustryAvgCarbon(stock, fieldMap),
    });

    // 账户现金 / 持仓运行时快照（撮合过程中实时扣减）
    const cashMap = new Map<number, number>();
    const holdingMap = new Map<number, { shares: number; costPrice: number }>();
    for (const o of orders) {
      if (!cashMap.has(o.fundsAccountId)) {
        // 绑定了字段的账户从字段值获取余额
        const acc = o.fundsAccount;
        if (acc.bindFieldId && acc.companyId) {
          const fv = await this.prisma.companyFieldValue.findFirst({
            where: { companyId: acc.companyId, industryFieldId: acc.bindFieldId },
          });
          cashMap.set(o.fundsAccountId, fv?.value != null ? Number(fv.value) : acc.cashBalance);
        } else {
          cashMap.set(o.fundsAccountId, acc.cashBalance);
        }
      }
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

    const candle = buildCandle(stock.currentPrice, price.final, stock.round + 1, price.theoretical);
    const newRound = stock.round + 1;

    await this.prisma.$transaction(async (tx) => {
      // 现金（绑定字段的账户更新字段值，否则更新账户余额）
      for (const [accId, cash] of cashMap) {
        const acc = orders.find((o) => o.fundsAccountId === accId)?.fundsAccount;
        if (acc?.bindFieldId && acc?.companyId) {
          // 绑定了字段：更新字段值
          const roundedCash = Math.round(cash * 100) / 100;
          await tx.companyFieldValue.updateMany({
            where: { companyId: acc.companyId, industryFieldId: acc.bindFieldId },
            data: { value: String(roundedCash) },
          });
        } else {
          // 未绑定字段：更新账户余额
          await tx.stockFundsAccount.update({ where: { id: accId }, data: { cashBalance: Math.round(cash * 100) / 100 } });
        }
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
      // 订单状态：全部成交的设为 FILLED，部分成交的更新剩余数量保持 PENDING，未成交的保持 PENDING
      for (const o of orders) {
        const f = filled.get(o.id) ?? 0;
        if (f > EPS) {
          const remaining = o.quantity - f;
          if (remaining <= EPS) {
            // 全部成交
            await tx.stockOrder.update({ where: { id: o.id }, data: { status: "FILLED" } });
          } else {
            // 部分成交：更新剩余数量，保持 PENDING
            await tx.stockOrder.update({
              where: { id: o.id },
              data: { quantity: Math.round(remaining * 1e6) / 1e6, amount: Math.round(o.price * remaining * 100) / 100 },
            });
          }
        }
        // 未成交的订单保持 PENDING 状态，不取消
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
