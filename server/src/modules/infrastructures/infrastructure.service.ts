import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateInfrastructureDto, UpdateInfrastructureDto } from "./dto/infrastructure.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { DeleteImpact, DeleteImpactItem } from "../../common/types/delete-impact";

@Injectable()
export class InfrastructureService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.infrastructure.findMany({ where, orderBy: { updatedAt: "desc" } });
      const existingIds = requireExistingIds
        ? (await this.prisma.infrastructure.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.infrastructure.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.infrastructure.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: number) {
    const item = await this.prisma.infrastructure.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("基础设施不存在");
    return item;
  }

  async create(dto: CreateInfrastructureDto) {
    const existing = await this.prisma.infrastructure.findFirst({
      where: { competitionId: dto.competitionId, name: dto.name },
    });
    if (existing) throw new ConflictException("基建名称已存在");
    return this.prisma.infrastructure.create({ data: dto });
  }

  async update(id: number, dto: UpdateInfrastructureDto) {
    const item = await this.findOne(id);
    if (dto.name) {
      const existing = await this.prisma.infrastructure.findFirst({
        where: { competitionId: item.competitionId, name: dto.name, NOT: { id } },
      });
      if (existing) throw new ConflictException("基建名称已存在");
    }
    return this.prisma.infrastructure.update({ where: { id }, data: dto });
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.infrastructure.delete({ where: { id } });
    return { message: "已删除" };
  }

  /**
   * 计算删除该基建时的级联影响（基建无其它表引用，故无级联子数据，仅占位保证删除体验一致）。
   */
  async getInfrastructureImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findOne(id);
    return { name: item.name, children: [] as DeleteImpactItem[] };
  }
}
