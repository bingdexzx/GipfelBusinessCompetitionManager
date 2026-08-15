import { Injectable, ConflictException, NotFoundException, BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto, UpdateUserDto, UpdatePasswordDto } from "./dto/user.dto";
import {
  parsePermissions,
  serializePermissions,
  isValidPermissions,
  parseCompanyScopes,
  serializeCompanyScopes,
} from "../permissions/catalog";
import { applyUpdatedAfter, buildIncrementalResult } from "../common/sync";

export interface UserView {
  id: number;
  username: string;
  role: string;
  displayName: string | null;
  competitionId: number | null;
  permissions: string[];
  companyScopes: number[];
  viewCompanyScopes: number[];
  contractViewCompanyScopes: number[];
  stockCompanyScopes: number[];
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private toView(user: {
    id: number;
    username: string;
    role: string;
    displayName: string | null;
    competitionId: number | null;
    permissions: string | null;
    companyScopes?: any;
    viewCompanyScopes?: any;
    contractViewCompanyScopes?: any;
    stockCompanyScopes?: any;
    createdAt?: Date;
    updatedAt?: Date;
  }): UserView {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      competitionId: user.competitionId,
      permissions: parsePermissions(user.permissions),
      companyScopes: parseCompanyScopes((user as any).companyScopes),
      viewCompanyScopes: parseCompanyScopes((user as any).viewCompanyScopes),
      contractViewCompanyScopes: parseCompanyScopes((user as any).contractViewCompanyScopes),
      stockCompanyScopes: parseCompanyScopes((user as any).stockCompanyScopes),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async findAll(page = 1, pageSize = 20, competitionId?: number | null, updatedAfter?: string, requireExistingIds = false) {
    const baseWhere = competitionId === undefined ? {} : { competitionId };
    const { where, incremental } = applyUpdatedAfter(baseWhere, updatedAfter);
    if (incremental) {
      const rows = await this.prisma.user.findMany({ where, orderBy: { createdAt: "desc" } });
      const existingIds = requireExistingIds
        ? (await this.prisma.user.findMany({ where: baseWhere, select: { id: true } })).map((e) => e.id)
        : [];
      return buildIncrementalResult(rows.map((u) => this.toView(u)), existingIds);
    }
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        where,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map((u) => this.toView(u)), total, page, pageSize };
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("用户不存在");
    return this.toView(user);
  }

  async create(actor: any, dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existing) throw new ConflictException("用户名已存在");

    // 角色提升限制：仅超级管理员可创建超级管理员账号，防止竞赛管理员自我提权。
    if (dto.role === "SUPER_ADMIN" && actor?.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("仅超级管理员可创建超级管理员账号");
    }

    if (dto.competitionId !== undefined && dto.competitionId !== null) {
      const competition = await this.prisma.competition.findUnique({
        where: { id: dto.competitionId },
      });
      if (!competition) throw new NotFoundException("所属比赛不存在");
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      // 注：companyScopes 已存在于数据库，但本地 Prisma Client 因生成锁未重新生成，
      // 故此处整体按 any 写入（运行时列已存在，可正常落库）。
      data: {
        username: dto.username,
        passwordHash,
        role: dto.role || "PLAYER",
        displayName: dto.displayName,
        competitionId: dto.competitionId ?? null,
        mustChangePassword: true,
        permissions: this.sanitize(dto.permissions),
        companyScopes: this.sanitizeScopes(dto.companyScopes),
        viewCompanyScopes: this.sanitizeScopes(dto.viewCompanyScopes),
        contractViewCompanyScopes: this.sanitizeScopes(dto.contractViewCompanyScopes),
        stockCompanyScopes: this.sanitizeScopes(dto.stockCompanyScopes),
      } as any,
    });
    return this.toView(user);
  }

  async update(actor: any, id: number, dto: UpdateUserDto) {
    await this.findOne(id);
    // 角色修改限制：仅超级管理员可修改任何账号的角色，且只有超级管理员可授予
    // 超级管理员角色，杜绝竞赛管理员把自身或其它账号提权为超管。
    if (dto.role !== undefined && actor?.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("仅超级管理员可修改账号角色");
    }
    const data: Record<string, unknown> = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.permissions !== undefined) data.permissions = this.sanitize(dto.permissions);
    if (dto.companyScopes !== undefined)
      data.companyScopes = this.sanitizeScopes(dto.companyScopes);
    if (dto.viewCompanyScopes !== undefined)
      data.viewCompanyScopes = this.sanitizeScopes(dto.viewCompanyScopes);
    if (dto.contractViewCompanyScopes !== undefined)
      data.contractViewCompanyScopes = this.sanitizeScopes(dto.contractViewCompanyScopes);
    if (dto.stockCompanyScopes !== undefined)
      data.stockCompanyScopes = this.sanitizeScopes(dto.stockCompanyScopes);
    const user = await this.prisma.user.update({ where: { id }, data });
    return this.toView(user);
  }

  async updatePassword(actor: any, id: number, dto: UpdatePasswordDto) {
    const target = await this.findOne(id);
    if (actor?.id === id) {
      // 自助改密：修改自身密码必须校验原密码，防止令牌泄露后被静默改密。
      if (!dto.oldPassword) throw new BadRequestException("修改自身密码需提供原密码");
      const current = await this.prisma.user.findUnique({ where: { id } });
      const ok = await bcrypt.compare(dto.oldPassword, current!.passwordHash);
      if (!ok) throw new UnauthorizedException("原密码错误");
    } else {
      // 管理员重置他人密码：禁止重置超级管理员密码（除非操作者本身也是超管），
      // 否则竞赛管理员可利用该接口接管超管账户。
      if (target.role === "SUPER_ADMIN" && actor?.role !== "SUPER_ADMIN") {
        throw new ForbiddenException("无权重重置超级管理员密码");
      }
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    return { message: "密码已更新" };
  }

  async remove(id: number) {
    const user = await this.findOne(id);
    // 防护：不能删除最后一个超级管理员，否则系统将无法登录管理
    if (user.role === "SUPER_ADMIN") {
      const adminCount = await this.prisma.user.count({
        where: { role: "SUPER_ADMIN" },
      });
      if (adminCount <= 1)
        throw new BadRequestException("系统至少需要保留一个超级管理员，无法删除");
    }
    await this.prisma.user.delete({ where: { id } });
    return { message: "用户已删除" };
  }

  /** 只保留合法权限 key；非法/重复/空数组 → null（数据库存 null 表示未单独配置） */
  private sanitize(perms?: string[]): string | null {
    if (!perms || !isValidPermissions(perms)) return null;
    return serializePermissions(perms);
  }

  /** 公司范围：过滤为合法数字数组；空 → null */
  private sanitizeScopes(scopes?: number[]): string | null {
    if (!scopes || scopes.length === 0) return null;
    return serializeCompanyScopes(scopes);
  }
}
