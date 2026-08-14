import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateContractTypeDto, UpdateContractTypeDto } from "./dto/contract-type.dto";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";

@Injectable()
export class ContractTypeService {
  constructor(private readonly prisma: PrismaService) {}

  private toStored(value: any): string {
    if (value == null) return "[]";
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  async findAll(enabledOnly?: boolean, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = enabledOnly ? { enabled: true } : undefined;
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const rows = await this.prisma.contractType.findMany({ where, orderBy: { id: "asc" } });
      const existingIds = requireExistingIds
        ? (await this.prisma.contractType.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(rows.map((it) => this.toResponse(it)), existingIds);
    }
    const items = await this.prisma.contractType.findMany({
      where: baseWhere,
      orderBy: { id: "asc" },
    });
    return items.map((it) => this.toResponse(it));
  }

  async findOne(id: number) {
    const item = await this.prisma.contractType.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`合同类型 ${id} 不存在`);
    return this.toResponse(item);
  }

  async create(dto: CreateContractTypeDto) {
    this.validateJson(dto.partyRoles, "partyRoles");
    this.validateJson(dto.inputSchema, "inputSchema");
    this.validateJson(dto.effects, "effects");
    if (dto.conditions !== undefined) this.validateJson(dto.conditions, "conditions");
    if (dto.graph !== undefined) this.validateJson(dto.graph, "graph");

    const existing = await this.prisma.contractType.findUnique({
      where: { key: dto.key },
    });
    if (existing) throw new BadRequestException(`合同类型 key 已存在: ${dto.key}`);

    const created = await this.prisma.contractType.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        partyCount: this.partyCountFrom(dto.partyRoles),
        partyRoles: this.toStored(dto.partyRoles),
        inputSchema: this.toStored(dto.inputSchema),
        effects: this.toStored(dto.effects),
        conditions: this.toStored(dto.conditions ?? []),
        graph: dto.graph !== undefined ? this.toStored(dto.graph) : null,
        enabled: dto.enabled ?? true,
      },
    });
    return this.toResponse(created);
  }

  async update(id: number, dto: UpdateContractTypeDto) {
    const item = await this.prisma.contractType.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`合同类型 ${id} 不存在`);

    if (dto.partyRoles !== undefined) this.validateJson(dto.partyRoles, "partyRoles");
    if (dto.inputSchema !== undefined) this.validateJson(dto.inputSchema, "inputSchema");
    if (dto.effects !== undefined) this.validateJson(dto.effects, "effects");
    if (dto.conditions !== undefined) this.validateJson(dto.conditions, "conditions");
    if (dto.graph !== undefined) this.validateJson(dto.graph, "graph");

    const updated = await this.prisma.contractType.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.partyRoles !== undefined
          ? {
              partyRoles: this.toStored(dto.partyRoles),
              partyCount: this.partyCountFrom(dto.partyRoles),
            }
          : {}),
        ...(dto.inputSchema !== undefined ? { inputSchema: this.toStored(dto.inputSchema) } : {}),
        ...(dto.effects !== undefined ? { effects: this.toStored(dto.effects) } : {}),
        ...(dto.conditions !== undefined ? { conditions: this.toStored(dto.conditions) } : {}),
        ...(dto.graph !== undefined ? { graph: this.toStored(dto.graph) } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
    return this.toResponse(updated);
  }

  async remove(id: number) {
    const item = await this.prisma.contractType.findUnique({
      where: { id },
      include: { _count: { select: { contracts: true } } },
    });
    if (!item) throw new NotFoundException(`合同类型 ${id} 不存在`);
    if (item._count.contracts > 0) {
      const sample = await this.prisma.contract.findMany({
        where: { contractTypeId: id },
        include: { competition: true },
        orderBy: { id: "asc" },
        take: 5,
      });
      const detail = sample
        .map((c) => `「${c.name}」（比赛：${c.competition?.name ?? "未关联"}）`)
        .join("、");
      const more =
        item._count.contracts > sample.length ? ` 等共 ${item._count.contracts} 份` : "";
      throw new BadRequestException(
        `该合同类型下仍有 ${item._count.contracts} 份合同实例，无法删除。涉及：${detail}${more}。请先删除这些合同实例后再试。`
      );
    }
    return this.prisma.contractType.delete({ where: { id } });
  }

  private validateJson(value: any, label: string) {
    const str = typeof value === "string" ? value : JSON.stringify(value ?? null);
    try {
      JSON.parse(str);
    } catch (e) {
      throw new BadRequestException(`${label} 不是合法 JSON: ${(e as Error).message}`);
    }
  }

  // 参与方数一律由可视化编辑器中的 partyRoles 推导（= 参与方节点数），
  // 不再依赖单独传入的 partyCount，避免与编辑器实际参与方数不一致。
  private partyCountFrom(partyRoles: any): number {
    const arr = typeof partyRoles === "string" ? this.parseField(partyRoles) : partyRoles;
    return Array.isArray(arr) ? arr.length : 0;
  }

  // 这些列在库里是 String（JSON 文本），写入时由 toStored 序列化为字符串。
  // 读出来必须解析回对象/数组再返回给客户端，否则前端 flatToGraph 拿到字符串会崩溃。
  // 引擎执行时直接从 Prisma 读取原始字符串并自行 safeParse，不受此处影响。
  private static JSON_FIELDS = ["partyRoles", "inputSchema", "effects", "conditions", "graph"];

  private parseField(v: any): any {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }

  private toResponse<T extends Record<string, any>>(item: T): T {
    if (!item) return item;
    const out: Record<string, any> = { ...item };
    for (const f of ContractTypeService.JSON_FIELDS) {
      if (f in out) out[f] = this.parseField(out[f]);
    }
    return out as T;
  }
}
