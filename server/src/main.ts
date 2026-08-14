import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { WinstonLogger } from "./common/logging/logger.config";
import { OperatorMiddleware } from "./common/logging/operator.middleware";
import { PrismaService } from "./prisma/prisma.service";
import { isLoginLocked } from "./common/security/login-throttle";
import * as bcrypt from "bcryptjs";

const logger = WinstonLogger();

/**
 * 安全响应头中间件（零依赖替代 helmet）：设置基础防护头，
 * 缓解 MIME 嗅探、点击劫持、Referrer 泄露等。
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  // API 仅返回 JSON，无需脚本执行：default-src 'none' 可彻底阻断浏览器端脚本执行，
  // 即使诱导用户直接访问 API 也无法注入脚本（XSS 纵深防御）。frame-ancestors 'none' 防点击劫持。
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  // 已废弃的 X-XSS-Protection 不再设置（现代浏览器忽略），避免误导。
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
}

/**
 * 登录限流（仅计失败）：拦截处于锁定状态的登录请求；失败计数由 auth.controller
 * 在登录失败时累计、成功时清除，避免管理员正常调试被误锁。详见 common/security/login-throttle.ts。
 */
function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  if (req.method === "POST" && req.path === "/api/auth/login") {
    const ip = req.ip || "unknown";
    const username = (req.body as any)?.username || "";
    if (isLoginLocked(ip, username)) {
      return res
        .status(429)
        .json({ code: 429, message: "登录尝试过于频繁，请 15 分钟后再试", data: null });
    }
  }
  next();
}

/**
 * 判断来源是否为本地 / 内网。仅这些来源允许在未配置 CORS_ORIGIN 时被反射并接受凭据。
 * 覆盖：无 host（file:// / app:// 等）、localhost、回环地址、以及 RFC1918 私有网段。
 * 公网域名一律返回 false，必须显式加入 CORS_ORIGIN 白名单。
 */
function isLocalOrPrivateOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return true;
    if (u.protocol === "file:" || u.protocol === "app:") return true;
    if (
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger,
  });

  // 自动初始化默认超管
  const prisma = app.get(PrismaService);
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });
  if (!admin) {
    const hash = await bcrypt.hash("admin123", 12);
    await prisma.user.create({
      data: {
        username: "admin",
        passwordHash: hash,
        role: "SUPER_ADMIN",
        displayName: "超级管理员",
        competitionId: null,
        mustChangePassword: true,
      },
    });
    logger.log("[Init] 默认超管已创建: admin / admin123（首次登录后强制改密）", "Bootstrap");
  }

  app.setGlobalPrefix("api");

  // 操作员上下文中间件：必须在守卫/拦截器/控制器之前注册，使其包裹整个下游，
  // 从而把所有日志（含 Prisma 写操作审计）关联到具体操作员。
  const operatorMiddleware = new OperatorMiddleware();
  app.use((req, res, next) => operatorMiddleware.use(req, res, next));

  // 安全响应头
  app.use(securityHeaders);

  // 登录限流
  app.use(loginRateLimiter);

  // CORS：
  // - 未携带 Origin（同源请求 / Electron file:// / 服务间调用）一律放行；
  // - 配置 CORS_ORIGIN（逗号分隔可信域名）时走严格白名单，不在名单内拒绝；
  // - 未配置 CORS_ORIGIN（开发 / 桌面打包场景）：仅对本地 / 内网来源（localhost、回环、RFC1918 私有网段、
  //   file:// / app://）反射并带 credentials；公网来源一律拒绝，必须显式配置 CORS_ORIGIN 白名单，
  //   避免公开部署时被任意站点带凭据读取数据。
  const allowedOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowAll = allowedOrigins.includes("*"); // "*" 视为通配：本地/桌面允许任意来源（反射以保证 credentials 可用）
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // 无 Origin：同源 / 本地调用
      if (allowedOrigins.length && !allowAll) {
        // 显式白名单（非通配）模式：仅放行命中项，其余拒绝（生产 hardening）
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error("CORS 来源不被允许"));
      }
      // 未配置 CORS_ORIGIN，或配置为 "*"：仅对本地/内网来源反射并带 credentials；
      // 公网来源一律拒绝，必须显式配置 CORS_ORIGIN 白名单，避免公开部署时被任意站点带凭据读取数据。
      if (isLocalOrPrivateOrigin(origin)) return cb(null, origin);
      return cb(new Error("CORS 来源不被允许（公网来源须配置 CORS_ORIGIN 白名单）"));
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor(), new LoggingInterceptor());

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`[Server] 商赛办赛辅助系统服务端已启动，端口: ${port}`, "Bootstrap");
}
bootstrap();
