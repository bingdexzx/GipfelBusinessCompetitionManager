import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreatePartDto, UpdatePartDto } from "./dto/part.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { DeleteImpact, DeleteImpactItem } from "../../common/types/delete-impact";

@Injectable()
export class PartService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false, previousIds?: number[]) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.part.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          include: {
            partMaterials: { include: { material: true } },
            techRequirements: { include: { techNode: true } },
          },
        });
      const allCurrentIds = requireExistingIds
        ? (await this.prisma.part.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, allCurrentIds, previousIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.part.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
        include: {
          partMaterials: { include: { material: true } },
          techRequirements: { include: { techNode: true } },
        },
      }),
      this.prisma.part.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: number) {
    const item = await this.prisma.part.findUnique({
      where: { id },
      include: {
        partMaterials: { include: { material: true } },
        techRequirements: { include: { techNode: true } },
      },
    });
    if (!item) throw new NotFoundException("部件不存在");
    return item;
  }

  async create(dto: CreatePartDto) {
    const { partMaterials, techRequirements, ...data } = dto;
    const existing = await this.prisma.part.findFirst({
      where: { competitionId: data.competitionId, name: data.name },
    });
    if (existing) throw new ConflictException("零件名称已存在");
    return this.prisma.part.create({
      data: {
        ...data,
        partMaterials: {
          create: partMaterials,
        },
        techRequirements: {
          create: techRequirements,
        },
      },
      include: {
        partMaterials: { include: { material: true } },
        techRequirements: { include: { techNode: true } },
      },
    });
  }

  async update(id: number, dto: UpdatePartDto) {
    await this.findOne(id);
    const { partMaterials, techRequirements, ...data } = dto;

    return this.prisma.$transaction(async (tx) => {
      if (partMaterials) {
        await tx.partMaterial.deleteMany({ where: { partId: id } });
        await tx.partMaterial.createMany({
          data: partMaterials.map((pm) => ({ partId: id, ...pm })),
        });
      }
      if (techRequirements) {
        await tx.partTechRequirement.deleteMany({ where: { partId: id } });
        await tx.partTechRequirement.createMany({
          data: techRequirements.map((tr) => ({ partId: id, ...tr })),
        });
      }

      return tx.part.update({
        where: { id },
        data,
        include: {
          partMaterials: { include: { material: true } },
          techRequirements: { include: { techNode: true } },
        },
      });
    });
  }

  /**
   * 计算删除该零件时将级联删除的子数据（用于前端删除前的危险提示）。
   * 零件被零件配比（PartMaterial）、产品配比（ProductPart）、科技需求（PartTechRequirement）引用，
   * 删除零件会级联删除这些关联行（不会删除引用的其它零件/产品实体本身）。
   */
  async getDeleteImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findOne(id);
    const children: DeleteImpactItem[] = [];
    const partMaterialCount = await this.prisma.partMaterial.count({
      where: { partId: id },
    });
    if (partMaterialCount > 0) {
      children.push({ label: "原料配比关系", count: partMaterialCount });
    }
    const productPartCount = await this.prisma.productPart.count({
      where: { partId: id },
    });
    if (productPartCount > 0) {
      children.push({ label: "作为组件被产品引用", count: productPartCount });
    }
    const techRequirementCount = await this.prisma.partTechRequirement.count({
      where: { partId: id },
    });
    if (techRequirementCount > 0) {
      children.push({ label: "科技树需求关联", count: techRequirementCount });
    }
    return { name: item.name, children };
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.part.delete({ where: { id } });
    return { message: "已删除" };
  }
}
