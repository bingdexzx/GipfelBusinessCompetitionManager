import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { RealtimeService } from "../../realtime/realtime.service";
import { CompanyFieldsService } from "../company-fields/company-fields.service";
import { CreateConsumerDemandDto, UpdateConsumerDemandDto } from "./dto/consumer-demand.dto";
import { assertSameCompetition } from "../../common/scope";

@Injectable()
export class ConsumerDemandService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private companyFields: CompanyFieldsService,
  ) {}

  /** 按比赛 + 可选区域过滤列出消费者需求（区域总览前端会按区域分组）。 */
  async findAll(competitionId?: number, region?: string) {
    const where: any = {};
    if (competitionId) where.competitionId = competitionId;
    if (region) where.region = region;
    return this.prisma.consumerDemand.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });
  }

  async findOne(id: number) {
    const item = await this.prisma.consumerDemand.findUnique({ where: { id } });
    if (!item) throw new NotFoundException("消费者需求不存在");
    return item;
  }

  /**
   * 按产品 id 解析产品名称（冗余写入 productType，便于产品被删后需求仍可读）。
   * 产品不存在抛 404。产品 id 为可选时仅在校验存在性，不强制。
   */
  private async resolveProductName(productId: number): Promise<string> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException("关联的产品不存在");
    return product.name;
  }

  async create(dto: CreateConsumerDemandDto) {
    const productType = await this.resolveProductName(dto.productId);
    const item = await this.prisma.consumerDemand.create({
      data: {
        competitionId: dto.competitionId ?? null,
        region: dto.region,
        productId: dto.productId,
        productType,
        quantity: dto.quantity ?? 0,
        note: dto.note,
      },
    });
    this.realtime.emitResourceChanged("consumer-demand", item.id, item.competitionId ?? null, "created");
    // 需求变更会影响依赖 CONSUMER_DEMAND 数据源的计算字段（如产品件数求和），
    // 重算本比赛下受影响公司的计算字段并广播，前端三处展示会自动刷新。
    if (item.competitionId != null) {
      await this.companyFields.recomputeConsumerDemandDependentFields(item.competitionId, item.region);
    }
    return item;
  }

  async update(id: number, dto: UpdateConsumerDemandDto) {
    await this.findOne(id);
    const data: any = {};
    if (dto.region !== undefined) data.region = dto.region;
    if (dto.productId !== undefined) {
      data.productId = dto.productId;
      data.productType = await this.resolveProductName(dto.productId);
    }
    if (dto.quantity !== undefined) data.quantity = dto.quantity;
    if (dto.note !== undefined) data.note = dto.note;
    const updated = await this.prisma.consumerDemand.update({ where: { id }, data });
    this.realtime.emitResourceChanged("consumer-demand", id, updated.competitionId ?? null, "updated");
    if (updated.competitionId != null) {
      await this.companyFields.recomputeConsumerDemandDependentFields(updated.competitionId, updated.region);
    }
    return updated;
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.findOne(id);
    assertSameCompetition(item.competitionId, competitionId);
    await this.prisma.consumerDemand.delete({ where: { id } });
    this.realtime.emitResourceChanged("consumer-demand", id, item.competitionId ?? null, "deleted");
    if (item.competitionId != null) {
      await this.companyFields.recomputeConsumerDemandDependentFields(item.competitionId, item.region);
    }
    return { message: "已删除" };
  }
}
