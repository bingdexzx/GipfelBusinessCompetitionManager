import { Injectable, BadRequestException, NotFoundException, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@prisma/client";
import { RealtimeService } from "../../realtime/realtime.service";
import { serverNowIso } from "../../common/sync";
import { SetCompanyFieldValuesDto } from "./dto/company-fields.dto";
import { IndustryCalcEngineService } from "../industry-types/industry-calc-engine.service";
import { parseFieldConfig } from "../../common/json.util";
import { FieldWriteConflictException } from "../../common/exceptions/field-write-conflict.exception";

// 基础标量类型按字段类型把任意输入转换为存储用的字符串
function castScalar(type: "NUMBER" | "STRING" | "BOOLEAN", v: any): string {
  if (type === "NUMBER") {
    const n = typeof v === "number" ? v : parseFloat(v);
    if (!Number.isFinite(n)) throw new BadRequestException(`数值非法：${v}`);
    return String(n);
  }
  if (type === "BOOLEAN") {
    if (typeof v === "boolean") return v ? "true" : "false";
    if (v === "true" || v === "false") return v;
    throw new BadRequestException(`布尔非法：${v}`);
  }
  return String(v);
}

// 财年定时器「引用本产业字段」的设定值前缀：timerValue 形如 `field:<fieldKey>` 表示
// 触发时把目标字段写为「同产业该 fieldKey 字段的当前值」（而非固定字面量）。
const TIMER_REF_PREFIX = "field:";

// 把任意输入按产业字段定义序列化/校验为存储字符串
function serializeFieldValue(field: any, raw: any): string {
  const cfg = parseFieldConfig(field.config);
  switch (field.fieldType) {
    case "NUMBER":
    case "STRING":
    case "BOOLEAN":
      return castScalar(field.fieldType, raw);
    case "DICTIONARY": {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new BadRequestException(`字典字段「${field.fieldKey}」的值必须是对象`);
      const entries: any[] = cfg.entries || [];
      const valueType = cfg.valueType || "NUMBER";
      // 字典键 = 定义项 与 已存储键值 的并集：既保留已存的自由键值（即使产业类型尚未定义该项），
      // 也补齐定义项的默认值。避免"存了值却在落库时被丢弃"或"界面显示不出来"。
      const keys = new Set<string>();
      const defaults: Record<string, any> = {};
      for (const e of entries) {
        if (e && e.key) {
          keys.add(e.key);
          defaults[e.key] = e.defaultValue;
        }
      }
      for (const k of Object.keys(raw)) keys.add(k);
      const out: Record<string, any> = {};
      for (const key of keys) {
        const src = raw[key];
        const val = src === undefined ? defaults[key] : src;
        if (val === undefined) {
          out[key] = valueType === "NUMBER" ? 0 : valueType === "BOOLEAN" ? false : "";
        } else {
          out[key] = castScalar(valueType, val);
        }
      }
      return JSON.stringify(out);
    }
    case "LIST": {
      if (!Array.isArray(raw))
        throw new BadRequestException(`列表字段「${field.fieldKey}」的值必须是数组`);
      const itemType = cfg.itemType || "STRING";
      const out = raw.map((it: any) => castScalar(itemType, it));
      return JSON.stringify(out);
    }
    default:
      throw new BadRequestException(`未知字段类型：${field.fieldType}`);
  }
}

// 把产业字段存储字符串（可能以 JSON 编码，如 "\"B区节点\""）安全解析为字符串。
// 公司「所在地」字段等以节点名存储，读取侧需 JSON.parse 还原；已是纯字符串则原样返回。
function parseFieldStringValue(raw: any): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return String(raw);
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
  } catch {
    /* 非 JSON，原样返回 */
  }
  return raw;
}

@Injectable()
export class CompanyFieldsService {
  private readonly logger = new Logger(CompanyFieldsService.name);

  // getPublishedFieldIds 缓存：避免每次 getValues 都查询所有区域并解析 JSON
  // key = competitionId, value = { data, expiresAt }
  private publishedCache = new Map<number, { data: Set<string>; expiresAt: number }>();
  private static readonly PUBLISHED_CACHE_TTL_MS = 30_000; // 30 秒

