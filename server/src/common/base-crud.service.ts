import { PrismaClient } from "@prisma/client";
import { applyUpdatedAfter, buildIncrementalResult } from "./sync";

/**
 * Prisma 模型委托接口：抽象 findMany / count，供 findAllGeneric 泛型使用。
 */
export interface CrudModelDelegate<T> {
  findMany(args: any): Promise<T[]>;
  count(args: any): Promise<number>;
}

/**
 * findAll 通用选项。
 */
export interface FindAllOptions {
  page?: number;
  pageSize?: number;
  competitionId?: number;
  updatedAfter?: string;
  requireExistingIds?: boolean;
  previousIds?: number[];
  include?: Record<string, unknown>;
  orderBy?: Record<string, "asc" | "desc">;
}

/**
 * CRUD 服务基类：提取 findAll 的通用增量/分页逻辑，消除 14+ 服务中的重复代码。
 *
 * 子类只需在构造函数中注入 PrismaService 并调用 super(prisma)，
 * 然后在 findAll 方法中调用 this.findAllGeneric(this.prisma.xxx, options) 即可。
 */
export abstract class BaseCrudService {
  constructor(protected readonly prisma: PrismaClient) {}

  /**
   * 通用 findAll：支持增量同步 + 分页查询。
   *
   * @param model   Prisma 模型委托（如 this.prisma.fuel）
   * @param options 查询选项（分页、比赛过滤、增量基线等）
   * @param baseWhere 额外的业务过滤条件（可选）
   */
  protected async findAllGeneric<T extends { id: number }>(
    model: CrudModelDelegate<T>,
    options: FindAllOptions,
    baseWhere: Record<string, unknown> = {},
  ) {
    const {
      page = 1,
      pageSize = 50,
      competitionId,
      updatedAfter,
      requireExistingIds = false,
      previousIds,
      include,
      orderBy = { updatedAt: "desc" },
    } = options;

    const where = competitionId != null
      ? { ...baseWhere, competitionId }
      : baseWhere;
    const { where: finalWhere, incremental } = applyUpdatedAfter(where, updatedAfter);

    if (incremental) {
      const items = await model.findMany({ where: finalWhere, orderBy });
      const allCurrentIds = requireExistingIds
        ? (await model.findMany({ where, select: { id: true } })).map((r: any) => r.id)
        : [];
      return buildIncrementalResult(items, allCurrentIds, previousIds);
    }

    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      model.findMany({ where, skip, take: pageSize, include, orderBy }),
      model.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}
