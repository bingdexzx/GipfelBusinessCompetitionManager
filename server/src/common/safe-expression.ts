/**
 * 安全表达式求值器（替代 mathjs.evaluate）。
 *
 * 背景：原 FORMULA 节点使用 `mathjs.evaluate(expr, scope)`，但 mathjs 的表达式解析器
 * 默认允许成员访问（如 `((5).constructor.constructor)('return process')()`），
 * 对「管理员自定义的公式字符串」这属于**服务端 RCE 漏洞**（持 industryType:manage /
 * contractType:manage 的比赛级管理员可借公式执行任意代码）。
 *
 * 本求值器是一个**自研、受限、无代码执行能力**的递归下降解析器：
 * - 只允许：数字 / 字符串 / 数组字面量、变量引用、白名单内置函数、EXPR_HELPERS（经 scope 传入）、
 *   算术(+ - * / % ^)、比较(< > <= >= == !=)、逻辑(! && ||)、一元负号、数组下标、括号。
 * - **明确不支持**成员访问(`a.b`)、函数字面量、赋值、三目、import —— 从语法层面彻底堵死
 *   任何访问 `constructor` / `Function` 等逃逸路径，因此即使 expr 来自不可信用户输入也安全。
 *
 * 语义尽量贴近 mathjs 常用子集（含数组、variadic min/max/sum），以兼容既有公式。
 */

export class SafeExpressionError extends Error {}

// ---------- 词法分析 ----------
type TokType =
  | "num"
  | "str"
  | "ident"
  | "op"
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "comma"
  | "eof";

interface Tok {
  type: TokType;
  value: string;
}

class Tokenizer {
  private s: string;
  private i = 0;

  constructor(s: string) {
    this.s = s;
  }

  tokenize(): Tok[] {
    const out: Tok[] = [];
    const isDigit = (c: string) => c >= "0" && c <= "9";
    const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c);
    const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c);

    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") {
        this.i++;
        continue;
      }
      if (c === "(") {
        out.push({ type: "lparen", value: c });
        this.i++;
        continue;
      }
      if (c === ")") {
        out.push({ type: "rparen", value: c });
        this.i++;
        continue;
      }
      if (c === "[") {
        out.push({ type: "lbracket", value: c });
        this.i++;
        continue;
      }
      if (c === "]") {
        out.push({ type: "rbracket", value: c });
        this.i++;
        continue;
      }
      if (c === ",") {
        out.push({ type: "comma", value: c });
        this.i++;
        continue;
      }
      if (isDigit(c) || (c === "." && isDigit(this.s[this.i + 1] ?? ""))) {
        out.push(this.readNumber(isDigit));
        continue;
      }
      if (c === '"' || c === "'") {
        out.push(this.readString(c));
        continue;
      }
      if (isIdentStart(c)) {
        out.push(this.readIdent(isIdentPart));
        continue;
      }
      // 多字符运算符优先
      const two = this.s.substr(this.i, 2);
      if (
        two === "**" ||
        two === "==" ||
        two === "!=" ||
        two === "<=" ||
        two === ">=" ||
        two === "&&" ||
        two === "||"
      ) {
        out.push({ type: "op", value: two });
        this.i += 2;
        continue;
      }
      if ("+-*/%^<>!".includes(c)) {
        out.push({ type: "op", value: c });
        this.i++;
        continue;
      }
      // 不支持的记号（含 . 成员访问）：直接报错，避免任何逃逸路径。
      throw new SafeExpressionError(`不支持的字符: "${c}"`);
    }
    out.push({ type: "eof", value: "" });
    return out;
  }

  private readNumber(isDigit: (c: string) => boolean): Tok {
    const start = this.i;
    while (this.i < this.s.length && (isDigit(this.s[this.i]) || this.s[this.i] === ".")) {
      this.i++;
    }
    if (this.i < this.s.length && (this.s[this.i] === "e" || this.s[this.i] === "E")) {
      this.i++;
      if (this.s[this.i] === "+" || this.s[this.i] === "-") this.i++;
      while (this.i < this.s.length && isDigit(this.s[this.i])) this.i++;
    }
    const text = this.s.slice(start, this.i);
    const n = Number(text);
    if (Number.isNaN(n)) throw new SafeExpressionError(`非法数字: ${text}`);
    return { type: "num", value: text };
  }

  private readString(quote: string): Tok {
    this.i++; // 跳过起始引号
    let str = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (c === "\\") {
        this.i++;
        const e = this.s[this.i];
        if (e === "n") str += "\n";
        else if (e === "t") str += "\t";
        else if (e === "r") str += "\r";
        else str += e ?? "";
        this.i++;
        continue;
      }
      if (c === quote) {
        this.i++;
        break;
      }
      str += c;
      this.i++;
    }
    return { type: "str", value: str };
  }

  private readIdent(isIdentPart: (c: string) => boolean): Tok {
    const start = this.i;
    while (this.i < this.s.length && isIdentPart(this.s[this.i])) this.i++;
    return { type: "ident", value: this.s.slice(start, this.i) };
  }
}

