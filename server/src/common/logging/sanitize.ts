/**
 * 日志脱敏与截断工具。
 *
 * 所有写入日志的结构化数据（数据库审计的前后值、HTTP 请求体、异常上下文等）
 * 都必须先经过本模块清洗，确保：
 *  1. 密码哈希、JWT、密钥等敏感字段绝不进入日志文件；
 *  2. 超长字符串 / 过深对象 / 超大数组被截断，避免单条日志撑爆磁盘或日志平台。
 */

/** 命中即脱敏的键名（不区分大小写）。 */
const SENSITIVE_KEY_PATTERN =
  /^(password|passwd|pwd|passwordhash|hash|salt|token|secret|apikey|api_key|accesstoken|access_token|refreshtoken|refresh_token|authorization|credentials)$/i;

/** 字符串超过该长度即截断。 */
const MAX_STRING_LENGTH = 1000;

/** 对象序列化允许的最大嵌套层级。 */
const MAX_DEPTH = 4;

/** 数组超过该长度只保留前 N 项。 */
const MAX_ARRAY_ITEMS = 50;

/**
 * 剥离控制字符（含 \r \n \t 及 C0/C1 控制符），防止用户可控字段（如 username）
 * 注入换行伪造日志行或注入 ANSI/控制序列。用于直接进日志的纯文本字段。
 */
export function stripControlChars(input: unknown): string {
  if (input === null || input === undefined) return "";
  return String(input).replace(/[\x00-\x1f\x7f\x80-\x9f]/g, "");
}

/**
 * 递归清洗任意值：脱敏敏感字段、截断长字符串、限制对象层级与数组长度。
 * @param value 待清洗的值
 * @param depth 当前递归深度（内部使用）
 */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) {
      const cut = value.length - MAX_STRING_LENGTH;
      return value.slice(0, MAX_STRING_LENGTH) + `…(截断${cut}字)`;
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }

  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) {
      return "[对象层级过深]";
    }

    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) {
        const head = value.slice(0, MAX_ARRAY_ITEMS).map((v) => sanitize(v, depth + 1));
        return [...head, `…(数组共${value.length}项,仅展示前${MAX_ARRAY_ITEMS})`];
      }
      return value.map((v) => sanitize(v, depth + 1));
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "***(已脱敏)";
      } else {
        out[key] = sanitize(val, depth + 1);
      }
    }
    return out;
  }

  // function / symbol / undefined 等：转为可读字符串，避免 JSON 序列化报错。
  return String(value);
}
