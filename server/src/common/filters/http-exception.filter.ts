import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Request, Response } from "express";
import { formatOperator, getOperator, getIp, getRequestId } from "../logging/operator.context";
import { logger } from "../logging/logger.config";
import { sanitize } from "../logging/sanitize";
import { writeAuditLog } from "../logging/audit";

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "服务器内部错误";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      const rawMsg = typeof res === "string" ? res : (res as any).message || exception.message;
      if (status >= 500) {
        message = "服务器内部错误";
      } else if (Array.isArray(rawMsg)) {
        message = "请输入有效数据";
      } else {
        const m = String(rawMsg);
        // 屏蔽可能泄露内部细节（Prisma 约束 / 外键 / 唯一键 / 语法等）的原始消息，
        // 统一为通用文案；友好的业务提示（如「公式求值失败」）保持不变。
        if (
          /prisma|constraint|foreign key|unique|duplicate|relation|null value|invalid input syntax|syntax error|violates/i.test(
            m,
          )
        ) {
          message = "操作失败，请检查输入或联系管理员";
        } else {
          message = m;
        }
      }
    }

    // 错误日志改用 winston 直接输出：operator / requestId / ip 由 contextFormat 自动附加，
    // 这里额外带上 ip、脱敏后的请求体与状态码，便于定位「提交的数据哪里有问题」。
    const opLabel = formatOperator(getOperator());
    const ip = getIp() ?? null;
    const body = sanitize((request as any).body ?? null);

    if (exception instanceof Error) {
      logger.error("未捕获异常", {
        method: request.method,
        url: request.url,
        status,
        operatorLabel: opLabel,
        ip,
        body,
        error: exception.message,
        stack: exception.stack,
      });
    } else {
      logger.error("未捕获异常", {
        method: request.method,
        url: request.url,
        status,
        operatorLabel: opLabel,
        ip,
        body,
      });
    }

    // R10 错误上下文落库：把异常摘要（路径/方法/状态码/错误类）写入 AuditLog，
    // 与写操作审计共用一张表（kind="error"），脱敏后落库，日志文件保留全文。
    const op = getOperator();
    const rid = getRequestId();
    const errorSummary =
      exception instanceof Error
        ? `${exception.constructor.name}: ${exception.message}`
        : "非 Error 类型异常";
    writeAuditLog({
      kind: "error",
      action: request.method,
      operatorId: op?.id ?? null,
      operatorName: op?.username ?? null,
      model: null,
      recordId: null,
      competitionId: null,
      statusCode: status,
      errorSummary,
      ip,
      requestId: rid ?? null,
    });

    response.status(status).json({
      code: status,
      message,
      data: null,
    });
  }
}
