// 产业计算字段的表达式树求值工具（前端）
//
// 表达式树节点格式（由可视化构建器生成，序列化为 formula 字符串存储）：
//   { type: "const", value: number }
//   { type: "field", fieldKey: string }
//   { type: "op", op: "+" | "-" | "*" | "/", left: Node, right: Node }
//
// scope: Record<fieldKey, number>，即同产业其它字段的当前数值。

export type ExprNode =
  | { type: "const"; value: number | string }
  | { type: "field"; fieldKey: string }
  | { type: "op"; op: "+" | "-" | "*" | "/"; left: ExprNode; right: ExprNode };

// 把任意输入安全地转成数字（非有限数返回 0）
function toNum(v: any): number {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// 求值；出错时抛出，便于上层提示
export function evalTree(node: any, scope: Record<string, any> = {}): number {
  if (!node || typeof node !== "object") return 0;
  switch (node.type) {
    case "const":
      return toNum(node.value);
    case "field": {
      if (!node.fieldKey) throw new Error("字段引用缺少 fieldKey");
      return toNum(scope[node.fieldKey]);
    }
    case "op": {
      const ops: Record<string, (a: number, b: number) => number> = {
        "+": (a, b) => a + b,
        "-": (a, b) => a - b,
        "*": (a, b) => a * b,
        "/": (a, b) => (b === 0 ? 0 : a / b),
      };
      const fn = ops[node.op];
      if (!fn) throw new Error(`未知运算符：${node.op}`);
      const a = evalTree(node.left, scope);
      const b = evalTree(node.right, scope);
      return fn(a, b);
    }
    default:
      throw new Error(`未知表达式节点：${node.type}`);
  }
}

// 把后端返回的 formula（JSON 字符串或对象）规整为表达式树；非法则回退为常量 0
export function parseFormulaTree(raw: any): ExprNode {
  if (raw && typeof raw === "object" && raw.type) return raw as ExprNode;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const o = JSON.parse(raw);
      if (o && o.type) return o as ExprNode;
    } catch {
      /* ignore */
    }
  }
  return { type: "const", value: 0 };
}

// 把表达式树转成给人看的文本（用于 UI 预览），非求值用途
export function treeToText(node: any, fields?: Record<string, string>): string {
  if (!node || typeof node !== "object") return "";
  switch (node.type) {
    case "const":
      return String(node.value);
    case "field":
      return fields?.[node.fieldKey] ? `${fields[node.fieldKey]}(${node.fieldKey})` : node.fieldKey;
    case "op":
      return `(${treeToText(node.left, fields)} ${node.op} ${treeToText(node.right, fields)})`;
    default:
      return "";
  }
}