  // 进程内按公司串行队列：保证同一 companyId 的字段写入与级联重算不交错（消除进程内读-改-写竞态）。
  // 仅公共入口加锁；内部一律调用私有 recomputeCalculatedFields（不加锁），避免同公司重入死锁。
  private companyLocks = new Map<number, Promise<unknown>>();

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private calcEngine: IndustryCalcEngineService,
  ) {}

  // 读取某公司（产业实例）的产业字段当前值。
  // 支持增量查询：传入 updatedAfter 时仅回传「值变更(CompanyFieldValue.updatedAt 晚于基线)
  // 或 定义变更(IndustryField.updatedAt 晚于基线，如可见性开关/新建/改名)」的字段（含 serverTime），
  // 每个回传字段都携带其真实当前值；同时回传 existingIds（当前全部可见字段定义 id），
  // 前端据此 diff 出被删除/被隐藏的字段。定义变更也回传，保证"关闭后再打开"等可见性变化能正确重新展示。
  //
  // publishedOnly=true 时（受限读权限：无 company:view/company:manage 的已登录角色）仅返回
  // 「已发布到区域总览」的字段：即 (companyId, industryFieldId) 出现在任一 Region.overviewCards 中的字段；
  // 未上总览的字段对其不可见（返回中既不含该字段值，也不计入 existingIds）。
  async getValues(
    companyId: number,
    updatedAfter?: string,
    publishedOnly = false,
    includeHidden = false,
  ) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { industryType: { include: { fields: true } } },
    });
    if (!company) throw new NotFoundException("公司不存在");
    if (!company.industryTypeId || !company.industryType) {
      return {
        industryTypeId: null,
        fields: [],
        existingIds: [],
        serverTime: serverNowIso(),
        incremental: !!updatedAfter,
      };
    }

    // 受限读：收集本比赛「已上区域总览」的 (companyId, industryFieldId) 集合，仅这些字段对受限用户可见
    const published =
      publishedOnly && company.competitionId != null
        ? await this.getPublishedFieldIds(company.competitionId)
        : null;
    const isPublished = (fieldCompanyId: number, fieldId: number) =>
      !published || published.has(`${fieldCompanyId}:${fieldId}`);

    // 默认仅返回 visible 字段：隐藏字段不在公司管理界面出现（纯展示层行为，合同引擎仍按 fieldKey 正常读写其 CompanyFieldValue）。
    // includeHidden=true 时返回全部字段（含隐藏）——供「区域总览 → 添加数据框」字段选择使用：
    // 隐藏字段仍可在区域总览被选中并发布（仅公司管理界面不展示），满足「产业类型管理处关闭显示、区域管理仍可选择」的需求。
    const baseFields = company.industryType.fields;
    // publishedOnly 模式下（受限读用户）：已发布到区域总览的字段不受 visible 限制，
    // 即 hidden 但 published 的字段仍应可见（保证"隐藏字段仍可发布到区域总览"的设计意图）。
    const visibleFields = includeHidden
      ? baseFields
      : publishedOnly
        ? baseFields.filter((f: any) => f.visible !== false || isPublished(companyId, f.id))
        : baseFields.filter((f: any) => f.visible !== false);
    const fieldIds = visibleFields.map((f: any) => f.id);
    // 取该公司全部可见字段的当前值（不过滤 updatedAt）：增量模式下需要真实当前值来"重新包含"
    // 因定义变化（可见性开关 / 新建字段 / 改名）而重新出现的字段——这些字段的值本身未必近期变更。
    const values = await this.prisma.companyFieldValue.findMany({
      where: { companyId, industryFieldId: { in: fieldIds } },
      include: { industryField: true },
      orderBy: { updatedAt: "desc" },
    });

    // existingIds：受限读时仅含已上总览的可见字段定义 id；全量读时含该产业类型全部可见字段定义 id。
    // 用于前端 diff 删除（隐藏字段始终不计入，因为它们并未被删除、只是不展示）。
    const existingIds = visibleFields
      .filter((f: any) => isPublished(companyId, f.id))
      .map((f: any) => f.id);

    // 增量模式下，仅回传「值变更」或「定义变更（可见性 / 新建 / 改名，updatedAt 晚于基线）」的字段，减少体积；
    // 这些字段都携带其真实当前值（不论值本身新旧），前端据此 upsert，并借 existingIds 删除隐藏/已移除字段。
    // 关键修复：仅按"值变更时间"过滤会漏掉"重新展示的字段"（可见性开关不改动 CompanyFieldValue.updatedAt），
    // 导致字段在前端本地增量副本中始终缺席、关闭后再打开无法重新展示。全量模式（无 updatedAfter）返回全部可见字段。
    const baseline = updatedAfter ? new Date(updatedAfter) : null;
    const baselineOk = baseline != null && !Number.isNaN(baseline.getTime());
    const fields = visibleFields
      .filter((f: any) => isPublished(companyId, f.id))
      .filter((f: any) => {
        if (!baselineOk) return true; // 全量模式
        const v = values.find((x: any) => x.industryFieldId === f.id);
        const valueRecent = !!v && new Date(v.updatedAt) > baseline!;
        const defRecent = !!f.updatedAt && new Date(f.updatedAt) > baseline!;
        return valueRecent || defRecent;
      })
      .map((f: any) => {
        const v = values.find((x: any) => x.industryFieldId === f.id);
        return {
          id: f.id,
          industryTypeId: company.industryTypeId,
          fieldKey: f.fieldKey,
          fieldType: f.fieldType,
          name: f.name,
          config: parseFieldConfig(f.config),
          isCalculated: !!f.isCalculated,
          formula: f.formula,
          value: v ? v.value : null,
          defaultValue: f.defaultValue,
          updatedAt: v ? v.updatedAt : null,
          // 透出 visible，便于前端（区域总览数据框下拉等）兜底过滤隐藏字段
          visible: f.visible !== false,
        };
      });

    return {
      industryTypeId: company.industryTypeId,
      fields,
      existingIds,
      serverTime: serverNowIso(),
      incremental: !!updatedAfter,
    };
  }

  // 收集某比赛内「已发布到区域总览」的 (companyId, industryFieldId) 集合。
  // 判定依据：任一 Region 的 overviewCards（JSON，元素 {id, displayName, companyId, industryFieldId}）
  // 中出现过的 (companyId, industryFieldId) 对，即视为公开可读。
  // 带 TTL 缓存（30 秒），避免每次 getValues 都查询所有区域并解析 JSON。
  private async getPublishedFieldIds(competitionId: number): Promise<Set<string>> {
    const now = Date.now();
    const cached = this.publishedCache.get(competitionId);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const published = new Set<string>();
    const regions = await this.prisma.region.findMany({
      where: { competitionId },
      select: { overviewCards: true },
    });
    for (const r of regions) {
      let cards: any[] = [];
      try {
        const parsed = JSON.parse(r.overviewCards || "[]");
        if (Array.isArray(parsed)) cards = parsed;
      } catch {
        cards = [];
      }
      for (const c of cards) {
        if (
          c &&
          typeof c.companyId === "number" &&
          typeof c.industryFieldId === "number"
        ) {
          published.add(`${c.companyId}:${c.industryFieldId}`);
        }
      }
    }

    this.publishedCache.set(competitionId, {
      data: published,
      expiresAt: now + CompanyFieldsService.PUBLISHED_CACHE_TTL_MS,
    });
    return published;
  }

  /** 清除指定比赛的 publishedFieldIds 缓存（区域总览卡片变更时调用）。 */
  invalidatePublishedCache(competitionId: number): void {
    this.publishedCache.delete(competitionId);
  }

  /**
   * 进程内按公司串行化：同一 companyId 的后续调用排队在前一个完成后执行，
   * 保证字段写入与级联重算不会交错产生中间态。不同 companyId 之间并行。
   * 队列头 settle 后自动清理 Map 条目，避免内存泄漏。
   */
  private serializeCompany<T>(companyId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.companyLocks.get(companyId) ?? Promise.resolve();
    const run = () => fn();
    const next = prev.then(run, run);
    // head 与比较引用必须一致：prev 失败也继续排队（run 吞掉前驱错误），头 settle 后清理 Map 条目
    const head = next.then(
      () => undefined,
      () => undefined,
    );
    this.companyLocks.set(companyId, head);
    void head.finally(() => {
      if (this.companyLocks.get(companyId) === head) this.companyLocks.delete(companyId);
    });
    return next;
  }

  /**
   * 字段值单写入口（写路径收敛 + 乐观锁）。所有 CompanyFieldValue 写必须经此方法，
   * 包括本服务内部三处与外部合同引擎/股票引擎的写入。
   *
   * - 行不存在 → create(version=0)；
   * - 行存在 → updateMany({ where:{id, version}, data:{ value, version:{increment:1} } })，
   *   以 version 条件实现乐观锁；count!==1（被其他写入抢占）重试；并发 create 触发 P2002 也重试；
   *   重试耗尽抛 FieldWriteConflictException(409)。
   *
   * @param tx 调用方事务客户端（也可传 PrismaService 本身做非事务写）
   */
  async writeFieldValueInTx(
    tx: Prisma.TransactionClient,
    companyId: number,
    industryFieldId: number,
    value: string,
    maxRetries = 3,
  ): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const row = await tx.companyFieldValue.findUnique({
        where: { companyId_industryFieldId: { companyId, industryFieldId } } as any,
        select: { id: true, version: true },
      });
      if (!row) {
        try {
          await tx.companyFieldValue.create({
            data: { companyId, industryFieldId, value, version: 0 },
          });
          return;
        } catch (e: any) {
          // 并发创建竞争：另一写入已建行，下一轮重试命中已存在分支
          if (e?.code === "P2002") continue;
          throw e;
        }
      }
      const updated = await tx.companyFieldValue.updateMany({
        where: { id: row.id, version: row.version },
        data: { value, version: { increment: 1 } },
      });
      if (updated.count === 1) return;
      // version 不匹配：被其他写入抢占，重试
    }
    throw new FieldWriteConflictException(companyId, industryFieldId);
  }

  // 批量写入某公司（产业实例）的产业字段值，按字段定义校验与序列化
  async setValues(companyId: number, dto: SetCompanyFieldValuesDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: { industryType: { include: { fields: true } } },
    });
    if (!company) throw new NotFoundException("公司不存在");
    if (!company.industryTypeId || !company.industryType)
      throw new BadRequestException("该公司未设置产业类型，无法写入产业字段");

    const fieldMap = new Map(company.industryType.fields.map((f: any) => [f.id, f]));

    // 逐个校验，全部通过后再落库（事务）
    const toUpsert: { industryFieldId: number; value: string }[] = [];
    for (const item of dto.values) {
      const field = fieldMap.get(item.industryFieldId);
      if (!field)
        throw new BadRequestException(`字段 #${item.industryFieldId} 不属于该公司所属产业类型`);
      const value = serializeFieldValue(field, item.value);
      toUpsert.push({ industryFieldId: field.id, value });
    }

    // 在异步闭包外捕获字段定义（属性收窄不跨闭包），闭包内统一用此本地引用
    const industryFields = company.industryType.fields;
    let recomputeFailed = false;
    // 同一公司串行化：基础字段写入与级联重算整体作为原子序列，避免与合同执行/定时器/其他编辑交错。
    await this.serializeCompany(companyId, async () => {
      await this.prisma.$transaction(async (tx) => {
        for (const u of toUpsert) {
          await this.writeFieldValueInTx(tx, companyId, u.industryFieldId, u.value);
        }
      });

      // 写入时级联重算：本公司所属产业类型的全部 isCalculated 字段，按依赖拓扑排序后
      // 用产业计算图重新求值并写回各自的 CompanyFieldValue（仅写本字段）。
      try {
        await this.recomputeCalculatedFields(companyId, company.industryType!.fields);
      } catch (err: any) {
        // 重算出错（如计算图存在循环依赖）不应使本次普通字段写入失败；记录日志，交由用户修正计算图。
        recomputeFailed = true;
        this.logger.warn(`公司 #${companyId} 计算字段级联重算失败：${err?.message || err}`);
      }
    });

    // 强时效：公司产业字段写入后实时广播，同比赛前端（含公司详情页）即刻刷新
    if (company.competitionId != null) {
      this.realtime.broadcastToCompetition(company.competitionId, "company-field:changed", {
        companyId,
        competitionId: company.competitionId,
      });
    }
    return { success: true, count: toUpsert.length, recomputeFailed };
  }

  /**
   * 公开入口：供合同执行 / 复原后触发某公司的计算字段级联重算。
   *
   * 此前合同执行对产业字段是「直写」(contract-engine 直接 upsert CompanyFieldValue)，
   * 绕过了本服务的 setValues，导致计算字段所依赖的基础字段被改写后，计算字段值陈旧且永不重算。
   * 本方法让合同落账后也能触发与手动编辑一致的级联重算，仅做重算、不广播
   * （广播由调用方按比赛统一发起，避免重复事件）。
   */
  async recomputeCalculatedFieldsForCompany(companyId: number) {
    await this.serializeCompany(companyId, async () => {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
        include: { industryType: { include: { fields: true } } },
      });
      if (!company || !company.industryTypeId || !company.industryType) return;
      try {
        await this.recomputeCalculatedFields(companyId, company.industryType!.fields);
      } catch (err: any) {
        // 重算出错（如计算图存在循环依赖）不应使合同执行 / 复原失败；记录日志，交由用户修正计算图。
        this.logger.warn(`公司 #${companyId} 计算字段级联重算失败：${err?.message || err}`);
      }
    });
  }

  /**
   * 消费者需求变更后的级联重算入口。
   *
   * 计算字段可通过产业计算图的 CONSUMER_DEMAND 数据源引用「本产业实例所在地所属区域下的
   * 消费者需求件数之和」。消费者需求被增/删/改后，该聚合值随之变化，但此前从未触发依赖它的
   * 计算字段重算，导致其显示值停留在旧值（即"产品件数求和同步失败"缺陷）。
   *
   * 本方法按区域收窄：仅重算「所在地所属区域与变更需求区域相交」且产业计算图含 CONSUMER_DEMAND
   * 节点的公司，避免全量重算；重算后统一广播 company-field:changed，前端三处（公司详情/区域总览/
   * 仪表盘）监听该事件会自动重拉字段值。
   *
   * 区域匹配与 industry-calc-engine.resolveConsumerDemandTotal 保持对称：公司命中当且仅当
   * 变更需求的 region ∈ {公司所在地节点名, 所在地节点所属 region}。
   *
   * @param competitionId 比赛 id
   * @param demandRegion   被变更的消费者需求的 region（可能为区域名或节点名）
   */
  async recomputeConsumerDemandDependentFields(
    competitionId: number,
    demandRegion: string,
  ) {
    if (!demandRegion) return;

    // 优化：先查出所有含 CONSUMER_DEMAND 节点的产业类型 id，再只加载这些类型的公司，
    // 避免加载全部公司+全部字段定义后逐个检查 calcGraph。
    const calcFields = await this.prisma.industryField.findMany({
      where: { isCalculated: true, calcGraph: { not: null } },
      select: { industryTypeId: true, calcGraph: true },
    });
    const cdIndustryTypeIds = new Set<number>();
    for (const f of calcFields) {
      if (!f.calcGraph) continue;
      try {
        const graph = JSON.parse(f.calcGraph);
        if (Array.isArray(graph?.nodes) && graph.nodes.some(
          (n: any) => n.type === "value" && n.data?.kind === "CONSUMER_DEMAND",
        )) {
          cdIndustryTypeIds.add(f.industryTypeId);
        }
      } catch { /* 忽略无效 JSON */ }
    }
    if (cdIndustryTypeIds.size === 0) return;

    // 只加载「含 CONSUMER_DEMAND 计算图的产业类型」下的公司
    const companies = await this.prisma.company.findMany({
      where: { competitionId, industryTypeId: { in: [...cdIndustryTypeIds] } },
      include: { industryType: { include: { fields: true } } },
    });
    if (companies.length === 0) return;

    // 本比赛地图节点，用于把公司「所在地节点名」解析为其所属 region。
    const nodes = await this.prisma.mapNode.findMany({
      where: { competitionId },
      select: { name: true, region: true },
    });
    const nodeByName = new Map<string, any>(nodes.map((n) => [n.name, n]));

    for (const c of companies) {
      if (!c.industryTypeId || !c.industryType) continue;
      const fields = (c.industryType.fields || []) as any[];

      // 解析公司所在地节点名（location 字段，可能以 JSON 编码的节点名存储）。
      const locField = fields.find((f) => f.fieldKey === "location");
      let locationNodeName: string | null = null;
      if (locField) {
        const v = await this.prisma.companyFieldValue.findFirst({
          where: { companyId: c.id, industryFieldId: locField.id },
        });
        const raw = v?.value ?? locField.defaultValue;
        locationNodeName = parseFieldStringValue(raw);
      }
      if (!locationNodeName) continue;

      // 公司所属区域集合 = {所在地节点名, 所在地节点所属 region}，
      // 与 resolveConsumerDemandTotal 的 regions 集合对称；需求 region 落在该集合内即受影响。
      const companyRegions = new Set<string>([locationNodeName]);
      const node = nodeByName.get(locationNodeName);
      if (node?.region) companyRegions.add(node.region);
      if (!companyRegions.has(demandRegion)) continue;

      try {
        await this.recomputeCalculatedFieldsForCompany(c.id);
        this.realtime.broadcastToCompetition(competitionId, "company-field:changed", {
          companyId: c.id,
          competitionId,
        });
      } catch (err: any) {
        this.logger.warn(
          `消费者需求变更触发公司 #${c.id} 计算字段重算失败：${err?.message || err}`,
        );
      }
    }
  }

  /**
   * 财年定时器触发入口：把本比赛中所有「启用了该触发时机」的产业字段，
   * 自动写为其配置设定值（按字段类型序列化），覆盖该产业类型下的全部公司，随后级联重算下游计算字段。
   *
   * @param competitionId 比赛 id（定时器按比赛收敛：只作用于该比赛下的公司）
   * @param trigger 触发时机 FY_START（财年开始）/ FY_END（财年结束）
   *
   * 设计要点：
   * - 跨产业类型：先捞出所有 timerEnabled && timerTrigger===trigger 的 IndustryField，按 industryTypeId 分组；
   *   再取该比赛下对应 industryTypeId 的公司批量写入，避免 N+1。
   * - 写入值经 serializeFieldValue 序列化，与手动编辑完全一致；DICTIONARY/LIST 的 timerValue 为 JSON 文本。
   * - 每件公司写完基础字段后调用 recomputeCalculatedFieldsForCompany 级联重算（不广播），随后统一广播
   *    company-field:changed 让同比赛前端刷新。单字段异常不中断整体（记录日志后跳过）。
   */
  async applyFiscalYearTimer(competitionId: number, trigger: "FY_START" | "FY_END") {
    const timerFields = await this.prisma.industryField.findMany({
      where: { timerEnabled: true, timerTrigger: trigger },
    });
    if (timerFields.length === 0) return;

    // 按 industryTypeId 分组，便于按产业类型批量取公司
    const byType = new Map<number, any[]>();
    for (const f of timerFields) {
      if (!byType.has(f.industryTypeId)) byType.set(f.industryTypeId, []);
      byType.get(f.industryTypeId)!.push(f);
    }

    for (const [industryTypeId, fields] of byType) {
      const companies = await this.prisma.company.findMany({
        where: { competitionId, industryTypeId },
        include: { industryType: { include: { fields: true } } },
      });
      for (const c of companies) {
        // 同一公司串行化：定时器写基础字段 + 级联重算整体原子序列，避免与手动编辑/合同执行交错。
        await this.serializeCompany(c.id, async () => {
          // 取出该公司全部字段当前值（含定义），构建 fieldKey→{field,value} 映射。
          // 所有定时器字段的目标值都基于这份「触发前」快照计算，避免相互引用导致顺序依赖。
          const allVals = await this.prisma.companyFieldValue.findMany({
            where: { companyId: c.id },
            include: { industryField: true },
          });
          const byKey = new Map<string, { field: any; value: string }>();
          for (const v of allVals) {
            if (v.industryField)
              byKey.set(v.industryField.fieldKey, { field: v.industryField, value: v.value });
          }

          const pending: { industryFieldId: number; value: string }[] = [];
          for (const f of fields) {
            try {
              const resolved = this.resolveTimerWriteValue(f, byKey);
              if (resolved == null) {
                this.logger.warn(
                  `财年定时器：公司 #${c.id} 字段 #${f.id}(${f.fieldKey}) 引用了不存在的字段，跳过`,
                );
                continue;
              }
              pending.push({ industryFieldId: f.id, value: serializeFieldValue(f, resolved.raw) });
            } catch (err: any) {
              this.logger.warn(
                `财年定时器：公司 #${c.id} 字段 #${f.id}(${f.fieldKey}) 写入失败：${err?.message || err}`,
              );
            }
          }
          if (pending.length > 0) {
            await this.prisma.$transaction(async (tx) => {
              for (const p of pending) {
                await this.writeFieldValueInTx(tx, c.id, p.industryFieldId, p.value);
              }
            });
          }
          // 基础字段写完后级联重算下游计算字段（私有，避免同公司重入加锁）
          await this.recomputeCalculatedFields(c.id, c.industryType?.fields || []);
        });
        // 统一广播本次公司字段变更，同比赛前端（公司详情/区域总览）即刻刷新
        this.realtime.broadcastToCompetition(competitionId, "company-field:changed", {
          companyId: c.id,
          competitionId,
        });
      }
    }
  }

  // 把 IndustryField.timerValue（按字段类型序列化前的原始字符串）还原为 serializeFieldValue 期望的输入形状。
  private timerRawValue(field: any): any {
    const v = field.timerValue;
    switch (field.fieldType) {
      case "NUMBER":
        return parseFloat(v);
      case "BOOLEAN":
        return String(v).trim().toLowerCase() === "true";
      case "STRING":
        return String(v);
      case "DICTIONARY":
      case "LIST":
        // 配置时已由 validateTimerSpec 校验为合法 JSON（对象/数组），此处解析供序列化
        return JSON.parse(v);
      default:
        return v;
    }
  }

  // 财年定时器设定值解析：
  // - 普通常量：timerValue 为字面量（向后兼容），交由 timerRawValue 按类型还原；
  // - 引用本产业字段：timerValue 形如 `field:<fieldKey>`，触发时取该公司「被引用字段的当前值」作为写入值。
  //   引用源缺失时返回 null（调用方 warn 跳过，不中断整体定时器）。
  private resolveTimerWriteValue(
    field: any,
    byKey: Map<string, { field: any; value: string }>,
  ): { raw: any } | null {
    const tv = field.timerValue;
    if (typeof tv === "string" && tv.startsWith(TIMER_REF_PREFIX)) {
      const refKey = tv.slice(TIMER_REF_PREFIX.length);
      const ref = byKey.get(refKey);
      if (!ref) return null;
      return { raw: this.storedToRaw(ref.field, ref.value) };
    }
    return { raw: this.timerRawValue(field) };
  }

  // 把字段存储字符串（CompanyFieldValue.value）还原为 serializeFieldValue 期望的输入形状。
  // 与 timerRawValue 互为反向：timerRawValue 处理「配置字面量」，本方法处理「已存储的字段值」。
  private storedToRaw(field: any, value: string | null): any {
    if (value == null) {
      return field.fieldType === "NUMBER" ? 0 : field.fieldType === "BOOLEAN" ? false : "";
    }
    switch (field.fieldType) {
      case "NUMBER":
        return value === "" ? 0 : parseFloat(value);
      case "BOOLEAN":
        return String(value).trim().toLowerCase() === "true";
      case "STRING":
        return parseFieldStringValue(value);
      case "DICTIONARY":
      case "LIST":
        try {
          return JSON.parse(value);
        } catch {
          return field.fieldType === "LIST" ? [] : {};
        }
      default:
        return value;
    }
  }

  /**
   * 级联重算某公司的全部计算字段。
   * @param fields 该公司所属产业类型的全部 IndustryField（含 isCalculated / calcGraph）
   */
  private async recomputeCalculatedFields(companyId: number, fields: any[]) {
    const calcFields = (fields || []).filter(
      (f: any) => f.isCalculated && f.calcGraph && f.calcGraph.trim(),
    );
    if (calcFields.length === 0) return;

    // 当前公司已存值（含刚刚写入的普通字段），用于构建作用域。
    const vals = await this.prisma.companyFieldValue.findMany({
      where: { companyId },
      include: { industryField: true },
    });
    const valByFieldId = new Map(vals.map((v: any) => [v.industryFieldId, v.value]));

    // 作用域：fieldKey -> 已按字段类型解析的值；缺值回退字段 defaultValue。
    const scope: Record<string, any> = {};
    for (const f of fields) {
      const stored =
        valByFieldId.has(f.id) ? valByFieldId.get(f.id) : f.defaultValue;
      scope[f.fieldKey] = this.typedFromStore(f, stored);
    }

    // 区域上下文：本产业实例（公司）所属比赛 + 所在地节点名，供计算图的 CONSUMER_DEMAND 数据源使用。
    // 所在地字段以 JSON 编码字符串存储节点名（如 "B区节点"），读取需 parseFieldStringValue 还原。
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { competitionId: true },
    });
    const locationField = (fields || []).find((f: any) => f.fieldKey === "location");
    let locationNodeName: string | null = null;
    if (locationField) {
      const raw = valByFieldId.has(locationField.id)
        ? valByFieldId.get(locationField.id)
        : locationField.defaultValue;
      locationNodeName = parseFieldStringValue(raw);
    }
    const calcCtx = { competitionId: company?.competitionId ?? null, locationNodeName };

    // 计算字段之间的依赖：A 依赖 B 当且仅当 A 的计算图读取 B.fieldKey 且 B 也是计算字段。
    const fieldKeyById = new Map(calcFields.map((f: any) => [f.fieldKey, f]));
    const deps: Record<string, Set<string>> = {};
    for (const f of calcFields) {
      const readKeys = this.calcEngine.getFieldDependencies(this.parseGraph(f.calcGraph));
      const depSet = new Set<string>();
      for (const k of readKeys) {
        if (k !== f.fieldKey && fieldKeyById.has(k)) depSet.add(k); // 自引用忽略
      }
      deps[f.fieldKey] = depSet;
    }

    // 拓扑排序（Kahn）：detectCycles 在存在环时抛错。
    const ordered = this.topoSortCalcFields(calcFields, deps);

    // 按序求值并写回（每算完一个即刷新作用域，保证传递依赖正确）。
    const toWrite: { industryFieldId: number; value: string }[] = [];
    for (const f of ordered) {
      const graph = this.parseGraph(f.calcGraph);
      const result = await this.calcEngine.evaluate(graph, scope, calcCtx);
      const store = serializeFieldValue(f, result);
      toWrite.push({ industryFieldId: f.id, value: store });
      scope[f.fieldKey] = this.typedFromStore(f, store);
    }
    if (toWrite.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      for (const u of toWrite) {
        await this.writeFieldValueInTx(tx, companyId, u.industryFieldId, u.value);
      }
    });
  }

  // 解析 calcGraph（容错：非法 JSON 视为空图）。
  private parseGraph(json: string): any {
    try {
      const g = JSON.parse(json);
      return g && typeof g === "object" ? g : { nodes: [], edges: [] };
    } catch {
      return { nodes: [], edges: [] };
    }
  }

  // 把存储字符串按字段类型还原为 JS 值，用于构建求值作用域。
  private typedFromStore(field: any, stored: string | null | undefined): any {
    const cfg = parseFieldConfig(field.config);
    switch (field.fieldType) {
      case "NUMBER": {
        const n = stored == null ? NaN : Number(stored);
        return Number.isFinite(n) ? n : 0;
      }
      case "BOOLEAN":
        return stored === "true";
      case "STRING":
        return stored == null ? "" : String(stored);
      case "DICTIONARY": {
        if (stored == null) return {};
        try {
          const o = JSON.parse(stored);
          return o && typeof o === "object" && !Array.isArray(o) ? o : {};
        } catch {
          return {};
        }
      }
      case "LIST": {
        if (stored == null) return [];
        try {
          const a = JSON.parse(stored);
          return Array.isArray(a) ? a : [];
        } catch {
          return [];
        }
      }
      default:
        return stored == null ? "" : String(stored);
    }
  }

  // Kahn 拓扑排序；存在环时抛 BadRequestException。返回有序的计算字段数组。
  private topoSortCalcFields(calcFields: any[], deps: Record<string, Set<string>>): any[] {
    const indeg: Record<string, number> = {};
    for (const f of calcFields) indeg[f.fieldKey] = 0;
    for (const f of calcFields) indeg[f.fieldKey] = deps[f.fieldKey]?.size || 0;
    const queue = calcFields.filter((f) => indeg[f.fieldKey] === 0);
    const ordered: any[] = [];
    const byKey = new Map(calcFields.map((f: any) => [f.fieldKey, f]));
    while (queue.length) {
      const f = queue.shift()!;
      ordered.push(f);
      for (const g of calcFields) {
        if (deps[g.fieldKey]?.has(f.fieldKey)) {
          indeg[g.fieldKey]--;
          if (indeg[g.fieldKey] === 0) queue.push(g);
        }
      }
    }
    if (ordered.length !== calcFields.length)
      throw new BadRequestException("产业计算图之间存在循环依赖（计算字段互相引用）");
    return ordered;
  }
}
