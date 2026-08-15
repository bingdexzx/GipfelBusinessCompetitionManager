import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeService } from "../../realtime/realtime.service";
import { CreateRegionDto, UpdateRegionDto, SaveOverviewCardsDto } from "./dto/region.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";

function parseCards(json: string): any[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function serializeCards(cards: any[]): string {
  return JSON.stringify(Array.isArray(cards) ? cards : []);
}

@Injectable()
export class RegionService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  async findAll(competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere: any = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.region.findMany({ where, orderBy: { updatedAt: "desc" } });
      const existingIds = requireExistingIds
        ? (await this.prisma.region.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    return this.prisma.region.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });
  }

  async findOne(id: number) {
    const region = await this.prisma.region.findUnique({
      where: { id },
      include: {
        companies: { select: { id: true, name: true, industryTypeId: true } },
      },
    });
    if (!region) throw new NotFoundException("区域不存在");
    return region;
  }

  async create(dto: CreateRegionDto) {
    const region = await this.prisma.region.create({
      data: {
        name: dto.name,
        description: dto.description,
        competitionId: dto.competitionId,
        overviewCards: serializeCards(dto.overviewCards || []),
      },
    });
    this.realtime.emitResourceChanged("region", region.id, region.competitionId ?? null, "created");
    return region;
  }

  async update(id: number, dto: UpdateRegionDto) {
    await this.findOne(id);
    const region = await this.prisma.region.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        overviewCards: dto.overviewCards ? serializeCards(dto.overviewCards) : undefined,
      },
    });
    this.realtime.emitResourceChanged("region", region.id, region.competitionId ?? null, "updated");
    return region;
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    // 保护：若仍有地图节点把「所属区域」设成该区域，禁止删除——应先在地图节点上移除所属区域
    if (item.name) {
      const usedWhere: any = { region: item.name };
      if (item.competitionId) usedWhere.competitionId = item.competitionId;
      const used = await this.prisma.mapNode.findFirst({
        where: usedWhere,
        select: { id: true },
      });
      if (used) {
        throw new BadRequestException(
          `区域「${item.name}」已被地图节点使用，请先在地图节点上移除其所属区域后再删除`,
        );
      }
    }
    // 删除区域前将其下公司 regionId 置空（SetNull 关系会兜底，这里显式处理保证一致）
    await this.prisma.$transaction([
      this.prisma.company.updateMany({
        where: { regionId: id },
        data: { regionId: null },
      }),
      this.prisma.region.delete({ where: { id } }),
    ]);
    this.realtime.emitResourceChanged("region", id, item.competitionId ?? null, "deleted");
    return { message: "已删除" };
  }

  /** 该区域下的公司列表（用于总览卡片下拉与区域管理）。 */
  async getCompanies(id: number) {
    await this.findOne(id);
    return this.prisma.company.findMany({
      where: { regionId: id },
      include: { industryType: true },
      orderBy: { name: "asc" },
    });
  }

  /**
   * 解析一组 overviewCards，为每张卡片聚合「实时字段值」。
   * 卡片引用的公司 / 字段可能已失效（产业类型变更），此时标记 valid=false 供前端占位显示。
   * 解析不依赖 Region 实体，仅按 card.companyId / card.industryFieldId 取当前值。
   */
  private async resolveCards(cards: any[]): Promise<any[]> {
    const result: any[] = [];
    for (const card of cards) {
      const entry: any = { ...card };
      try {
        const company = await this.prisma.company.findUnique({
          where: { id: card.companyId },
          include: { industryType: { include: { fields: true } } },
        });
        if (!company || !company.industryType) {
          entry.valid = false;
          entry.value = null;
          entry.fieldName = null;
          entry.fieldType = null;
          entry.companyName = company?.name ?? null;
        } else {
          const field = company.industryType.fields.find(
            (f: any) => f.id === card.industryFieldId,
          );
          if (!field) {
            entry.valid = false;
            entry.value = null;
            entry.fieldName = null;
            entry.fieldType = null;
            entry.companyName = company.name;
          } else {
            const fv = await this.prisma.companyFieldValue.findUnique({
              where: {
                companyId_industryFieldId: {
                  companyId: card.companyId,
                  industryFieldId: card.industryFieldId,
                },
              } as any,
            });
            entry.valid = true;
            entry.value = fv ? fv.value : field.defaultValue ?? null;
            entry.fieldName = field.name;
            entry.fieldType = field.fieldType;
            entry.companyName = company.name;
          }
        }
      } catch {
        entry.valid = false;
        entry.value = null;
        entry.fieldName = null;
        entry.fieldType = null;
        entry.companyName = null;
      }
      result.push(entry);
    }
    return result;
  }

  /**
   * 区域总览：解析 overviewCards，并为每张卡片聚合「实时字段值」。
   */
  async getOverview(id: number) {
    const region = await this.findOne(id);
    const cards = parseCards(region.overviewCards);
    const resolved = await this.resolveCards(cards);
    return { id: region.id, name: region.name, cards: resolved };
  }

  // ============================================================
  // 地图区域总览：区域来自地图节点（MapNode.region 去重）
  // 不依赖独立 Region 实体的增删，仅借用 Region.overviewCards 存卡片配置（按名查找）。
  // ============================================================

  /** 按 (competitionId, name) 查找区域配置记录，找不到返回 null（不自动创建）。 */
  async getRegionByName(competitionId: number | undefined, name: string) {
    const where: any = { name };
    if (competitionId) where.competitionId = competitionId;
    return this.prisma.region.findFirst({ where });
  }

  /**
   * 解析「所在地」字段的存储值（地图节点名）为纯字符串。
   * CompanyFieldValue.value 对 STRING 字段有两种存储格式并存：
   *  - 公司详情页写入（company-fields.setValues）：纯字符串，如 "北京"；
   *  - 合同引擎写入（contract-engine.applyFieldEffect）：JSON.stringify，如 "\"北京\""。
   * 统一解析后再与节点名比较，避免直接拿 JSON 串比对导致「本地区公司」全部漏匹配。
   */
  private parseLocationValue(raw: any): string | null {
    if (raw == null || raw === "") return null;
    if (typeof raw !== "string") return String(raw);
    const s = raw.trim();
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      try {
        const p = JSON.parse(s);
        if (typeof p === "string") return p;
      } catch {
        /* 解析失败则保留原串 */
      }
    }
    return s;
  }

  /** 该地图区域下的「当地公司」：公司所在地（location 字段存节点名）→ 节点 → 节点.region === regionName。 */
  async getLocalCompanies(competitionId: number | undefined, regionName: string) {
    const nodeWhere: any = { region: regionName };
    if (competitionId) nodeWhere.competitionId = competitionId;
    const nodes = await this.prisma.mapNode.findMany({
      where: nodeWhere,
      select: { name: true },
    });
    const nodeNames = new Set(nodes.map((n: any) => n.name));
    if (nodeNames.size === 0) return [];

    const compWhere: any = { industryTypeId: { not: null } };
    if (competitionId) compWhere.competitionId = competitionId;
    const companies = await this.prisma.company.findMany({
      where: compWhere,
      include: {
        industryType: { include: { fields: true } },
        fieldValues: true,
      },
    });
    const result: any[] = [];
    for (const c of companies as any[]) {
      const locField = c.industryType?.fields?.find((f: any) => f.fieldKey === "location");
      if (!locField) continue;
      const cfv = c.fieldValues?.find((f: any) => f.industryFieldId === locField.id);
      const locName = this.parseLocationValue(cfv?.value);
      if (!locName) continue;
      if (nodeNames.has(locName)) {
        result.push({ id: c.id, name: c.name, industryTypeId: c.industryTypeId });
      }
    }
    return result;
  }

  /**
   * 地图区域总览：返回按区域名聚合的 [{ region, companies, cards }]。
   * region 来自地图节点去重；cards 复用 Region.overviewCards（按名查找，无配置则为空）。
   */
  async getMapOverview(competitionId?: number) {
    // region 为非空 String：未设区域时存空串 ""，用 not: "" 排除（不能用 not: null）
    const nodeWhere: any = { region: { not: "" } };
    if (competitionId) nodeWhere.competitionId = competitionId;
    const nodes = await this.prisma.mapNode.findMany({
      where: nodeWhere,
      select: { region: true },
    });
    const regionNames = new Set(
      (nodes.map((n: any) => n.region) as string[]).filter(Boolean),
    );
    // 合并「无地图节点的区域」：用户通过区域管理新建、尚未归入任何节点的区域（仅存于 Region 实体）
    const entityWhere: any = competitionId ? { competitionId } : {};
    const regionEntities = await this.prisma.region.findMany({
      where: entityWhere,
      select: { id: true, name: true },
    });
    const entityIdMap = new Map<string, number>();
    for (const r of regionEntities) {
      regionNames.add(r.name);
      entityIdMap.set(r.name, r.id);
    }
    const result: any[] = [];
    for (const name of regionNames) {
      const regionId = entityIdMap.get(name as string) ?? null;
      const region = regionId ? await this.getRegionByName(competitionId, name as string) : null;
      const cards = region ? parseCards(region.overviewCards) : [];
      const resolved = await this.resolveCards(cards);
      const companies = await this.getLocalCompanies(competitionId, name as string);
      result.push({ id: regionId, region: name, companies, cards: resolved });
    }
    return result;
  }

  /**
   * 取某区域总览卡片的实时字段值，供外部模块「绑定区域总览字段」实时引用。
   * 找不到区域 / 卡片 / 卡片失效时返回 null。
   */
  async getCardValue(competitionId: number | undefined, region: string, cardId: string): Promise<number | null> {
    const overview = await this.getMapOverview(competitionId);
    const regionEntry = overview.find((r) => r.region === region);
    if (!regionEntry) return null;
    const card = regionEntry.cards.find((c) => c.id === cardId);
    if (!card || !card.valid) return null;
    return typeof card.value === "number" ? card.value : null;
  }

  /** 按区域名保存总览卡片配置（region 不存在则 find-or-create）。 */
  async saveOverviewCardsByName(competitionId: number | undefined, name: string, dto: SaveOverviewCardsDto) {
    let region = await this.getRegionByName(competitionId, name);
    if (!region) {
      region = await this.prisma.region.create({
        data: { name, competitionId: competitionId ?? null, overviewCards: serializeCards([]) },
      });
    }
    const updated = await this.prisma.region.update({
      where: { id: region.id },
      data: { overviewCards: serializeCards(dto.cards) },
    });
    this.realtime.emitResourceChanged("region", updated.id, updated.competitionId ?? null, "updated");
    return { success: true };
  }

  /** 保存总览卡片配置（覆盖写 overviewCards JSON）。 */
  async saveOverviewCards(id: number, dto: SaveOverviewCardsDto) {
    await this.findOne(id);
    const region = await this.prisma.region.update({
      where: { id },
      data: { overviewCards: serializeCards(dto.cards) },
    });
    this.realtime.emitResourceChanged("region", region.id, region.competitionId ?? null, "updated");
    return { success: true };
  }
}
