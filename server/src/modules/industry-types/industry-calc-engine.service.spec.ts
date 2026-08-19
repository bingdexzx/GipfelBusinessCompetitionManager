import { IndustryCalcEngineService } from "./industry-calc-engine.service";

function formulaGraph(expr: string) {
  return {
    nodes: [
      { id: "out_1", type: "output", x: 0, y: 0, data: {} },
      { id: "val_1", type: "value", x: 0, y: 0, data: { kind: "FORMULA", expr } },
    ],
    edges: [
      {
        id: "e_1",
        source: "val_1",
        sourceHandle: "out",
        target: "out_1",
        targetHandle: "value",
      },
    ],
  };
}

describe("IndustryCalcEngineService", () => {
  const svc = new IndustryCalcEngineService({} as any);

  it("FORMULA 节点求值时支持 EXPR_HELPERS.IF（Excel 风格条件）", async () => {
    const g = formulaGraph("IF(a > 1, 100, 0)");
    expect(await svc.evaluate(g, { a: 5 })).toBe(100);
    expect(await svc.evaluate(g, { a: 0 })).toBe(0);
  });

  it("EXPR_HELPERS 支持 AND / OR / NOT", async () => {
    expect(await svc.evaluate(formulaGraph("IF(AND(a > 0, b > 0), 1, 0)"), { a: 1, b: 2 })).toBe(1);
    expect(await svc.evaluate(formulaGraph("IF(OR(a > 0, b > 0), 1, 0)"), { a: 0, b: 2 })).toBe(1);
    expect(await svc.evaluate(formulaGraph("IF(NOT(a > 0), 1, 0)"), { a: -1 })).toBe(1);
  });

  it("getFieldDependencies 提取 FORMULA expr 中的字段键（裸标识符）", () => {
    const g = formulaGraph("(mineCount + capacity) * 0.5");
    const deps = svc.getFieldDependencies(g);
    expect(deps).toContain("mineCount");
    expect(deps).toContain("capacity");
  });

  it("getFieldDependencies 不把函数名误判为字段依赖", () => {
    const g = formulaGraph("IF(a > 1, max(b, c), 0)");
    const deps = svc.getFieldDependencies(g);
    expect(deps).toContain("a");
    expect(deps).toContain("b");
    expect(deps).toContain("c");
    expect(deps).not.toContain("IF");
    expect(deps).not.toContain("max");
  });

  it("getFieldDependencies 仍支持 FIELD 数值源节点", () => {
    const g = {
      nodes: [
        { id: "out", type: "output", x: 0, y: 0, data: {} },
        { id: "v", type: "value", x: 0, y: 0, data: { kind: "FIELD", fieldKey: "revenue" } },
      ],
      edges: [
        { id: "e", source: "v", sourceHandle: "out", target: "out", targetHandle: "value" },
      ],
    };
    expect(svc.getFieldDependencies(g)).toEqual(["revenue"]);
  });
});
