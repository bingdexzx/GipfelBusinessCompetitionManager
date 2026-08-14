/**
 * 安全的数学表达式求值器（替代 new Function，杜绝代码注入）。
 *
 * 仅支持：数值、四则运算、括号、一元正负号、以及白名单内的数学函数。
 * 变量名从传入的 scope 取值；任何其他标识符（如试图访问 JS 全局对象）都会抛错。
 * 不依赖任何第三方库，也不构造 Function / eval。
 */

type Scope = Record<string, number>;

type Token =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" }
  | { t: "comma" };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  round: (x) => Math.round(x),
  max: (...a) => Math.max(...a),
  min: (...a) => Math.min(...a),
  abs: (x) => Math.abs(x),
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
  sqrt: (x) => Math.sqrt(x),
  pow: (a, b) => Math.pow(a, b),
  log: (x) => Math.log(x),
  sum: (...a) => a.reduce((s, x) => s + x, 0),
  avg: (...a) => a.reduce((s, x) => s + x, 0) / (a.length || 1),
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = parseFloat(s.slice(i, j));
      if (Number.isNaN(num)) throw new Error("无效数字");
      tokens.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      tokens.push({ t: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "(") {
      tokens.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ t: "rp" });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ t: "comma" });
      i++;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ t: "op", v: c });
      i++;
      continue;
    }
    throw new Error(`非法字符: ${c}`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private scope: Scope,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isFunc(name: string): boolean {
    return name in FUNCTIONS;
  }

  parse(): number {
    const v = this.parseExpr();
    if (this.pos < this.tokens.length) throw new Error("表达式存在多余符号");
    return v;
  }

  private parseExpr(): number {
    let left = this.parseTerm();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.t === "op" && (tk.v === "+" || tk.v === "-")) {
        this.pos++;
        const right = this.parseTerm();
        left = tk.v === "+" ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parseFactor();
    for (;;) {
      const tk = this.peek();
      if (tk && tk.t === "op" && (tk.v === "*" || tk.v === "/")) {
        this.pos++;
        const right = this.parseFactor();
        if (tk.v === "/") {
          if (right === 0) throw new Error("除以零");
          left = left / right;
        } else {
          left = left * right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  private parseFactor(): number {
    const tk = this.peek();
    if (!tk) throw new Error("表达式不完整");
    // 一元正负号
    if (tk.t === "op" && (tk.v === "+" || tk.v === "-")) {
      this.pos++;
      const v = this.parseFactor();
      return tk.v === "-" ? -v : v;
    }
    if (tk.t === "num") {
      this.pos++;
      return tk.v;
    }
    if (tk.t === "lp") {
      this.pos++;
      const v = this.parseExpr();
      if (!this.peek() || this.peek()!.t !== "rp") throw new Error("缺少右括号");
      this.pos++;
      return v;
    }
    if (tk.t === "id") {
      this.pos++;
      // 函数调用：标识符后紧跟 '('
      if (this.peek() && this.peek()!.t === "lp") {
        if (!this.isFunc(tk.v)) throw new Error(`未知函数: ${tk.v}`);
        this.pos++;
        const args: number[] = [];
        if (this.peek() && this.peek()!.t !== "rp") {
          args.push(this.parseExpr());
          while (this.peek() && this.peek()!.t === "comma") {
            this.pos++;
            args.push(this.parseExpr());
          }
        }
        if (!this.peek() || this.peek()!.t !== "rp") throw new Error("函数缺少右括号");
        this.pos++;
        return FUNCTIONS[tk.v](...args);
      }
      // 变量引用
      const val = this.scope[tk.v];
      if (typeof val !== "number" || Number.isNaN(val)) {
        throw new Error(`未知变量: ${tk.v}`);
      }
      return val;
    }
    throw new Error("表达式语法错误");
  }
}

export function evaluateFormula(expression: string, scope: Scope): number {
  const tokens = tokenize(expression);
  return new Parser(tokens, scope).parse();
}
