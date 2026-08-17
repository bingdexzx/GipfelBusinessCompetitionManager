import { NestFactory } from "@nestjs/core";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter";
import { ResponseInterceptor } from "../src/common/interceptors/response.interceptor";
import { OperatorMiddleware } from "../src/common/logging/operator.middleware";
import * as bcrypt from "bcryptjs";

const TEST_DB = path.resolve(__dirname, "..", "prisma", "test-e2e.db");

/**
 * M8 主链路 e2e 冒烟（T17）。
 * 用独立临时 SQLite 库（schema 经 prisma db push 推送，含 AuditLog 等新模型），
 * 启动完整 Nest 应用（镜像 main.ts 全局管线），验证「健康检查 / 登录拿令牌 / 带令牌取个人信息」主链路。
 * 同时顺带验证审计落库（登录会触发 tokenVersion 自增写操作，应产生 AuditLog 记录）。
 */
describe("App e2e 主链路冒烟", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = `file:${TEST_DB}`;
    process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-secret-not-for-prod";

    // 准备干净临时库并推送 schema（含 AuditLog）。
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    execSync("npx prisma db push --skip-generate --accept-data-loss", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "ignore",
      env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
    });

    // 直接用 NestFactory 启动完整应用（与 main.ts 等价，但跳过默认超管自动创建），
    // 避免引入 @nestjs/testing 依赖。全局管线在下方手动镜像 main.ts。
    app = await NestFactory.create(AppModule);
    prisma = app.get(PrismaService);

    // 镜像 main.ts 的全局管线（前缀 / 中间件 / 校验 / 异常过滤 / 响应包装）。
    app.setGlobalPrefix("api");
    app.use((req: any, res: any, next: any) => new OperatorMiddleware().use(req, res, next));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());

    await app.init();
    await app.listen(0);
    const addr: any = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // 种子管理员（mustChangePassword=false 以绕过强制改密守卫，专注主链路）。
    await prisma.user.upsert({
      where: { username: "e2e_admin" },
      update: {},
      create: {
        username: "e2e_admin",
        passwordHash: await bcrypt.hash("e2e123", 12),
        role: "SUPER_ADMIN",
        displayName: "e2e",
        competitionId: null,
        mustChangePassword: false,
      },
    });
  }, 120000);

  afterAll(async () => {
    await app.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("GET /api/ping 健康检查返回 ok", async () => {
    const res = await fetch(`${baseUrl}/api/ping`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    // 响应经 ResponseInterceptor 包装为 { code, message, data }，业务数据在 data 内。
    expect(body.code).toBe(0);
    expect(body.data && body.data.status).toBe("ok");
  });

  it("POST /api/auth/login 登录成功并返回 token", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "e2e_admin", password: "e2e123" }),
    });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.data && body.data.token).toBeTruthy();
  });

  it("GET /api/auth/me 携带令牌可获取个人信息", async () => {
    // 先登录拿令牌
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "e2e_admin", password: "e2e123" }),
    });
    const loginBody: any = await login.json();
    const token = loginBody.data.token;

    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.data && body.data.username).toBe("e2e_admin");
  });

  it("审计落库：登录触发的写操作应产生 AuditLog 记录", async () => {
    const count = await prisma.auditLog.count();
    expect(count).toBeGreaterThan(0);
  });
});