// ---------- 求值辅助 ----------
function toNum(v: any): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function truthy(v: any): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function asList(x: any): any[] {
  return Array.isArray(x) ? x : x == null ? [] : [x];
}

function addVal(a: any, b: any): any {
  if (Array.isArray(a) || Array.isArray(b)) return [...asList(a), ...asList(b)];
  if (typeof a === "string" || typeof b === "string") return String(a) + String(b);
  return toNum(a) + toNum(b);
}

function subVal(a: any, b: any): any {
  if (Array.isArray(a) || Array.isArray(b)) {
    const lb = asList(b);
    return asList(a).filter((x: any) => !lb.some((y: any) => deepEqual(x, y)));
  }
  return toNum(a) - toNum(b);
}

function indexValue(v: any, idx: any): any {
  if (Array.isArray(v)) {
    const i = toNum(idx);
    return v[i] ?? 0;
  }
  if (v && typeof v === "object") {
    return Object.prototype.hasOwnProperty.call(v, idx) ? v[idx] : 0;
  }
  return 0;
}

const BUILTIN_CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** 受限内置数学函数（覆盖 mathjs 常用子集；不暴露任何可执行/对象逃逸能力）。 */
const BUILTIN_FUNCS: Record<string, (...args: any[]) => any> = {
  abs: (x: any) => Math.abs(toNum(x)),
  sqrt: (x: any) => Math.sqrt(toNum(x)),
  cbrt: (x: any) => Math.cbrt(toNum(x)),
  sign: (x: any) => Math.sign(toNum(x)),
  floor: (x: any) => Math.floor(toNum(x)),
  ceil: (x: any) => Math.ceil(toNum(x)),
  round: (x: any) => Math.round(toNum(x)),
  trunc: (x: any) => Math.trunc(toNum(x)),
  pow: (a: any, b: any) => Math.pow(toNum(a), toNum(b)),
  exp: (x: any) => Math.exp(toNum(x)),
  log: (x: any) => Math.log(toNum(x)),
  log2: (x: any) => Math.log2(toNum(x)),
  log10: (x: any) => Math.log10(toNum(x)),
  sin: (x: any) => Math.sin(toNum(x)),
  cos: (x: any) => Math.cos(toNum(x)),
  tan: (x: any) => Math.tan(toNum(x)),
  asin: (x: any) => Math.asin(toNum(x)),
  acos: (x: any) => Math.acos(toNum(x)),
  atan: (x: any) => Math.atan(toNum(x)),
  atan2: (y: any, x: any) => Math.atan2(toNum(y), toNum(x)),
  sinh: (x: any) => Math.sinh(toNum(x)),
  cosh: (x: any) => Math.cosh(toNum(x)),
  tanh: (x: any) => Math.tanh(toNum(x)),
  hypot: (...a: any[]) => Math.hypot(...a.map(toNum)),
  mod: (a: any, b: any) => {
    const x = toNum(a);
    const y = toNum(b);
    return y === 0 ? 0 : x % y;
  },
  clamp: (x: any, lo: any, hi: any) =>
    Math.min(Math.max(toNum(x), toNum(lo)), toNum(hi)),
  min: (...a: any[]) => {
    const arr = a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
    return Math.min(...arr.map(toNum));
  },
  max: (...a: any[]) => {
    const arr = a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
    return Math.max(...arr.map(toNum));
  },
  sum: (...a: any[]) => {
    const arr = a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
    return arr.reduce((s: number, x: any) => s + toNum(x), 0);
  },
  avg: (...a: any[]) => {
    const arr = a.length === 1 && Array.isArray(a[0]) ? a[0] : a;
    return arr.length ? arr.reduce((s: number, x: any) => s + toNum(x), 0) / arr.length : 0;
  },
};

// ---------- 语法分析 + 求值 ----------
class Parser {
  private pos = 0;

  constructor(
    private tokens: Tok[],
    private scope: Record<string, any>,
  ) {}

  private peek(): Tok {
    return this.tokens[this.pos];
  }
  private next(): Tok {
    return this.tokens[this.pos++];
  }
  private expect(type: TokType, val?: string): Tok {
    const t = this.next();
    if (t.type !== type || (val && t.value !== val)) {
      throw new SafeExpressionError(`语法错误：期望 ${val || type}，实际 "${t.value || t.type}"`);
    }
    return t;
  }

  parse(): any {
    const v = this.parseOr();
    if (this.peek().type !== "eof") {
      throw new SafeExpressionError(`表达式存在多余内容: "${this.peek().value}"`);
    }
    return v;
  }

  private parseOr(): any {
    let left = this.parseAnd();
    while (this.peek().type === "op" && this.peek().value === "||") {
      this.next();
      const right = this.parseAnd();
      left = truthy(left) || truthy(right) ? left : right;
    }
    return left;
  }

