import { AsyncLocalStorage } from "async_hooks";

/**
 * 审计落库共享模块（R10 安全加固）。
 *
 * 数据库写操作的审计目前由 PrismaService.$allOperations 扩展统一拦截，异常上下文由
 * HttpExceptionFilter 拦截。两者都需要把记录写入 AuditLog 表，但审计写本身也是一次
 * Prisma 写操作，若不加防护会触发「审计写 → 又被审计 → 再写」的无限递归。
 *
 * 解决方式：
 * 1. 用 AsyncLocalStorage 标记「当前正处于审计写上下文」，审计写被拦截后直接放行，不再二次审计；
 * 2. 审计写统一走「原始 PrismaClient」（由 PrismaService 构造时经 setAuditPrisma 注入），
 *    因为 $extends 扩展回调里的 this 不一定可靠暴露模型委托（auditLog 可能为 undefined），
 *    而原始 client 一定持有全部模型委托；同时原始 client 的写不进入 $allOperations 扩展，
 *    天然避免递归（标记仅作双保险）。
 */

const suppressAuditStorage = new AsyncLocalStorage<boolean>();

/** 审计写专用客户端（原始 PrismaClient），由 PrismaService 构造时注入。 */
let auditPrisma: { auditLog: { create: (args: { data: AuditEntry }) => Promise<unknown> } } | null =
  null;

export function setAuditPrisma(client: any): void {
  auditPrisma = client;
}

export interface AuditEntry {
  kind: "write" | "error";
  action: string;
  operatorId?: number | null;
  operatorName?: string | null;
  model?: string | null;
  recordId?: string | null;
  competitionId?: number | null;
  changes?: string | null;
  statusCode?: number | null;
  errorSummary?: string | null;
  ip?: string | null;
  requestId?: string | null;
}

/**
 * 异步把一条审计记录写入 AuditLog 表。
 * - 通过 suppress 标记包裹，审计写自身不会再被二次审计；
 * - 走原始 client，不进入 $allOperations 扩展，天然避免递归；
 * - fire-and-forget：失败静默吞掉，绝不影响主流程（审计是「尽力而为」的真相记录）；
 * - 审计写客户端未就绪（如启动极早期）时静默跳过，避免崩溃。
 */
export function writeAuditLog(entry: AuditEntry): void {
  if (!auditPrisma) return;
  suppressAuditStorage.run(true, () => {
    void auditPrisma!
      .auditLog.create({ data: entry })
      .catch(() => {
        /* 审计落库失败不影响主流程 */
      });
  });
}
