/**
 * JSON 解析工具。
 *
 * 数据库中部分字段以 String 类型存储 JSON 数组（如合同 `parties`），
 * 读写两侧都需安全解析。此前的解析逻辑在 contract.service 中分散重复，
 * 现抽出为公共工具，供列表解析与参与方公司 id 提取复用。
 */

/**
 * 把可能已是数组、JSON 字符串、或 null/undefined 的输入安全解析为数组。
 * - 已是数组：直接返回。
 * - 空值（null/undefined/''/0/false）：返回空数组。
 * - 字符串：尝试 JSON.parse，成功且为数组则返回，否则返回空数组。
 * - 其它（对象等）：返回空数组。
 */
export function parseJsonArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * 解析产业字段的 config 配置（DICTIONARY -> entries/valueType；LIST -> itemType）。
 * 输入可能是对象、JSON 字符串或 null/undefined，统一返回 Record<string, any>。
 * 解析失败时返回空对象 {}。
 */
export function parseFieldConfig(raw: any): Record<string, any> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}
