import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateFuelDto, UpdateFuelDto } from "./dto/fuel.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { DeleteImpact, DeleteImpactItem } from "../../common/types/delete-impact";

@Injectable()
export class FuelService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.fuel.findMany({ where, orderBy: { updatedAt: "desc" } });
      const existingIds = requireExistingIds
        ? (await this.prisma.fuel.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.fuel.findMany({ where, skip, take: pageSize, orderBy: { updatedAt: "desc" } }),
      this.prisma.fuel.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: number) {
    const item = await this.prisma.fuel.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("燃料不存在");
    return item;
  }

  async create(dto: CreateFuelDto) {
    const existing = await this.prisma.fuel.findFirst({
      where: { competitionId: dto.competitionId, name: dto.name },
    });
    if (existing) throw new ConflictException("燃料名称已存在");
    return this.prisma.fuel.create({ data: dto });
  }

  async update(id: number, dto: UpdateFuelDto) {
    const item = await this.findOne(id);
    if (dto.name) {
      const existing = await this.prisma.fuel.findFirst({
        where: { competitionId: item.competitionId, name: dto.name, NOT: { id } },
      });
      if (existing) throw new ConflictException("燃料名称已存在");
    }
    return this.prisma.fuel.update({ where: { id }, data: dto });
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    // Vehicle.fuelId 无 onDelete（迁移为 ON DELETE RESTRICT）：若有载具仍引用该燃料，
    // 直接 delete 会触发外键约束硬报错（500）。此处前置校验给出清晰提示，避免点确认后崩溃。
    const vehicleCount = await this.prisma.vehicle.count({ where: { fuelId: id } });
    if (vehicleCount > 0) {
      throw new ConflictException(`该燃料正被 ${vehicleCount} 个载具使用，无法删除（请先为这些载具更换燃料）`);
    }
    await this.prisma.fuel.delete({ where: { id } });
    return { message: "已删除" };
  }

  /**
   * 删除燃料前的危险提示。
   * 注意：Vehicle.fuelId 未声明 onDelete（迁移 RESTRICT，非 Cascade）——删除燃料并不会级联删除载具，
   * 反而会被外键阻止。因此燃料本身没有「将被级联删除」的子数据，children 返回空；
   * 实际删除能否成功由 remove() 的前置校验（有无载具引用）决定。
   */
  async getFuelImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findOne(id);
    return { name: item.name, children: [] as DeleteImpactItem[] };
  }
}
