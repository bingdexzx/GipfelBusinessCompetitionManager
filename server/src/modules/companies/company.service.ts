import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateCompanyDto, UpdateCompanyDto, UpdateFieldValueDto } from "./dto/company.dto";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { DeleteImpact, DeleteImpactItem } from "../../common/types/delete-impact";

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    competitionId?: number,
    updatedAfter?: string,
    regionId?: number,
    scopes?: number[] | null,
    requireExistingIds = false,
    previousIds?: number[],
  ) {
    const baseWhere: any = competitionId ? { competitionId } : {};
    if (regionId !== undefined) baseWhere.regionId = regionId;
    // 公司范围过滤：仅返回 companyScopes 内公司（空范围/超管/管理者不传此参数，即不过滤）
    if (scopes && scopes.length > 0) baseWhere.id = { in: scopes };
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const items = await this.prisma.company.findMany({
          where,
          include: { industryType: true, _count: true },
          orderBy: { updatedAt: "desc" },
        });
      const allCurrentIds = requireExistingIds
        ? (await this.prisma.company.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(items, allCurrentIds, previousIds);
    }
    return this.prisma.company.findMany({
      where,
      include: { industryType: true, _count: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  async findOne(id: number, scopes?: number[] | null) {
    // 范围外公司（仅 company:view 角色受 companyScopes 约束）：拒绝访问
    if (scopes && scopes.length > 0 && !scopes.includes(id)) {
      throw new ForbiddenException("无权访问该公司数据");
    }
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        industryType: true,
        _count: true,
      },
    });
    if (!company) throw new NotFoundException("公司不存在");
    return company;
  }

  async create(dto: CreateCompanyDto) {
    return this.prisma.company.create({
      data: {
        name: dto.name,
        industryTypeId: dto.industryTypeId,
        competitionId: dto.competitionId,
        regionId: dto.regionId,
      },
    });
  }

  async update(id: number, dto: UpdateCompanyDto) {
    await this.findOne(id);
    return this.prisma.company.update({ where: { id }, data: dto });
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.company.delete({ where: { id } });
    return { message: "已删除" };
  }

  /**
   * 计算删除该公司时将级联删除的子数据（用于前端删除前的危险提示）。
   * 删除公司会级联清除其产业字段值（CompanyFieldValue onDelete: Cascade）。
   */
  async getCompanyImpact(id: number, scopes?: number[] | null): Promise<DeleteImpact> {
    const item = await this.findOne(id, scopes);
    const children: DeleteImpactItem[] = [];
    const fieldCount = await this.prisma.companyFieldValue.count({ where: { companyId: id } });
    if (fieldCount > 0) {
      children.push({ label: "公司产业字段值", count: fieldCount });
    }
    return { name: item.name, children };
  }
}
