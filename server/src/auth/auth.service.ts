import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";
import { parsePermissions, parseCompanyScopes } from "../permissions/catalog";
import { logger } from "../common/logging/logger.config";
import { stripControlChars } from "../common/logging/sanitize";

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { username: loginDto.username } });
    if (!user) {
      // 登录发生在 JWT 守卫之前，无 request.user；显式记录尝试的用户名用于安全溯源。
      // username 用户可控，剥离控制字符以防日志注入（伪造日志行 / ANSI 注入）。
      logger.warn("登录失败：用户不存在", {
        audit: true,
        event: "LOGIN_FAIL",
        username: stripControlChars(loginDto.username),
      });
      throw new UnauthorizedException("用户名或密码错误");
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isPasswordValid) {
      logger.warn("登录失败：密码错误", {
        audit: true,
        event: "LOGIN_FAIL",
        username: stripControlChars(loginDto.username),
        userId: user.id,
      });
      throw new UnauthorizedException("用户名或密码错误");
    }

    // 单设备登录：每次登录自增会话版本号（tokenVersion），并把新版本写入 JWT 载荷 tv。
    // 新设备登录后库内 tokenVersion 变大，旧设备 token 携带的 tv 与之不一致，被 jwt.strategy 判失效（踢出）。
    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { tokenVersion: { increment: 1 } },
    });

    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      tv: updatedUser.tokenVersion,
    };
    const token = this.jwtService.sign(payload);

    logger.info("登录成功", {
      audit: true,
      event: "LOGIN_SUCCESS",
      username: stripControlChars(user.username),
      userId: user.id,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        displayName: user.displayName,
        mustChangePassword: !!(user as any).mustChangePassword,
        permissions: parsePermissions(user.permissions),
        companyScopes: parseCompanyScopes((user as any).companyScopes),
        viewCompanyScopes: parseCompanyScopes((user as any).viewCompanyScopes),
        contractViewCompanyScopes: parseCompanyScopes((user as any).contractViewCompanyScopes),
        competitionId: user.competitionId ?? null,
      },
    };
  }

  async changePassword(
    userId: number,
    dto: { oldPassword: string; newPassword: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("用户不存在");

    const ok = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException("原密码错误");

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });

    logger.info("密码修改成功", {
      audit: true,
      event: "PASSWORD_CHANGED",
      userId,
      username: user.username,
    });
    return { message: "密码已修改" };
  }

  async getProfile(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException("用户不存在");
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      mustChangePassword: !!(user as any).mustChangePassword,
      permissions: parsePermissions(user.permissions),
      companyScopes: parseCompanyScopes((user as any).companyScopes),
      viewCompanyScopes: parseCompanyScopes((user as any).viewCompanyScopes),
      contractViewCompanyScopes: parseCompanyScopes((user as any).contractViewCompanyScopes),
      competitionId: user.competitionId ?? null,
    };
  }
}
