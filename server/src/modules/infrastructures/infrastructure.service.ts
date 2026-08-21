import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateInfrastructureDto, UpdateInfrastructureDto } from "./dto/infrastructure.dto";
import { assertSameCompetition } from "../../common/scope";
import { BaseCrudService } from "../../common/base-crud.service";
import { DeleteImpact, DeleteImpactItem } from "../../common/types/delete-impact";

@Injectable()
export class InfrastructureService extends BaseCrudService {
  constructor(protected readonly prisma: PrismaService) {
    super(prisma);
  }

  async findAll(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    return this.findAllGeneric(this.prisma.infrastructure, { page, pageSize, competitionId, updatedAfter, requireExistingIds });
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
