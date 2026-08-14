import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateProductDto, UpdateProductDto } from "./dto/product.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { DeleteImpact, DeleteImpactItem } from "../materials/material.service";

@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.product.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          include: {
            productParts: { include: { part: true } },
            techRequirements: { include: { techNode: true } },
          },
        });
      const existingIds = requireExistingIds
        ? (await this.prisma.product.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
        include: {
          productParts: { include: { part: true } },
          techRequirements: { include: { techNode: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: number) {
    const item = await this.prisma.product.findUnique({
      where: { id },
      include: {
        productParts: { include: { part: true } },
        techRequirements: { include: { techNode: true } },
      },
    });
    if (!item) throw new NotFoundException("产品不存在");
    return item;
  }

  async create(dto: CreateProductDto) {
    const { productParts, techRequirements, ...data } = dto;
    const existing = await this.prisma.product.findFirst({
      where: { competitionId: data.competitionId, name: data.name },
    });
    if (existing) throw new ConflictException("产品名称已存在");
    return this.prisma.product.create({
      data: {
        ...data,
        productParts: {
          create: productParts,
        },
        techRequirements: {
          create: techRequirements,
        },
      },
      include: {
        productParts: { include: { part: true } },
        techRequirements: { include: { techNode: true } },
      },
    });
  }

  async update(id: number, dto: UpdateProductDto) {
    await this.findOne(id);
    const { productParts, techRequirements, ...data } = dto;

    return this.prisma.$transaction(async (tx) => {
      if (productParts) {
        await tx.productPart.deleteMany({ where: { productId: id } });
        await tx.productPart.createMany({
          data: productParts.map((pp) => ({ productId: id, ...pp })),
        });
      }
      if (techRequirements) {
        await tx.productTechRequirement.deleteMany({ where: { productId: id } });
        await tx.productTechRequirement.createMany({
          data: techRequirements.map((tr) => ({ productId: id, ...tr })),
        });
      }

      return tx.product.update({
        where: { id },
        data,
        include: {
          productParts: { include: { part: true } },
          techRequirements: { include: { techNode: true } },
        },
      });
    });
  }

  /**
   * 计算删除该产品时将级联删除的子数据（用于前端删除前的危险提示）。
   * 产品被产品配比（ProductPart）、科技需求（ProductTechRequirement）引用，
   * 删除产品会级联删除这些关联行（不会删除引用的零件实体本身）。
   */
  async getDeleteImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findOne(id);
    const children: DeleteImpactItem[] = [];
    const productPartCount = await this.prisma.productPart.count({
      where: { productId: id },
    });
    if (productPartCount > 0) {
      children.push({ label: "组件配比关系", count: productPartCount });
    }
    const techRequirementCount = await this.prisma.productTechRequirement.count({
      where: { productId: id },
    });
    if (techRequirementCount > 0) {
      children.push({ label: "科技树需求关联", count: techRequirementCount });
    }
    return { name: item.name, children };
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.product.delete({ where: { id } });
    return { message: "已删除" };
  }
}
