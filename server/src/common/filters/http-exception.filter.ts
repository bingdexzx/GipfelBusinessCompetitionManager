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

    // ===== Prisma ORM 业务错误（全局兜底）：避免被判定为 500 系统崩溃，前端误以为整个系统挂了 =====
    // PrismaClientKnownRequestError 不是 HttpException 子类，需在此单独分支。
    // 使用鸭子类型 + 构造函数名双重判定，避免依赖 @prisma/client 的内部 runtime 导入路径（版本间易变）。
    const prismaErr =
      exception &&
      typeof exception === "object" &&
      "code" in (exception as Record<string, unknown>) &&
      typeof (exception as Record<string, unknown>).code === "string" &&
      /^P\d{4}$/.test((exception as Record<string, string>).code) &&
      (exception.constructor?.name === "PrismaClientKnownRequestError" ||
        exception.constructor?.name === "PrismaClientValidationError")
        ? (exception as Record<string, any>)
        : null;
    if (prismaErr) {
      const code = prismaErr.code as string;
      const meta = (prismaErr.meta as Record<string, any>) || {};
      const targetFields = Array.isArray(meta.target)
        ? (meta.target as string[]).join(", ")
        : "";
      switch (code) {
        case "P2002": // Unique constraint failed（如同比赛下已存在同名地图节点/原料/生产线…）
          status = HttpStatus.CONFLICT; // 409 Conflict
          // 常见复合唯一键：(competitionId, name) => 对用户的友好提示就是「名称已存在」
          if (targetFields.includes("name")) {
            message = "操作失败：同比赛下该名称已存在，请换一个名称";
          } else if (targetFields) {
            message = `操作失败：存在重复数据（${targetFields}）`;
          } else {
            message = "操作失败：已存在相同记录";
          }
          break;
        case "P2003": // Foreign key constraint failed（外键引用的关联记录不存在）
          status = HttpStatus.CONFLICT;
          message = "操作失败：关联的引用数据不存在或无效";
          break;
        case "P2014": // Required relation violation（有外键依赖，无法修改/删除父记录）
          status = HttpStatus.CONFLICT;
          message = "操作失败：该记录存在关联数据依赖，无法修改或删除";
          break;
        case "P2025": // Record not found（CRUD 中操作的记录不存在）
          status = HttpStatus.NOT_FOUND;
          message = "操作失败：记录不存在或已被删除";
          break;
        default:
          // 其余 Prisma 错误统一降级为 400 业务错误，避免 500 前端误判系统崩溃
          status = HttpStatus.BAD_REQUEST;
          message = "操作失败，请检查输入";
      }
    } else if (exception instanceof HttpException) {
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

    // 401/403 属预期鉴权失败，不算业务错误：降级为 warn 避免刷屏，且不写审计日志（减少数据库压力）。
    const isAuthError = status === 401 || status === 403;
    const logFn = isAuthError ? logger.warn : logger.error;
    const logMsg = isAuthError ? "鉴权失败" : "未捕获异常";

    if (exception instanceof Error) {
      logFn(logMsg, {
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
      logFn(logMsg, {
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
    // 注意：401/403 鉴权失败跳过审计，避免每失效会话都插入审计行（既刷屏又打数据库）。
    if (!isAuthError) {
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
    }

    response.status(status).json({
      code: status,
      message,
      data: null,
    });
  }
}
