/**
 * JSON Schema 定义
 *
 * 用于校验合同类型和产业字段的 JSON 配置。
 * 前端和服务端共用此 schema，确保配置一致性。
 */

/** 值规格 JSON Schema */
export const ValueSpecSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: [
        "ENTITY",
        "INPUT",
        "CONST",
        "FORMULA",
        "OP",
        "VAR",
        "ROUTE",
        "FIELD",
        "INDUSTRY_IS",
      ],
    },
    // ENTITY
    entityType: { type: "string" },
    entityRef: { type: "string" },
    attribute: { type: "string" },
    multiplyByInput: { type: "string" },
    // INPUT
    key: { type: "string" },
    // CONST
    value: {},
    // FORMULA
    expr: { type: "string" },
    // OP
    op: { type: "string" },
    args: { type: "array", items: { $ref: "#" } },
    // VAR
    name: { type: "string" },
    // ROUTE
    routeRef: { type: "string" },
    nodeIds: { type: "array", items: { type: "number" } },
    // FIELD
    party: { type: "string" },
    fieldKey: { type: "string" },
    // INDUSTRY_IS
    industryTypeId: { type: "number" },
    // 聚合端点
    aggregate: { type: "string" },
    // 路径类型过滤
    pathTypeIds: { type: "array", items: { type: "number" } },
  },
  required: ["type"],
};

/** 效果 JSON Schema */
export const EffectSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "FIELD" },
        party: { type: "string" },
        fieldKey: { type: "string" },
        op: { type: "string", enum: ["ADD", "SUB", "SET"] },
        value: { $ref: "ValueSpecSchema" },
      },
      required: ["kind", "party", "fieldKey", "op", "value"],
    },
    {
      type: "object",
      properties: {
        kind: { const: "IF" },
        cond: { $ref: "ValueSpecSchema" },
        then: { type: "array", items: { $ref: "#" } },
        else: { type: "array", items: { $ref: "#" } },
      },
      required: ["kind", "cond", "then"],
    },
    {
      type: "object",
      properties: {
        kind: { const: "FOREACH" },
        items: { $ref: "ValueSpecSchema" },
        var: { type: "string" },
        body: { type: "array", items: { $ref: "#" } },
      },
      required: ["kind", "items", "var", "body"],
    },
    {
      type: "object",
      properties: {
        kind: { const: "ASSIGN" },
        name: { type: "string" },
        value: { $ref: "ValueSpecSchema" },
      },
      required: ["kind", "name", "value"],
    },
  ],
};

/** 条件检查 JSON Schema */
export const ConditionSpecSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    errorMessage: { type: "string" },
    kind: {
      type: "string",
      enum: ["FIELD_COMPARE", "VALUE_COMPARE", "INDUSTRY_IS", "DICT_COMPARE", "LIST_COMPARE"],
    },
    party: { type: "string" },
    fieldKey: { type: "string" },
    industryTypeId: { type: "number" },
    op: {
      type: "string",
      enum: ["GTE", "LTE", "GT", "LT", "EQ", "CONTAINS", "HAS_KEY", "LEN_GTE", "LEN_LTE", "LEN_EQ", "ELEMENT_EQ"],
    },
    value: { $ref: "ValueSpecSchema" },
    value1: { $ref: "ValueSpecSchema" },
    value2: { $ref: "ValueSpecSchema" },
    branch: {
      type: "object",
      properties: {
        when: { type: "string", enum: ["then", "else"] },
        cond: { $ref: "ValueSpecSchema" },
      },
      required: ["when", "cond"],
    },
  },
  required: ["kind"],
};

/** 参与方角色 JSON Schema */
export const PartyRoleSchema = {
  type: "object",
  properties: {
    role: { type: "string", minLength: 1 },
    label: { type: "string", minLength: 1 },
    selectable: { type: "boolean", default: true },
    isHost: { type: "boolean", default: false },
  },
  required: ["role", "label"],
};

/** 输入参数 JSON Schema */
export const InputFieldSchema = {
  type: "object",
  properties: {
    key: { type: "string", minLength: 1 },
    label: { type: "string", minLength: 1 },
    type: {
      type: "string",
      enum: ["NUMBER", "STRING", "BOOLEAN", "SELECT", "MULTI_SELECT", "COMPANY_REF"],
    },
    required: { type: "boolean", default: false },
    default: {},
    enum: {
      type: "array",
      items: {
        type: "object",
        properties: {
          value: { oneOf: [{ type: "string" }, { type: "number" }] },
          label: { type: "string" },
        },
        required: ["value", "label"],
      },
    },
    min: { type: "number" },
    max: { type: "number" },
  },
  required: ["key", "label", "type"],
};

/** 图编辑器数据 JSON Schema */
export const GraphSchema = {
  type: "object",
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          type: { type: "string", minLength: 1 },
          x: { type: "number" },
          y: { type: "number" },
          data: { type: "object" },
        },
        required: ["id", "type"],
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          source: { type: "string", minLength: 1 },
          target: { type: "string", minLength: 1 },
          sourceHandle: { type: "string" },
          targetHandle: { type: "string" },
        },
        required: ["id", "source", "target"],
      },
    },
    layout: { type: "object" },
  },
  required: ["nodes", "edges"],
};

/** ContractType 完整 JSON Schema */
export const ContractTypeSchema = {
  type: "object",
  properties: {
    partyRoles: {
      type: "array",
      items: PartyRoleSchema,
      minItems: 1,
    },
    inputSchema: {
      type: "array",
      items: InputFieldSchema,
    },
    effects: {
      type: "array",
      items: EffectSchema,
    },
    conditions: {
      type: "array",
      items: ConditionSpecSchema,
    },
    graph: GraphSchema,
  },
};
