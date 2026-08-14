import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateCompetitionDto, UpdateCompetitionDto } from "./dto/competition.dto";
import { RealtimeService } from "../../realtime/realtime.service";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";

@Injectable()
export class CompetitionService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
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
    return this.prisma.fiscalYear.create({ data: { competitionId, year: dto.year } });
  }

  async updateFiscalYear(id: number, dto: { status?: string }) {
    const fy = await this.prisma.fiscalYear.findUnique({ where: { id } });
    if (!fy) throw new NotFoundException("财年不存在");
    const updated = await this.prisma.fiscalYear.update({ where: { id }, data: dto });
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
