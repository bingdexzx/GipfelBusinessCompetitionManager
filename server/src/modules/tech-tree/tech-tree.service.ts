import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateTechNodeDto, UpdateTechNodeDto } from "./dto/tech-node.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { DeleteImpact, DeleteImpactItem } from "../../common/types/delete-impact";

@Injectable()
export class TechTreeService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false, previousIds?: number[]) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.techNode.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          include: { prerequisites: { include: { prerequisite: { select: { name: true } } } } },
        });
      const allCurrentIds = requireExistingIds
        ? (await this.prisma.techNode.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, allCurrentIds, previousIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.techNode.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
        include: { prerequisites: { include: { prerequisite: { select: { name: true } } } } },
      }),
      this.prisma.techNode.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: number) {
    const item = await this.prisma.techNode.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("科技节点不存在");
    return item;
  }

  async create(dto: CreateTechNodeDto) {
    const existing = await this.prisma.techNode.findFirst({
      where: { competitionId: dto.competitionId, name: dto.name },
    });
    if (existing) throw new ConflictException("科技节点名称已存在");
    const { prerequisites, ...data } = dto;
    return this.prisma.techNode.create({
      data: {
        ...data,
        prerequisites: prerequisites?.length ? { create: prerequisites } : undefined,
      },
    });
  }

  async update(id: number, dto: UpdateTechNodeDto) {
    const item = await this.findOne(id);
    if (dto.name) {
      const existing = await this.prisma.techNode.findFirst({
        where: { competitionId: item.competitionId, name: dto.name, NOT: { id } },
      });
      if (existing) throw new ConflictException("科技节点名称已存在");
    }
    const { prerequisites, ...data } = dto;
    if (prerequisites) {
      await this.prisma.techPrerequisite.deleteMany({ where: { nodeId: id } });
      await this.prisma.techNode.update({
        where: { id },
        data: {
          ...data,
          prerequisites: { create: prerequisites },
        },
      });
      return this.findOne(id);
    }
    return this.prisma.techNode.update({ where: { id }, data });
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.techNode.delete({ where: { id } });
    return { message: "已删除" };
  }

  /**
   * 计算删除该科技节点时将级联删除的子数据（用于前端删除前的危险提示）。
   * 删除节点会级联删除：其前置依赖关系、引用它的零件/产品科技需求、以及以它为前置的其它科技节点。
   */
  async getTechNodeImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findOne(id);
    const children: DeleteImpactItem[] = [];
    const partReq = await this.prisma.partTechRequirement.count({ where: { techNodeId: id } });
    if (partReq > 0) children.push({ label: "零件科技需求", count: partReq });
    const productReq = await this.prisma.productTechRequirement.count({ where: { techNodeId: id } });
    if (productReq > 0) children.push({ label: "产品科技需求", count: productReq });
    // TechPrerequisite 的两个外键 nodeId / prerequisiteNodeId 均为 onDelete: Cascade：
    // 删除本节点会同时级联删除「本节点作为前提的依赖关系」(nodeId) 与「以本节点为前提的关系」(prerequisiteNodeId)。
    const requires = await this.prisma.techPrerequisite.count({ where: { nodeId: id } });
    if (requires > 0) children.push({ label: "该节点的前提依赖关系", count: requires });
    const requiredBy = await this.prisma.techPrerequisite.count({ where: { prerequisiteNodeId: id } });
    if (requiredBy > 0) children.push({ label: "以该科技为前提的科技关系", count: requiredBy });
    return { name: item.name, children };
  }
}
