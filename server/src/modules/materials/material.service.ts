import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateMaterialDto, UpdateMaterialDto } from "./dto/material.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import type { DeleteImpactItem, DeleteImpact } from "../../common/types/delete-impact";
import { validateMaterialNodePrices } from "../../common/validators/json-schema";
import { assertValidated } from "../../common/assert-validated";

@Injectable()
export class MaterialService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false, previousIds?: number[]) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.material.findMany({ where, orderBy: { updatedAt: "desc" } });
      const allCurrentIds = requireExistingIds
        ? (await this.prisma.material.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, allCurrentIds, previousIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.material.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
      }),
      this.prisma.material.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: number) {
    const item = await this.prisma.material.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("原料不存在");
    return item;
  }

  async create(dto: CreateMaterialDto) {
    // 校验 nodePrices JSON
    if (dto.nodePrices) {
      assertValidated(validateMaterialNodePrices(dto.nodePrices));
    }
    const existing = await this.prisma.material.findFirst({
      where: { competitionId: dto.competitionId, name: dto.name },
    });
    if (existing) throw new ConflictException("原料名称已存在");
    return this.prisma.material.create({ data: dto });
  }

  async update(id: number, dto: UpdateMaterialDto) {
    // 校验 nodePrices JSON
    if (dto.nodePrices) {
      assertValidated(validateMaterialNodePrices(dto.nodePrices));
    }
    const item = await this.findOne(id);
    if (dto.name) {
      const existing = await this.prisma.material.findFirst({
        where: { competitionId: item.competitionId, name: dto.name, NOT: { id } },
      });
      if (existing) throw new ConflictException("原料名称已存在");
    }
    return this.prisma.material.update({ where: { id }, data: dto });
  }

  /**
   * 计算删除该原料时将级联删除的子数据（用于前端删除前的危险提示）。
   * 原料被零件配比（PartMaterial）引用，删除原料会级联删除这些配比关系。
   */
  async getDeleteImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findOne(id);
    const children: DeleteImpactItem[] = [];
    const partMaterialCount = await this.prisma.partMaterial.count({ where: { materialId: id } });
    if (partMaterialCount > 0) {
      children.push({ label: "关联的零件配比关系", count: partMaterialCount });
    }
    return { name: item.name, children };
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.material.delete({ where: { id } });
    return { message: "已删除" };
  }
}