  private parseAnd(): any {
    let left = this.parseEquality();
    while (this.peek().type === "op" && this.peek().value === "&&") {
      this.next();
      const right = this.parseEquality();
      left = truthy(left) && truthy(right) ? left : right;
    }
    return left;
  }

  private parseEquality(): any {
    let left = this.parseComparison();
    while (
      this.peek().type === "op" &&
      (this.peek().value === "==" || this.peek().value === "!=")
    ) {
      const op = this.next().value;
      const right = this.parseComparison();
      const eq = deepEqual(left, right);
      left = op === "==" ? eq : !eq;
    }
    return left;
  }

  private parseComparison(): any {
    let left = this.parseAdditive();
    while (
      this.peek().type === "op" &&
      (this.peek().value === "<" ||
        this.peek().value === ">" ||
        this.peek().value === "<=" ||
        this.peek().value === ">=")
    ) {
      const op = this.next().value;
      const right = this.parseAdditive();
      const a = toNum(left);
      const b = toNum(right);
      left =
        op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b;
    }
    return left;
  }

  private parseAdditive(): any {
    let left = this.parseMultiplicative();
    while (this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value;
      const right = this.parseMultiplicative();
      left = op === "+" ? addVal(left, right) : subVal(left, right);
    }
    return left;
  }

  private parseMultiplicative(): any {
    let left = this.parsePower();
    while (
      this.peek().type === "op" &&
      (this.peek().value === "*" || this.peek().value === "/" || this.peek().value === "%")
    ) {
      const op = this.next().value;
      const right = this.parsePower();
      const a = toNum(left);
      const b = toNum(right);
      left = op === "*" ? a * b : op === "/" ? (b === 0 ? 0 : a / b) : b === 0 ? 0 : a % b;
    }
    return left;
  }

  private parsePower(): any {
    const base = this.parseUnary();
    if (this.peek().type === "op" && (this.peek().value === "^" || this.peek().value === "**")) {
      this.next();
      const exp = this.parsePower(); // 右结合
      return Math.pow(toNum(base), toNum(exp));
    }
    return base;
  }

  private parseUnary(): any {
    const t = this.peek();
    if (t.type === "op" && (t.value === "-" || t.value === "+" || t.value === "!")) {
      this.next();
      const v = this.parseUnary();
      if (t.value === "-") return -toNum(v);
      if (t.value === "+") return toNum(v);
      return !truthy(v);
    }
    return this.parsePostfix();
  }

  private parsePostfix(): any {
    let v = this.parsePrimary();
    while (this.peek().type === "lbracket") {
      this.next();
      const idx = this.parseOr();
      this.expect("rbracket");
      v = indexValue(v, idx);
    }
    return v;
  }

  private parsePrimary(): any {
    const t = this.next();
    if (t.type === "num") return Number(t.value);
    if (t.type === "str") return t.value;
    if (t.type === "lparen") {
      const v = this.parseOr();
      this.expect("rparen");
      return v;
    }
    if (t.type === "lbracket") {
      const arr: any[] = [];
      if (this.peek().type !== "rbracket") {
        arr.push(this.parseOr());
        while (this.peek().type === "comma") {
          this.next();
          arr.push(this.parseOr());
        }
      }
      this.expect("rbracket");
      return arr;
    }
    if (t.type === "ident") {
      const name = t.value;
      if (name === "true") return true;
      if (name === "false") return false;
      if (name === "null") return null;
      if (this.peek().type === "lparen") {
        // 函数调用
        this.next();
        const args: any[] = [];
        if (this.peek().type !== "rparen") {
          args.push(this.parseOr());
          while (this.peek().type === "comma") {
            this.next();
            args.push(this.parseOr());
          }
        }
        this.expect("rparen");
        return this.callFn(name, args);
      }
      // 变量引用：未定义变量回退为 0（与字段缺省语义一致）
      if (Object.prototype.hasOwnProperty.call(this.scope, name)) return this.scope[name];
      if (Object.prototype.hasOwnProperty.call(BUILTIN_CONSTS, name)) return BUILTIN_CONSTS[name];
      return 0;
    }
    throw new SafeExpressionError(`意外的记号: "${t.value || t.type}"`);
  }

  private callFn(name: string, args: any[]): any {
    const builtin = BUILTIN_FUNCS[name];
    if (builtin) return builtin(...args);
    const sc = this.scope[name];
    if (typeof sc === "function") return sc(...args);
    throw new SafeExpressionError(`未知函数: ${name}`);
  }
}

/**
 * 安全地求值一个受限数学表达式。
 * @param expr  用户（管理员）定义的公式字符串，仅允许受限语法。
 * @param scope 变量作用域（字段现值 + EXPR_HELPERS 等）。未知变量回退为 0。
 * @throws SafeExpressionError 语法错误 / 未知函数 / 使用了不支持的语法（如成员访问）。
 */
export function safeEvaluate(expr: string, scope: Record<string, any> = {}): any {
  if (expr == null || expr === "") return 0;
  const tokens = new Tokenizer(expr).tokenize();
  return new Parser(tokens, scope).parse();
}
