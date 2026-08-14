import { WinstonModule } from "nest-winston";
import * as winston from "winston";
import * as DailyRotateFile from "winston-daily-rotate-file";
import { getOperator, getRequestId, getIp, formatOperator } from "./operator.context";

/**
 * 自定义 format：在日志输出前，从 AsyncLocalStorage 读取当前请求的操作员、
 * 请求编号与客户端 IP，写入 info。这样【每一条】日志（无论来自拦截器、过滤器、
 * 服务还是 Prisma 审计中间件）都会自动带上操作人员与来源，用于操作溯源。
 */
const contextFormat = winston.format((info) => {
  const op = getOperator();
  const rid = getRequestId();
  const ip = getIp();
  info.operator = op;
  info.requestId = rid ?? null;
  info.ip = ip ?? null;
  return info;
})();

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  contextFormat,
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, context, operator, requestId, ip, ...meta }) => {
    const ctx = context ? `[${context}]` : "";
    const opLabel = ` [operator=${formatOperator((operator as any) ?? null)}]`;
    const ridLabel = requestId ? ` [rid=${requestId}]` : "";
    const ipLabel = ip ? ` [ip=${ip}]` : "";
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    return `${timestamp} ${level} ${ctx} ${message}${opLabel}${ridLabel}${ipLabel}${metaStr}`;
  }),
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  contextFormat,
  winston.format.json(),
);

/** 单一共享的 winston 实例：所有日志（含 Prisma 审计）都走它，避免重复 transport 双写。 */
export const appWinston: winston.Logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  transports: [
    new winston.transports.Console({ format: consoleFormat }),
    new DailyRotateFile({
      dirname: process.env.LOG_DIR || "./logs",
      filename: "app-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxFiles: "30d",
      format: fileFormat,
      level: "info",
    }),
    new DailyRotateFile({
      dirname: process.env.LOG_DIR || "./logs",
      filename: "error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxFiles: "30d",
      format: fileFormat,
      level: "error",
    }),
  ],
});

/**
 * 供 Nest 使用的日志服务：复用同一 appWinston 实例，保证内置日志与自定义日志一致。
 * 返回值是一个 LoggerService，可直接传给 NestFactory.create({ logger })。
 */
export function WinstonLogger() {
  return WinstonModule.createLogger({ instance: appWinston });
}

/** 供非模块的普通代码（如 PrismaService）直接使用的快捷入口，等价于 appWinston。 */
export const logger = appWinston;
