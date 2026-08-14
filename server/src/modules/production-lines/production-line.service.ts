import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateProductionLineDto, UpdateProductionLineDto } from "./dto/production-line.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { DeleteImpact, DeleteImpactItem } from "../materials/material.service";

@Injectable()
export class ProductionLineService {
  constructor(private prisma: PrismaService) {}

  async findAll(competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.productionLine.findMany({ where, orderBy: { updatedAt: "desc" } });
      const existingIds = requireExistingIds
        ? (await this.prisma.productionLine.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    return this.prisma.productionLine.findMany({ where, orderBy: { updatedAt: "desc" } });
  }

  async findOne(id: number) {
    const item = await this.prisma.productionLine.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("生产线不存在");
    return item;
  }

  async create(dto: CreateProductionLineDto) {
    const existing = await this.prisma.productionLine.findFirst({
      where: { competitionId: dto.competitionId, name: dto.name },
    });
    if (existing) throw new ConflictException("生产线名称已存在");
    return this.prisma.productionLine.create({ data: dto });
  }

  async update(id: number, dto: UpdateProductionLineDto) {
    const item = await this.findOne(id);
    if (dto.name) {
      const existing = await this.prisma.productionLine.findFirst({
        where: { competitionId: item.competitionId, name: dto.name, NOT: { id } },
      });
      if (existing) throw new ConflictException("生产线名称已存在");
    }
    return this.prisma.productionLine.update({ where: { id }, data: dto });
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    return this.prisma.productionLine.delete({ where: { id } });
  }

  /**
   * 计算删除该生产线时的级联影响（生产线无其它表引用，故无级联子数据，仅占位保证删除体验一致）。
   */
  async getProductionLineImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findOne(id);
    return { name: item.name, children: [] as DeleteImpactItem[] };
  }
}
