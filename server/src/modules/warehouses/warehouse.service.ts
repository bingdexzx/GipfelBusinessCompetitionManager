import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateWarehouseDto, UpdateWarehouseDto } from "./dto/warehouse.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { DeleteImpact, DeleteImpactItem } from "../../common/types/delete-impact";

@Injectable()
export class WarehouseService {
  constructor(private prisma: PrismaService) {}

  async findAll(competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.warehouse.findMany({ where, orderBy: { updatedAt: "desc" } });
      const existingIds = requireExistingIds
        ? (await this.prisma.warehouse.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    return this.prisma.warehouse.findMany({ where, orderBy: { updatedAt: "desc" } });
  }

  async findOne(id: number) {
    const item = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("仓库不存在");
    return item;
  }

  async create(dto: CreateWarehouseDto) {
    const existing = await this.prisma.warehouse.findFirst({
      where: { competitionId: dto.competitionId, name: dto.name },
    });
    if (existing) throw new ConflictException("仓库名称已存在");
    return this.prisma.warehouse.create({ data: dto });
  }

  async update(id: number, dto: UpdateWarehouseDto) {
    const item = await this.findOne(id);
    if (dto.name) {
      const existing = await this.prisma.warehouse.findFirst({
        where: { competitionId: item.competitionId, name: dto.name, NOT: { id } },
      });
      if (existing) throw new ConflictException("仓库名称已存在");
    }
    return this.prisma.warehouse.update({ where: { id }, data: dto });
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    return this.prisma.warehouse.delete({ where: { id } });
  }

  /**
   * 计算删除该仓库时的级联影响（仓库无其它表引用，故无级联子数据，仅占位保证删除体验一致）。
   */
  async getWarehouseImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findOne(id);
    return { name: item.name, children: [] as DeleteImpactItem[] };
  }
}
