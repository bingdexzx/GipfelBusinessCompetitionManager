import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { ContractEngineService } from "./contract-engine.service";
import { RealtimeService } from "../../realtime/realtime.service";
import { CompanyFieldsService } from "../company-fields/company-fields.service";
import { CreateContractDto, ExecuteContractDto, validateParties } from "./dto/contract.dto";
import { hasPermission } from "../../permissions/catalog";
import { assertSameCompetition } from "../../common/scope";
import { applyUpdatedAfter, buildIncrementalResult } from "../../common/sync";
import { parseJsonArray } from "../../common/json.util";
import { DeleteImpact, DeleteImpactItem } from "../../common/types/delete-impact";

@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ContractEngineService,
    private readonly realtime: RealtimeService,
    private readonly companyFields: CompanyFieldsService,
  ) {}

  private toStored(value: any): string {
    if (value == null) return "{}";
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  async findAll(
    competitionId?: number,
    status?: string,
    page = 1,
    pageSize = 50,
    user?: any,
    updatedAfter?: string,
    requireExistingIds = false,
    previousIds?: number[],
  ) {
    const where: any = {};
    if (competitionId) where.competitionId = competitionId;
    if (status) where.status = status;
    const { where: incWhere, incremental } = applyUpdatedAfter(where, updatedAfter);

    if (incremental) {
      // 变更集：updatedAt 晚于基线的合同，仍需应用公司范围过滤
      let changed = await this.prisma.contract.findMany({
        where: incWhere,
        include: { contractType: true },
        orderBy: { createdAt: "desc" },
      });
      changed = this.filterByScope(changed, user);
      // 全量 id（应用范围过滤），供前端 diff 出被删除的本地副本；
      // 仅当显式要求（周期/重连对账）时才计算，否则跳过以降低服务端压力
      let allCurrentIds: number[] = [];
      if (requireExistingIds) {
        const baseRows = await this.prisma.contract.findMany({
          where,
          include: { contractType: true },
        });
        const scopedBase = this.filterByScope(baseRows, user);
        allCurrentIds = scopedBase.map((c) => c.id);
      }
      return buildIncrementalResult(changed, allCurrentIds, previousIds);
    }

    // 判断是否需要公司范围过滤（需解析 JSON parties 字段，无法下推到数据库 where）
    const needsScopeFilter = this.needsScopeFilter(user);
    if (!needsScopeFilter) {
      // 无范围限制：直接使用数据库级分页（skip/take），避免全量查询
      const [rows, total] = await Promise.all([
        this.prisma.contract.findMany({
          where,
          include: { contractType: true },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.contract.count({ where }),
      ]);
      const enriched = await this.enrichPartyCompanies(rows);
      return { items: enriched, total, page, pageSize };
    }

    // 有范围限制：需解析 JSON parties 做内存过滤，无法下推到数据库
    let items = await this.prisma.contract.findMany({
      where,
      include: { contractType: true },
      orderBy: { createdAt: "desc" },
    });
    items = this.filterByScope(items, user);

    const total = items.length;
    const paged = items.slice((page - 1) * pageSize, page * pageSize);
    const enriched = await this.enrichPartyCompanies(paged);
    return { items: enriched, total, page, pageSize };
  }

  /**
   * 给合同参与方补全公司名称（仅用于列表/详情展示，不写入存储）。
   * 一次性收集所有 companyId 后批量查表，避免 N+1；主办方(isHost)无公司，公司名置 null。
   *
   * 注意：`parties` 在数据库中以 JSON 字符串存储（Prisma String 类型，非 Json 类型），
   * 因此这里必须先按 JSON 解析；若直接 `Array.isArray` 会判为 false 而误走 `[]` 分支，
   * 把参与方整体覆盖成空数组（即「参与方都不显示」的根因）。
   */
  private parseParties(raw: any): any[] {
    return parseJsonArray(raw);
  }

  private async enrichPartyCompanies(items: any[]): Promise<any[]> {
    const companyIds = new Set<number>();
    for (const it of items) {
      const parties = this.parseParties(it?.parties);
      for (const p of parties) {
        if (p && p.companyId != null) companyIds.add(Number(p.companyId));
      }
    }
    let nameById = new Map<number, string>();
    if (companyIds.size) {
      const comps = await this.prisma.company.findMany({
        where: { id: { in: [...companyIds] } },
        select: { id: true, name: true },
      });
      nameById = new Map((comps as any[]).map((c) => [c.id, c.name]));
    }
    for (const it of items) {
      const parties = this.parseParties(it?.parties);
      it.parties = parties.map((p: any) => ({
        ...p,
        companyName:
          p && p.isHost
            ? null
            : p && p.companyId != null
              ? nameById.get(Number(p.companyId)) ?? null
              : null,
      }));
    }
    return items;
  }

  async findOne(id: number, user?: any) {
    const item = await this.prisma.contract.findUnique({
      where: { id },
      include: { contractType: true },
    });
    if (!item) throw new NotFoundException(`合同 ${id} 不存在`);
    // 合同查看范围校验：仅持纯 contract:view 的账号受 contractViewCompanyScopes 约束
    this.assertViewScope(user, item);
    await this.enrichPartyCompanies([item]);
    return item;
  }

  /**
   * 创建合同：只建草稿（DRAFT），不立即执行。
   * - 发起方仅填自己管理的那一方编号；其余参与方编号可留空（"未编号"），由各公司管理员后续在详情页补全。
   * - 编号不参与引擎计算，仅作记录；所有非主办方编号齐全后再由有权限者执行落账。
   */
  async create(dto: CreateContractDto, user?: any) {
    const ct = await this.prisma.contractType.findUnique({
      where: { id: dto.contractTypeId },
    });
    if (!ct) throw new NotFoundException(`合同类型 ${dto.contractTypeId} 不存在`);

    const parties = this.parseJson(dto.parties, "parties");
    // 校验参与方数量与类型模板一致
    const selectableParties = parties.filter((p: any) => !p.isHost);
    if (selectableParties.length < 1) {
      throw new BadRequestException("至少需要一个实际公司参与方");
    }
    // 编号现在允许为空（分步补全）；仅规范化非空字符串，空白/空值统一置 null
    for (const p of selectableParties) {
      p.contractNumber =
        p.contractNumber == null ? null : String(p.contractNumber).trim() || null;
    }

    return this.prisma.contract.create({
      data: {
        competitionId: dto.competitionId,
        contractTypeId: dto.contractTypeId,
        // 合同名称不再由用户填写，自动取合同类型名称（列表/详情展示用）
        name: ct.name,
        parties: this.toStored(parties),
        inputs: this.toStored(dto.inputs),
        status: "DRAFT",
      },
      include: { contractType: true },
    });
  }

  async execute(id: number, dto?: ExecuteContractDto, user?: any) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: { contractType: true },
    });
    if (!contract) throw new NotFoundException(`合同 ${id} 不存在`);
    if (contract.status === "EXECUTED") {
      throw new BadRequestException("合同已执行，不可重复执行");
    }
    // DRAFT/PENDING_EXEC 合同尚未落账，可直接执行；但 TERMINATED 合同已终止并（被 setStatus）
    // 解除字段效果，若允许再次执行会重新落账导致产业字段值翻倍、账实不一致，故禁止。
    if (contract.status === "TERMINATED") {
      throw new BadRequestException("合同已终止，不可再次执行");
    }

    // 执行方范围校验：比赛级/超管兜底可执任意合同；仅 contract:audit 限最后一方公司
    this.assertExecuteScope(user, contract);

    // 编号分步补全：执行前校验所有非主办方参与方均已填写编号
    const parties = this.parseJson(contract.parties, "parties");
    const selectableParties = parties.filter((p: any) => !p.isHost);
    for (const p of selectableParties) {
      if (p.contractNumber == null || String(p.contractNumber).trim() === "") {
        throw new BadRequestException(`存在未编号的参与方，无法执行：角色 ${p.role}`);
      }
    }

    // 执行时可覆盖输入参数；编号已在 parties 中（分步补全），无需再次合并
    const inputs = dto?.inputs !== undefined ? this.toStored(dto.inputs) : contract.inputs;
    const contractForEngine = { ...contract, inputs };

    let log: any[];
    let result: any;
    let updated: any;

    // 引擎字段写入 + 合同状态更新必须在同一事务内，避免引擎落账后状态更新失败导致可重复执行
    await this.prisma.$transaction(async (tx) => {
      const engineResult = await this.engine.execute(contractForEngine, tx);
      log = engineResult.log;
      result = engineResult.result;

      updated = await tx.contract.update({
        where: { id },
        data: {
          inputs,
          status: "EXECUTED",
          signedAt: contract.signedAt ?? new Date(),
          executedAt: new Date(),
          executionLog: JSON.stringify(log),
          executionResult: JSON.stringify(result),
        },
        include: { contractType: true },
      });
    });

    // 合同执行改写基础产业字段后，须级联重算计算字段（此前直写绕过 CompanyFieldsService
    // 导致计算值陈旧），并广播 company-field:changed 让三端（公司详情 / 仪表盘 / 区域总览）刷新。
    const affectedCompanies = new Set<number>();
    for (const key of Object.keys(result!.fields || {})) {
      const cid = parseInt(key.split(":")[0], 10);
      if (Number.isFinite(cid)) affectedCompanies.add(cid);
    }
    for (const companyId of affectedCompanies) {
      await this.companyFields.recomputeCalculatedFieldsForCompany(companyId);
    }

    // 强时效：合同执行后实时广播，相关前端即刻刷新
    this.realtime.broadcastToCompetition(updated!.competitionId, "contract:changed", {
      id: updated!.id,
      status: updated!.status,
      competitionId: updated!.competitionId,
    });
    // 同步广播计算字段刷新（与 contract:changed 一并发出，保证携带重算后的最新值）。
    for (const companyId of affectedCompanies) {
      this.realtime.broadcastToCompetition(updated!.competitionId, "company-field:changed", {
        companyId,
        competitionId: updated!.competitionId,
      });
    }
    return updated!;
  }

  /**
   * 分步补全合同编号：仅更新传入 role 对应的参与方编号。
   * - 仅 DRAFT 状态可改；已执行不可改。
   * - 权限隔离：当前用户只能更新其审核范围内（companyScopes）公司对应的参与方；
   *   contract:execute（比赛级）/ contract:manage（超管）不受公司限制。
   */
  async updatePartyNumbers(
    id: number,
    partyNumbers: Record<string, string>,
    user?: any,
  ) {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) throw new NotFoundException(`合同 ${id} 不存在`);
    if (contract.status === "EXECUTED") {
      throw new BadRequestException("合同已执行，编号不可再修改");
    }

    const parties = this.parseJson(contract.parties, "parties");
    const roleSet = new Set(parties.map((p: any) => p.role));
    for (const role of Object.keys(partyNumbers)) {
      if (!roleSet.has(role)) {
        throw new BadRequestException(`合同不存在角色 ${role}`);
      }
    }

    for (const p of parties) {
      if (p.isHost) continue; // 主办方无编号
      if (!(p.role in partyNumbers)) continue;
      // 权限隔离：只能改自己审核范围内公司的编号
      this.assertEditPartyScope(user, p.companyId, p.role);
      const v = partyNumbers[p.role];
      p.contractNumber = v == null ? null : String(v).trim() || null;
    }

    // 自动升降 PENDING_EXEC：仅当合同仍处于会签态（DRAFT/PENDING_EXEC）时，
    // 依据「所有非主办方编号是否齐备」在 DRAFT 与 PENDING_EXEC 间自动切换；
    // 已执行/已终止合同不在此处理（编号本就不可改）。
    let newStatus = contract.status;
    if (contract.status === "DRAFT" || contract.status === "PENDING_EXEC") {
      const selectable = parties.filter((p: any) => !p.isHost);
      const allFilled =
        selectable.length > 0 &&
        selectable.every(
          (p: any) => p.contractNumber != null && String(p.contractNumber).trim() !== "",
        );
      newStatus = allFilled ? "PENDING_EXEC" : "DRAFT";
    }

    const updated = await this.prisma.contract.update({
      where: { id },
      data: { parties: this.toStored(parties), status: newStatus },
      include: { contractType: true },
    });
    // 强时效：编号变更实时广播
    this.realtime.broadcastToCompetition(updated.competitionId, "contract:changed", {
      id: updated.id,
      status: updated.status,
      competitionId: updated.competitionId,
    });
    return updated;
  }

  async precheck(id: number, user?: any) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: { contractType: true },
    });
    if (!contract) throw new NotFoundException(`合同 ${id} 不存在`);
    this.assertExecuteScope(user, contract);
    return this.engine.precheck(contract);
  }

  /**
   * 标记合同状态：会签模型下状态转换由 execute / remove / updatePartyNumbers 驱动，
   * 本接口仅保留「标记终止（TERMINATED）」这一无害动作，用于把已执行/草稿合同标记为终止。
   * 禁止直接置 EXECUTED（绕过执行落账）或回退 DRAFT/PENDING_EXEC（绕过复原/编号流程），
   * 以修复此前「状态与字段效果不一致」的账实隐患。
   */
  async setStatus(id: number, status: string) {
    const item = await this.prisma.contract.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`合同 ${id} 不存在`);
    if (status === "EXECUTED") {
      throw new BadRequestException("禁止直接置为已执行，请走执行流程");
    }
    if (status === "DRAFT" || status === "PENDING_EXEC") {
      throw new BadRequestException("禁止直接回退合同状态，请走编号补全/执行流程");
    }
    if (status !== "TERMINATED") {
      throw new BadRequestException("不允许的状态值");
    }
    const updated = await this.prisma.contract.update({
      where: { id },
      data: { status },
      include: { contractType: true },
    });
    // 强时效：合同状态变更实时广播
    this.realtime.broadcastToCompetition(updated.competitionId, "contract:changed", {
      id: updated.id,
      status: updated.status,
      competitionId: updated.competitionId,
    });
    return updated;
  }

  async remove(id: number, competitionId?: number) {
    const item = await this.prisma.contract.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`合同 ${id} 不存在`);
    assertSameCompetition(item.competitionId, competitionId);
    // 复原判定基于「是否曾落账」（contractFieldEffect 记录存在），而非当前 status：
    // 这样即使合同被置为 TERMINATED 后再删，也能正确复原字段，避免账实不一致。
    const effectCount = await (this.prisma as any).contractFieldEffect.count({
      where: { contractId: id },
    });
    if (effectCount === 0) {
      // 从未落账（DRAFT / PENDING_EXEC 或执行失败残留），无字段效果，直接删除。
      return this.prisma.contract.delete({ where: { id } });
    }
    // 复原该合同对产业字段的修改（不影响后续合同）；删合同后级联清空其字段改写记录。
    const parties = this.parseJson(item.parties, "parties");
    const affected = (parties || []).filter(
      (p: any) => !p.isHost && typeof p.companyId === "number",
    );

    // 字段复原 + 合同删除必须在同一事务内，避免复原成功但删除失败导致合同残留
    const deleted = await this.prisma.$transaction(async (tx) => {
      await this.engine.revertContract(item, tx);
      return tx.contract.delete({ where: { id } });
    });

    // 复原基础字段后须级联重算计算字段（避免计算值停留在被删合同改写后的陈旧态），
    // 并广播 company-field:changed 让前端刷新。
    for (const p of affected) {
      await this.companyFields.recomputeCalculatedFieldsForCompany(p.companyId);
      this.realtime.broadcastToCompetition(item.competitionId, "company-field:changed", {
        companyId: p.companyId,
        competitionId: item.competitionId,
      });
    }
    return deleted;
  }

  /**
   * 计算删除该合同时的级联影响（合同无子表，仅占位保证删除体验一致）。
   */
  async getContractImpact(id: number): Promise<DeleteImpact> {
    const item = await this.prisma.contract.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`合同 ${id} 不存在`);
    const children: DeleteImpactItem[] = [];
    // ContractFieldEffect.contractId 为 onDelete: Cascade：删除合同会级联删除其字段效果记录。
    const effectCount = await this.prisma.contractFieldEffect.count({ where: { contractId: id } });
    if (effectCount > 0) {
      children.push({ label: "合同字段效果", count: effectCount });
    }
    return { name: item.name, children };
  }

  /** 判断是否需要公司范围过滤（需解析 JSON parties 字段，无法下推到数据库 where） */
  private needsScopeFilter(user?: any): boolean {
    if (!user) return false;
    const canAudit = hasPermission(user.role, user.permissions, "contract:audit");
    const canExecute = hasPermission(user.role, user.permissions, "contract:execute");
    const canManage = hasPermission(user.role, user.permissions, "contract:manage");
    const canView = hasPermission(user.role, user.permissions, "contract:view");
    if (canAudit && !canExecute) return true;
    if (canView && !canAudit && !canExecute && !canManage) {
      const scopes: number[] = user.contractViewCompanyScopes || [];
      return scopes.length > 0;
    }
    return false;
  }

  /** 公司范围过滤（复用于全量/增量分支） */
  private filterByScope(items: any[], user?: any): any[] {
    if (!user) return items;
    const canView = hasPermission(user.role, user.permissions, "contract:view");
    const canAudit = hasPermission(user.role, user.permissions, "contract:audit");
    const canExecute = hasPermission(user.role, user.permissions, "contract:execute");
    const canManage = hasPermission(user.role, user.permissions, "contract:manage");

    // 审核范围：仅 contract:audit（无 contract:execute）的账号按 companyScopes 限制可审核合同；
    // 空范围 = 看不到任何合同（必须显式指定可审核公司）。
    if (canAudit && !canExecute) {
      const scopes: number[] = user.companyScopes || [];
      return items.filter((c) => this.contractInScopes(c, scopes));
    }

    // 合同查看范围：仅持纯 contract:view（无 audit/execute/manage）的账号按 contractViewCompanyScopes
    // 限制可见合同；空范围 = 不限制（可见全部合同）。按参与方公司匹配。
    if (canView && !canAudit && !canExecute && !canManage) {
      const scopes: number[] = user.contractViewCompanyScopes || [];
      if (scopes.length === 0) return items;
      return items.filter((c) => this.contractInScopes(c, scopes));
    }

    return items;
  }

  private parseJson(raw: any, label: string): any {
    if (raw == null) return [];
    const str = typeof raw === "string" ? raw : JSON.stringify(raw);
    try {
      return JSON.parse(str);
    } catch (e) {
      throw new BadRequestException(`${label} 不是合法 JSON: ${(e as Error).message}`);
    }
  }

  /** 取合同实际参与方（非主办方）的公司 id 列表 */
  private getPartyCompanyIds(contract: { parties: string }): number[] {
    const parties = parseJsonArray(contract.parties);
    return parties
      .filter((p: any) => !p.isHost && typeof p.companyId === "number")
      .map((p: any) => p.companyId as number);
  }

  /** 合同是否至少有一个参与方公司落在范围内；空范围 = 不在任何范围内（即不匹配任何合同）。
   *  注意：查看范围分支（contractViewCompanyScopes）在调用前已对空范围做「不限制」特判；
   *  此处空返回 false 仅影响审核范围（companyScopes 空 = 看不到任何合同）。 */
  private contractInScopes(contract: { parties: string }, scopes: number[]): boolean {
    if (!scopes || scopes.length === 0) return false;
    return this.getPartyCompanyIds(contract).some((id) => scopes.includes(id));
  }

  /**
   * 执行方范围校验（会签模型核心）：
   * - `contract:execute`/`contract:manage`/超管 直接放行（兜底：可执任意合同的最后一步，便于运维/演示）；
   * - 仅 `contract:audit` 公司级管理员：必须是「最后一个参与方公司」在其 companyScopes 内，
   *   否则 403「仅最后一方参与公司管理员可执行」（中间方即使编号齐全也只能填自己编号）。
   */
  private assertExecuteScope(user: any, contract: { parties: string }): void {
    if (!user) return;
    const canExecute = hasPermission(user.role, user.permissions, "contract:execute");
    if (canExecute) return; // 兜底：比赛级/超管可执任意合同
    const canAudit = hasPermission(user.role, user.permissions, "contract:audit");
    if (!canAudit) {
      throw new ForbiddenException("无权执行合同");
    }
    const lastCompanyId = this.getLastSignatoryCompanyId(contract);
    const scopes: number[] = user.companyScopes || [];
    if (lastCompanyId == null || !scopes.includes(lastCompanyId)) {
      throw new ForbiddenException("仅合同最后一方参与公司的管理员可执行");
    }
  }

  /** 取最后一个「非主办方」参与方的公司 id（即会签执行方）；无则返回 null */
  private getLastSignatoryCompanyId(contract: { parties: string }): number | null {
    const parties = this.parseJson(contract.parties, "parties");
    const real = (parties || []).filter(
      (p: any) => !p.isHost && typeof p.companyId === "number",
    );
    return real.length ? real[real.length - 1].companyId : null;
  }

  /**
   * 合同查看范围校验：仅持纯 contract:view（无 audit/execute/manage）的账号，
   * 只能查看 contractViewCompanyScopes 范围内公司担任参与方的合同；其余（审核/执行/管理）不受限。
   * 空范围 = 不限制（可见全部合同）。
   */
  private assertViewScope(user: any, contract: { parties: string }): void {
    if (!user) return;
    const canExecute = hasPermission(user.role, user.permissions, "contract:execute");
    const canAudit = hasPermission(user.role, user.permissions, "contract:audit");
    const canManage = hasPermission(user.role, user.permissions, "contract:manage");
    // 更高权限（审核/执行/管理）不受查看范围约束
    if (canExecute || canAudit || canManage) return;
    const scopes: number[] = user.contractViewCompanyScopes || [];
    if (scopes.length === 0) return; // 未配置范围 = 不限制
    if (!this.contractInScopes(contract, scopes)) {
      throw new ForbiddenException("无权查看其他公司的合同");
    }
  }

  /**
   * 单公司编辑范围校验（用于分步补全编号）。
   * - 拥有 contract:execute（比赛级）或 contract:manage（超管/合同管理员）不受公司限制；
   * - 仅 contract:audit 的账号，只能修改 companyScopes 范围内公司的参与方编号。
   */
  private assertEditPartyScope(user: any, companyId: number, role: string): void {
    if (!user) return;
    const canExecute = hasPermission(user.role, user.permissions, "contract:execute");
    const canManage = hasPermission(user.role, user.permissions, "contract:manage");
    if (canExecute || canManage) return;
    const canAudit = hasPermission(user.role, user.permissions, "contract:audit");
    if (!canAudit) {
      throw new ForbiddenException("无权修改合同编号");
    }
    const scopes: number[] = user.companyScopes || [];
    if (!scopes.includes(companyId)) {
      throw new ForbiddenException(`无权修改角色 ${role} 所属公司的合同编号`);
    }
  }
}
