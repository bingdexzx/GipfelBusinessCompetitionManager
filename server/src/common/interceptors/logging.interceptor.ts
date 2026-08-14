import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request, Response } from "express";
import { getOperator, getRequestId, getIp, formatOperator } from "../logging/operator.context";
import { logger } from "../logging/logger.config";
import { sanitize } from "../logging/sanitize";

/** 写方法（会产生数据变更）才记录请求体，避免只读请求产生噪声。 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const { method, url } = request;
    const now = Date.now();

    // 操作员 / 请求编号 / IP 已由 OperatorMiddleware 通过 AsyncLocalStorage 注入，
    // contextFormat 会自动附加到每一条日志；这里只用 winston 直接打结构化 meta。
    const opLabel = formatOperator(getOperator());
    const rid = getRequestId() ?? "-";
    const ip = getIp() ?? "-";

    // 写请求记录脱敏后的请求体，便于追溯「这次提交的内容」。
    const body = WRITE_METHODS.has(method) ? sanitize((request as any).body ?? null) : null;

    return next.handle().pipe(
      tap({
        next: () => {
          const response = ctx.getResponse<Response>();
          const statusCode = response.statusCode;
          const elapsed = Date.now() - now;
          logger.info("HTTP 访问", {
            method,
            url,
            statusCode,
            elapsedMs: elapsed,
            operatorLabel: opLabel,
            rid,
            ip,
            ...(body ? { body } : {}),
          });
        },
        error: (error) => {
          const elapsed = Date.now() - now;
          logger.error("HTTP 访问异常", {
            method,
            url,
            statusCode: error.status || 500,
            elapsedMs: elapsed,
            operatorLabel: opLabel,
            rid,
            ip,
            error: error.message,
            ...(body ? { body } : {}),
          });
        },
      }),
    );
  }
}
