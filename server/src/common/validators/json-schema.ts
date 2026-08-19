/**
 * JSON 字段校验器（基于 zod）。
 *
 * 为 ContractType 的四个 JSON 字段提供声明式校验：
 * - partyRoles: 参与方角色定义
 * - inputSchema: 输入参数定义
 * - effects: 效果定义
 * - conditions: 前置条件定义
 *
 * 用法：
 *   import { validatePartyRoles, validateEffects } from 'src/common/validators/json-schema';
 *   const result = validatePartyRoles(jsonString);
 *   if (!result.success) throw new BadRequestException(result.error);
 */

import { z } from 'zod';

// ========== 通用工具 ==========

/**
 * 安全解析 JSON 字符串
 */
function safeParseJson(raw: string): { success: true; data: unknown } | { success: false; error: string } {
  try {
    return { success: true, data: JSON.parse(raw) };
  } catch {
    return { success: false, error: '无效的 JSON 字符串' };
  }
}

/**
 * 校验结果类型
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * 通用校验函数：JSON 字符串 → zod schema 校验
 */
function validateWithSchema<T>(raw: string, schema: z.ZodType<T>): ValidationResult<T> {
  const parsed = safeParseJson(raw);
  if (!parsed.success) return parsed;

  const result = schema.safeParse(parsed.data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
  return { success: false, error: errors };
}

// ========== partyRoles 校验 ==========

const PartyRoleSchema = z.object({
  role: z.string().min(1, '角色标识不能为空'),
  label: z.string().min(1, '角色标签不能为空'),
  selectable: z.boolean().optional().default(true),
  isHost: z.boolean().optional().default(false),
});

const PartyRolesSchema = z.array(PartyRoleSchema).min(1, '至少需要一个参与方角色');

/**
 * 校验 partyRoles JSON 字符串
 * @example
 * ```json
 * [
 *   { "role": "A", "label": "放款方", "selectable": true, "isHost": false },
 *   { "role": "B", "label": "借款方", "selectable": true, "isHost": true }
 * ]
 * ```
 */
export function validatePartyRoles(raw: string): ValidationResult<z.infer<typeof PartyRolesSchema>> {
  return validateWithSchema(raw, PartyRolesSchema);
}

// ========== inputSchema 校验 ==========

const InputFieldSchema = z.object({
  key: z.string().min(1, '字段 key 不能为空'),
  label: z.string().min(1, '字段标签不能为空'),
  type: z.enum(['NUMBER', 'STRING', 'BOOLEAN', 'SELECT', 'MULTI_SELECT', 'COMPANY_REF']),
  required: z.boolean().optional().default(false),
  default: z.unknown().optional(),
  enum: z.array(z.object({
    value: z.union([z.string(), z.number()]),
    label: z.string(),
  })).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const InputSchemaSchema = z.array(InputFieldSchema);

/**
 * 校验 inputSchema JSON 字符串
 * @example
 * ```json
 * [
 *   { "key": "amount", "label": "金额", "type": "NUMBER", "required": true, "min": 0 },
 *   { "key": "term", "label": "期限", "type": "SELECT", "enum": [{"value": 1, "label": "1年"}, {"value": 3, "label": "3年"}] }
 * ]
 * ```
 */
export function validateInputSchema(raw: string): ValidationResult<z.infer<typeof InputSchemaSchema>> {
  return validateWithSchema(raw, InputSchemaSchema);
}

// ========== effects 校验 ==========

const FieldEffectOpSchema = z.enum(['ADD', 'SUB', 'SET']);

const FieldEffectSchema = z.object({
  type: z.literal('FIELD'),
  companyId: z.string().min(1, '公司标识不能为空'),
  fieldKey: z.string().min(1, '字段 key 不能为空'),
  op: FieldEffectOpSchema,
  value: z.union([z.number(), z.string()]).refine(
    (v) => {
      if (typeof v === 'number') return Number.isFinite(v);
      return v.length > 0;
    },
    { message: '值必须是有限数字或非空字符串' },
  ),
});

const ConditionalEffectSchema = z.object({
  type: z.literal('IF'),
  condition: z.lazy(() => ConditionSchema),
  then: z.array(z.lazy(() => EffectSchema)),
  else: z.array(z.lazy(() => EffectSchema)).optional(),
});

const ForeachEffectSchema = z.object({
  type: z.literal('FOREACH'),
  collection: z.string().min(1, '集合标识不能为空'),
  item: z.string().min(1, '迭代变量名不能为空'),
  body: z.array(z.lazy(() => EffectSchema)),
});

const AssignEffectSchema = z.object({
  type: z.literal('ASSIGN'),
  variable: z.string().min(1, '变量名不能为空'),
  value: z.unknown(),
});

// EffectSchema 用 discriminated union
const EffectSchema = z.discriminatedUnion('type', [
  FieldEffectSchema,
  ConditionalEffectSchema,
  ForeachEffectSchema,
  AssignEffectSchema,
]);

const EffectsSchema = z.array(EffectSchema);

/**
 * 校验 effects JSON 字符串
 * @example
 * ```json
 * [
 *   { "type": "FIELD", "companyId": "B", "fieldKey": "cash", "op": "SUB", "value": 1000 },
 *   { "type": "IF", "condition": {...}, "then": [...], "else": [...] }
 * ]
 * ```
 */
export function validateEffects(raw: string): ValidationResult<z.infer<typeof EffectsSchema>> {
  return validateWithSchema(raw, EffectsSchema);
}

// ========== conditions 校验 ==========
// 注意：引擎（contract-engine.service.ts runConditions）实际读取的是
// { kind, party, op: 'GTE'|'LTE'|..., value } 形态（可视化编辑器 graphToFlat 也产出此形态）。
// 这里同时兼容旧版 { type, companyId, op: '>='|... } 形态，避免存量数据保存时被校验拒绝，
// 也与引擎执行形态保持一致。VALUE_COMPARE / DICT_COMPARE / LIST_COMPARE 仅可视化编辑器产出，
// 只有 kind 形态。

// 产业字段比较 —— 引擎形态（kind/party）
const FieldCompareConditionSchema = z.union([
  z.object({
    kind: z.literal('FIELD_COMPARE'),
    party: z.string().min(1),
    fieldKey: z.string().min(1),
    op: z.enum(['GT', 'LT', 'EQ', 'LTE', 'GTE']),
    value: z.any(),
    label: z.string().optional(),
    errorMessage: z.string().optional(),
  }),
  // 旧版形态（type/companyId），保留以便存量数据重存不报错
  z.object({
    type: z.literal('FIELD_COMPARE'),
    companyId: z.string().min(1),
    fieldKey: z.string().min(1),
    op: z.enum(['>', '<', '>=', '<=', '==', '!=']),
    value: z.union([z.number(), z.string()]),
  }),
]);

// 产业类型判定
const IndustryIsConditionSchema = z.union([
  z.object({
    kind: z.literal('INDUSTRY_IS'),
    party: z.string().min(1),
    industryTypeKey: z.string().min(1),
    label: z.string().optional(),
    errorMessage: z.string().optional(),
  }),
  z.object({
    type: z.literal('INDUSTRY_IS'),
    companyId: z.string().min(1),
    industryTypeKey: z.string().min(1),
  }),
]);

// 两值/字典/列表比较（仅可视化编辑器，只有 kind 形态）
const FreeCompareConditionSchema = z.object({
  kind: z.enum(['VALUE_COMPARE', 'DICT_COMPARE', 'LIST_COMPARE']),
  op: z.string(),
  value1: z.any(),
  value2: z.any(),
  label: z.string().optional(),
  errorMessage: z.string().optional(),
});

const ConditionSchema = z.union([
  FieldCompareConditionSchema,
  IndustryIsConditionSchema,
  FreeCompareConditionSchema,
]);

const ConditionsSchema = z.array(ConditionSchema);

/**
 * 校验 conditions JSON 字符串
 * @example
 * ```json
 * [
 *   { "type": "FIELD_COMPARE", "companyId": "B", "fieldKey": "creditRating", "op": ">=", "value": 60 },
 *   { "type": "INDUSTRY_IS", "companyId": "B", "industryTypeKey": "BANK" }
 * ]
 * ```
 */
export function validateConditions(raw: string): ValidationResult<z.infer<typeof ConditionsSchema>> {
  return validateWithSchema(raw, ConditionsSchema);
}

// ========== graph 校验 ==========

const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  x: z.number().optional(),
  y: z.number().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});

const GraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  layout: z.record(z.string(), z.unknown()).optional(),
});

