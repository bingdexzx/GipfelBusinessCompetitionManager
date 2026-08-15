import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "../../common/config/config.service";
import { PrismaService } from "../../prisma/prisma.service";
import { parsePermissions, parseCompanyScopes } from "../../permissions/catalog";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.jwtSecret,
      issuer: configService.jwtIssuer,
      audience: configService.jwtAudience,
    });
  }

  async validate(payload: { sub: number; username: string; role: string; tv?: number }) {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return null;
    // companyScopes 列已存在于数据库，但本地 Prisma Client 因生成锁未能重新生成，
    // 故通过 any 读取实际返回值（运行时 findUnique 不指定 select 会返回全部列）。
    const u = user as any;
    // 单设备登录：token 内会话版本号（tv）与库内当前 tokenVersion 不一致时，
    // 说明该账号已在其他设备登录（本 token 被顶掉），立即判失效并给出明确提示。
    // tv 为 undefined 表示部署前签发的旧 token（当时尚无版本号），为兼容存量会话暂不踢出。
    if (typeof payload.tv === "number" && payload.tv !== u.tokenVersion) {
      throw new UnauthorizedException("您的账号已在其他设备登录，请重新登录");
    }
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      competitionId: user.competitionId ?? null,
      mustChangePassword: !!u.mustChangePassword,
      permissions: parsePermissions(user.permissions),
      companyScopes: parseCompanyScopes(u.companyScopes),
      viewCompanyScopes: parseCompanyScopes(u.viewCompanyScopes),
      contractViewCompanyScopes: parseCompanyScopes(u.contractViewCompanyScopes),
      stockCompanyScopes: parseCompanyScopes(u.stockCompanyScopes),
    };
  }
}
