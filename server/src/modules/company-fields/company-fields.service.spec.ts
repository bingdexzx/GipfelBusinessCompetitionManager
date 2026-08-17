import { CompanyFieldsService } from "./company-fields.service";
import { FieldWriteConflictException } from "../../common/exceptions/field-write-conflict.exception";

/**
 * 纯单测：writeFieldValueInTx 的乐观锁/重试/冲突逻辑（用内存假 tx，无需真实 DB）。
 */
function makeFakeTx(opts: { rows?: Map<string, { id: number; version: number }>; conflictAlways?: boolean }) {
  const rows = opts.rows ?? new Map<string, { id: number; version: number }>();
  let nextId = 100;
  const calls = { create: [] as any[], updateMany: [] as any[] };
  const findRow = (companyId: number, industryFieldId: number) =>
    [...rows.entries()].find(([k]) => k === `${companyId}:${industryFieldId}`)?.[1] ?? null;

  const tx: any = {
    companyFieldValue: {
      findUnique: async ({ where }: any) => {
        const { companyId, industryFieldId } = where.companyId_industryFieldId;
        const row = findRow(companyId, industryFieldId);
        return row ? { id: row.id, version: row.version } : null;
      },
      create: async ({ data }: any) => {
        const row = { id: nextId++, version: data.version ?? 0 };
        rows.set(`${data.companyId}:${data.industryFieldId}`, row);
        calls.create.push(data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const row = [...rows.values()].find((r) => r.id === where.id);
        calls.updateMany.push({ where, data });
        if (opts.conflictAlways) return { count: 0 }; // 模拟一直被抢占
        if (row && row.version === where.version) {
          row.version += 1;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };
  return { tx, rows, calls };
}

function makeService(): CompanyFieldsService {
  // writeFieldValueInTx 不依赖这三个成员，传桩即可
  return new CompanyFieldsService({} as any, {} as any, {} as any);
}

describe("CompanyFieldsService.writeFieldValueInTx", () => {
  it("行不存在 → create(version=0)", async () => {
    const { tx, calls } = makeFakeTx({});
    const svc = makeService();
    await svc.writeFieldValueInTx(tx, 1, 10, "42");
    expect(calls.create.length).toBe(1);
    expect(calls.create[0]).toMatchObject({ companyId: 1, industryFieldId: 10, value: "42", version: 0 });
  });

  it("行存在且 version 匹配 → updateMany 自增 version", async () => {
    const { tx, rows, calls } = makeFakeTx({ rows: new Map([["1:10", { id: 7, version: 3 }]]) });
    const svc = makeService();
    await svc.writeFieldValueInTx(tx, 1, 10, "99");
    expect(calls.create.length).toBe(0);
    expect(calls.updateMany.length).toBe(1);
    expect(calls.updateMany[0].where).toMatchObject({ id: 7, version: 3 });
    expect(calls.updateMany[0].data).toMatchObject({ value: "99" });
    expect(calls.updateMany[0].data.version).toEqual({ increment: 1 });
    expect(rows.get("1:10")!.version).toBe(4);
  });

  it("version 被抢占 → 重试后用新 version 成功", async () => {
    // 模拟并发：第一次 updateMany 返回 count 0（被抢占），第二次 findUnique 拿到新 version 后成功
    const rows = new Map([["1:10", { id: 7, version: 3 }]]);
    let attempt = 0;
    const calls = { updateMany: [] as any[] };
    const tx: any = {
      companyFieldValue: {
        findUnique: async () => ({ id: 7, version: 3 + attempt }),
        create: async () => {
          throw new Error("should not create");
        },
        updateMany: async ({ where, data }: any) => {
          calls.updateMany.push({ where, data });
          if (attempt === 0) {
            attempt = 1;
            return { count: 0 };
          }
          rows.set("1:10", { id: 7, version: where.version + 1 });
          return { count: 1 };
        },
      },
    };
    const svc = makeService();
    await svc.writeFieldValueInTx(tx, 1, 10, "7");
    expect(calls.updateMany.length).toBe(2);
    // 初始 v3 → 被抢占后重试读得 v4 → 成功自增为 v5（A:3→4, B:4→5）
    expect(rows.get("1:10")!.version).toBe(5);
  });

  it("持续冲突（count 始终 0）→ 抛 FieldWriteConflictException", async () => {
    const { tx } = makeFakeTx({ rows: new Map([["1:10", { id: 7, version: 3 }]]), conflictAlways: true });
    const svc = makeService();
    await expect(svc.writeFieldValueInTx(tx, 1, 10, "1")).rejects.toBeInstanceOf(FieldWriteConflictException);
  });

  it("并发 create 触发 P2002 → 重试命中已存在分支", async () => {
    const rows = new Map<string, { id: number; version: number }>();
    let created = false;
    const tx: any = {
      companyFieldValue: {
        findUnique: async () => (rows.size ? { id: 5, version: 0 } : null),
        create: async ({ data }: any) => {
          if (!created) {
            created = true;
            const e: any = new Error("Unique constraint failed");
            e.code = "P2002";
            throw e;
          }
          rows.set(`${data.companyId}:${data.industryFieldId}`, { id: 5, version: 0 });
          return { id: 5, version: 0 };
        },
        updateMany: async ({ where, data }: any) => {
          if (rows.has("1:10")) {
            rows.set("1:10", { id: 5, version: 1 });
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
    };
    const svc = makeService();
    await svc.writeFieldValueInTx(tx, 1, 10, "5");
    expect(rows.has("1:10")).toBe(true);
  });
});