/**
 * 校验 graph JSON 字符串（图编辑器数据）
 */
export function validateGraph(raw: string): ValidationResult<z.infer<typeof GraphSchema>> {
  return validateWithSchema(raw, GraphSchema);
}

// ========== 统一校验入口 ==========

/**
 * ContractType JSON 字段校验器
 */
export const ContractTypeValidators = {
  partyRoles: validatePartyRoles,
  inputSchema: validateInputSchema,
  effects: validateEffects,
  conditions: validateConditions,
  graph: validateGraph,
};

/**
 * 校验 ContractType 的所有 JSON 字段
 * @returns 各字段校验结果，任一失败则 overall 为 false
 */
export function validateContractTypeJsonFields(fields: {
  partyRoles?: string;
  inputSchema?: string;
  effects?: string;
  conditions?: string;
  graph?: string;
}): { overall: boolean; results: Record<string, ValidationResult<unknown>> } {
  const results: Record<string, ValidationResult<unknown>> = {};
  let overall = true;

  if (fields.partyRoles !== undefined) {
    results.partyRoles = validatePartyRoles(fields.partyRoles);
    if (!results.partyRoles.success) overall = false;
  }
  if (fields.inputSchema !== undefined) {
    results.inputSchema = validateInputSchema(fields.inputSchema);
    if (!results.inputSchema.success) overall = false;
  }
  if (fields.effects !== undefined) {
    results.effects = validateEffects(fields.effects);
    if (!results.effects.success) overall = false;
  }
  if (fields.conditions !== undefined) {
    results.conditions = validateConditions(fields.conditions);
    if (!results.conditions.success) overall = false;
  }
  if (fields.graph !== undefined) {
    results.graph = validateGraph(fields.graph);
    if (!results.graph.success) overall = false;
  }

  return { overall, results };
}
