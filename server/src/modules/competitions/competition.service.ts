import { Injectable, NotFoundException, ConflictException, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateCompetitionDto, UpdateCompetitionDto } from "./dto/competition.dto";
import { RealtimeService } from "../../realtime/realtime.service";
import { CompanyFieldsService } from "../company-fields/company-fields.service";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";

@Injectable()
export class CompetitionService {
  private readonly logger = new Logger(CompetitionService.name);
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private companyFields: CompanyFieldsService,
  ) {}

  async findAll(updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.competition.findMany({
          where,
          include: { fiscalYears: true, _count: { select: { users: true, companies: true } } },
          orderBy: { updatedAt: "desc" },
        });
      const existingIds = requireExistingIds
        ? (await this.prisma.competition.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    return this.prisma.competition.findMany({
      where,
      include: { fiscalYears: true, _count: { select: { users: true, companies: true } } },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.competition.findUnique({
      where: { id },
      include: { _count: { select: { users: true, companies: true } } },
    });
    if (!item) throw new NotFoundException("比赛不存在");
    return item;
  }

  async create(dto: CreateCompetitionDto) {
    const existing = await this.prisma.competition.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException("比赛名称已存在");
    return this.prisma.competition.create({ data: dto });
  }

  async update(id: number, dto: UpdateCompetitionDto) {
    await this.findOne(id);
    if (dto.name) {
      const existing = await this.prisma.competition.findFirst({
        where: { name: dto.name, NOT: { id } },
      });
      if (existing) throw new ConflictException("比赛名称已存在");
    }
    const updated = await this.prisma.competition.update({ where: { id }, data: dto });
    // 强时效：比赛状态变更实时广播给该比赛所有前端
    this.realtime.broadcastToCompetition(id, "competition:changed", updated);
    return updated;
  }

  async remove(id: number) {
    await this.findOne(id);
    // 删除比赛会通过 schema 中配置的 onDelete: Cascade 联级删除其下全部数据：
    // 财年、用户、公司、原料/零件/产品、科技树、地图节点/边/类型、路径类型、
    // 基建、燃料、载具、仓库、生产线、合同等。包裹在事务中保证原子性。
    return this.prisma.$transaction(async (tx) => {
      return tx.competition.delete({ where: { id } });
    });
  }

  // ===== 财年管理 =====
  async getFiscalYears(competitionId: number) {
    await this.findOne(competitionId);
    return this.prisma.fiscalYear.findMany({
      where: { competitionId },
      orderBy: { year: "asc" },
    });
  }

  async createFiscalYear(competitionId: number, dto: { year: number }) {
    await this.findOne(competitionId);
    const existing = await this.prisma.fiscalYear.findUnique({
      where: { competitionId_year: { competitionId, year: dto.year } },
    });
    if (existing) throw new ConflictException("该财年已存在");
    const created = await this.prisma.fiscalYear.create({ data: { competitionId, year: dto.year } });
    // 新建财年默认 ACTIVE，即视为「财年开始(FY_START)」，触发相关产业字段定时器
    try {
      await this.companyFields.applyFiscalYearTimer(competitionId, "FY_START");
    } catch (err: any) {
      this.logger.warn(`新建财年 #${created.id} 定时器执行失败：${err?.message || err}`);
    }
    return created;
  }

  async updateFiscalYear(id: number, dto: { status?: string }) {
    const fy = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!fy) throw new NotFoundException("财年不存在");
    const prevStatus = fy.status;
    const updated = await this.prisma.fiscalYear.update({ where: { id }, data: dto });
    // 由状态切换推导财年定时器触发时机：非 ACTIVE→ACTIVE 视为 FY_START；非 CLOSED→CLOSED 视为 FY_END。
    // 状态未跨上述边界（如 ACTIVE→ACTIVE/CLOSED→CLOSED，或 ACTIVE→CLOSED 之外的其它情形）则不触发。
    let trigger: "FY_START" | "FY_END" | null = null;
    if (prevStatus !== "ACTIVE" && updated.status === "ACTIVE") trigger = "FY_START";
    else if (prevStatus !== "CLOSED" && updated.status === "CLOSED") trigger = "FY_END";
    if (trigger) {
      try {
        await this.companyFields.applyFiscalYearTimer(updated.competitionId, trigger);
      } catch (err: any) {
        this.logger.warn(`财年 #${id} 定时器执行失败：${err?.message || err}`);
      }
    }
    // 强时效：财年开始/关闭后实时广播给该比赛所有前端，使其即刻同步
    this.realtime.broadcastToCompetition(updated.competitionId, "fiscal-year:changed", {
      competitionId: updated.competitionId,
      fiscalYear: updated,
    });
    return updated;
  }

  async deleteFiscalYear(id: number) {
    const fy = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!fy) throw new NotFoundException("财年不存在");
    return this.prisma.fiscalYear.delete({ where: { id } });
  }
}
