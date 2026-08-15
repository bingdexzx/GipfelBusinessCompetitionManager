import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request, Response } from "express";
import { getOperator, getRequestId, getIp, formatOperator } from "../logging/operator.context";
import { logger } from "../logging/logger.config";
import { sanitize } from "../logging/sanitize";

/** 写方法（会产生数据变更）才记录请求体，避免只读请求产生噪声。 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 慢请求阈值（毫秒），超过此值的请求记录为 warn 级别以便快速识别。 */
const SLOW_REQUEST_THRESHOLD_MS = 500;

/** 无请求体的方法，不计入请求包大小。 */
const NO_BODY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** 估算一个值的 JSON 序列化字节数（UTF-8）。 */
function jsonBytes(v: unknown): number {
  if (v === undefined || v === null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(v), "utf8");
  } catch {
    return 0;
  }
}

/**
 * 计算本次请求的数据包大小（字节）：
 * - JSON 请求体按序列化后字节计；
 * - 文件上传（multipart）走 multer，字节不在 body 里，单独累加文件大小。
 */
function computeRequestBodySize(request: Request): number {
  let n = 0;
  if (!NO_BODY_METHODS.has(request.method)) {
    const body = (request as any).body;
    if (body && typeof body === "object") n += jsonBytes(body);
  }
  const file = (request as any).file;
  if (file && typeof file.size === "number") n += file.size;
  const files = (request as any).files;
  if (Array.isArray(files)) {
    for (const f of files) if (f && typeof f.size === "number") n += f.size;
  }
  return n;
}

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
    const requestBodySize = computeRequestBodySize(request);

    return next.handle().pipe(
      tap({
        next: (data) => {
          const response = ctx.getResponse<Response>();
          const statusCode = response.statusCode;
          const elapsed = Date.now() - now;
          // 回应包大小 = ResponseInterceptor 最终线格式 { code, message, data } 的字节数，
          // 与真实线长仅差常量包装开销，足以反映「下载了多少数据」。
          const responseBodySize = jsonBytes({ code: 0, message: "成功", data });
          const logPayload = {
            method,
            url,
            statusCode,
            elapsedMs: elapsed,
            operatorLabel: opLabel,
            rid,
            ip,
            requestBodySize,
            responseBodySize,
            ...(body ? { body } : {}),
          };
          // 慢请求检测：超过阈值的请求记录为 warn 级别，便于快速识别性能瓶颈
          if (elapsed >= SLOW_REQUEST_THRESHOLD_MS) {
            logger.warn("HTTP 慢请求", logPayload);
          } else {
            logger.info("HTTP 访问", logPayload);
          }
        },
        error: (error) => {
          const elapsed = Date.now() - now;
          const statusCode = error.status || error.statusCode || 500;
          const responseBodySize = jsonBytes({
            code: statusCode,
            message: error.message || "Error",
            data: null,
          });
          logger.error("HTTP 访问异常", {
            method,
            url,
            statusCode,
            elapsedMs: elapsed,
            operatorLabel: opLabel,
            rid,
            ip,
            requestBodySize,
            responseBodySize,
            error: error.message,
            ...(body ? { body } : {}),
          });
        },
      }),
    );
  }
}
