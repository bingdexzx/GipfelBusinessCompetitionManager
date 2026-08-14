import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { verify } from "jsonwebtoken";
import { randomUUID } from "crypto";
import { runWithRequestContext, OperatorInfo } from "./operator.context";

// 安全策略：禁止硬编码默认密钥。未配置 JWT_SECRET 时启动即失败（与 ConfigService 一致）。
const JWT_SECRET = (() => {
  const v = process.env.JWT_SECRET;
  if (!v) {
    throw new Error(
      "JWT_SECRET 环境变量未配置：服务拒绝启动（安全策略禁止硬编码默认密钥）",
    );
  }
  return v;
})();

/**
 * 操作员上下文中间件：在请求最前置阶段解析 JWT，把操作员身份与请求编号写入
 * AsyncLocalStorage，并包裹整个下游处理链（守卫 / 拦截器 / 控制器 / 服务 /
 * Prisma 中间件）。这样【所有】下游日志都会自动带上操作员，实现操作溯源。
 *
 * 必须在 JWT 守卫之前运行——守卫负责鉴权拒绝，本中间件只做日志溯源的上下文注入；
 * token 无效/过期时操作员置空（后续守卫会拒绝未认证请求），不影响日志链路。
 */
@Injectable()
export class OperatorMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const requestId = randomUUID();
    let operator: OperatorInfo | null = null;

    const auth = req.headers.authorization;
    if (auth && auth.startsWith("Bearer ")) {
      const token = auth.slice("Bearer ".length);
      try {
        const payload: any = verify(token, JWT_SECRET);
        if (payload && payload.sub) {
          operator = {
            id: payload.sub,
            username: payload.username,
            role: payload.role,
          };
        }
      } catch {
        // token 无效/过期：操作员置空，由 JWT 守卫负责拒绝。
      }
    }

    // 客户端 IP：直接连接取 socket 地址，反向代理场景需自行配置 trust proxy。
    const ip = req.ip || req.socket?.remoteAddress || null;

    runWithRequestContext({ requestId, operator, ip }, () => next());
  }
}
