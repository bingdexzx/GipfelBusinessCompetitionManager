import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateVehicleDto, UpdateVehicleDto } from "./dto/vehicle.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { DeleteImpact, DeleteImpactItem } from "../../common/types/delete-impact";

@Injectable()
export class VehicleService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, pageSize = 50, competitionId?: number, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId ? { competitionId } : {};
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.vehicle.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          include: {
            fuel: true,
            vehiclePathTypes: { include: { pathType: true } },
          },
        });
      const existingIds = requireExistingIds
        ? (await this.prisma.vehicle.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, existingIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: "desc" },
        include: {
          fuel: true,
          vehiclePathTypes: { include: { pathType: true } },
        },
      }),
      this.prisma.vehicle.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findOne(id: number) {
    const item = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        fuel: true,
        vehiclePathTypes: { include: { pathType: true } },
      },
    });
    if (!item) throw new NotFoundException("车辆不存在");
    return item;
  }

  async create(dto: CreateVehicleDto) {
    const existing = await this.prisma.vehicle.findFirst({
      where: { competitionId: dto.competitionId, name: dto.name },
    });
    if (existing) throw new ConflictException("载具名称已存在");
    const pathTypes = (dto.pathTypeIds || []).map((ptId: number) => ({ pathTypeId: ptId }));
    const { vehiclePathTypes, pathTypeIds: _pathTypeIds, ...data } = dto;
    return this.prisma.vehicle.create({
      data: {
        ...data,
        vehiclePathTypes: {
          create: vehiclePathTypes || pathTypes,
        },
      },
      include: {
        fuel: true,
        vehiclePathTypes: { include: { pathType: true } },
      },
    });
  }

  async update(id: number, dto: UpdateVehicleDto) {
    const item = await this.findOne(id);
    if (dto.name) {
      const existing = await this.prisma.vehicle.findFirst({
        where: { competitionId: item.competitionId, name: dto.name, NOT: { id } },
      });
      if (existing) throw new ConflictException("载具名称已存在");
    }
    const pathTypes = (dto.pathTypeIds || []).map((ptId: number) => ({ pathTypeId: ptId }));
    const { vehiclePathTypes, pathTypeIds: _pathTypeIds, ...data } = dto;

    return this.prisma.$transaction(async (tx) => {
      if (vehiclePathTypes || pathTypes.length > 0) {
        await tx.vehiclePathType.deleteMany({ where: { vehicleId: id } });
        await tx.vehiclePathType.createMany({
          data: (vehiclePathTypes || pathTypes).map((vpt) => ({ vehicleId: id, ...vpt })),
        });
      }

      return tx.vehicle.update({
        where: { id },
        data,
        include: {
          fuel: true,
          vehiclePathTypes: { include: { pathType: true } },
        },
      });
    });
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.vehicle.delete({ where: { id } });
    return { message: "已删除" };
  }

  /**
   * 计算删除该载具时将级联删除的子数据（用于前端删除前的危险提示）。
   * 载具删除会级联清除其通行路径配置（VehiclePathType onDelete: Cascade）。
   */
  async getVehicleImpact(id: number): Promise<DeleteImpact> {
    const item = await this.findOne(id);
    const children: DeleteImpactItem[] = [];
    const pathTypeCount = await this.prisma.vehiclePathType.count({ where: { vehicleId: id } });
    if (pathTypeCount > 0) {
      children.push({ label: "载具通行路径配置", count: pathTypeCount });
    }
    return { name: item.name, children };
  }
}
