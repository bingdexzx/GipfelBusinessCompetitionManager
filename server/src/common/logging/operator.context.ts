import { AsyncLocalStorage } from "async_hooks";

/**
 * 单次请求的操作上下文，保存在 AsyncLocalStorage 中，
 * 使同一请求内的控制器 / 服务 / Prisma 中间件 / 拦截器 / 过滤器
 * 都能无侵入地拿到「操作员」与「请求编号」，用于日志溯源。
 */
export interface OperatorInfo {
  id: number;
  username: string;
  role: string;
}

export interface RequestContext {
  requestId: string;
  operator: OperatorInfo | null;
  /** 客户端 IP，用于溯源操作来源。 */
  ip: string | null;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/** 当前请求的操作员；非请求上下文（如启动初始化）返回 null。 */
export function getOperator(): OperatorInfo | null {
  return requestContextStorage.getStore()?.operator ?? null;
}

/** 当前请求的编号；用于把同一次请求的多条日志串联起来。 */
export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}

/** 当前请求的客户端 IP；非请求上下文返回 null。 */
export function getIp(): string | null {
  return requestContextStorage.getStore()?.ip ?? null;
}

/** 在给定请求上下文内执行回调，回调内所有日志自动带上操作员与请求编号。 */
export function runWithRequestContext<T>(ctx: RequestContext, cb: () => T): T {
  return requestContextStorage.run(ctx, cb);
}

/** 把操作员格式化为可读字符串，便于控制台日志直接展示。 */
export function formatOperator(op: OperatorInfo | null): string {
  if (!op) return "anonymous";
  // 用户名用户可控，剥离控制字符以防日志注入（伪造日志行 / ANSI 注入）。
  const safeName = String(op.username).replace(/[\x00-\x1f\x7f\x80-\x9f]/g, "");
  return `${safeName}(#${op.id})/${op.role}`;
}
