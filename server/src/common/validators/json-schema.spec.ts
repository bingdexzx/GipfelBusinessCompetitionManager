/**
 * json-schema.ts 单测
 *
 * 覆盖：
 * 1. validatePartyRoles
 * 2. validateInputSchema
 * 3. validateEffects
 * 4. validateConditions
 * 5. validateGraph
 * 6. validateContractTypeJsonFields
 */

import {
  validatePartyRoles,
  validateInputSchema,
  validateEffects,
  validateConditions,
  validateGraph,
  validateContractTypeJsonFields,
} from './json-schema';

describe('json-schema validators', () => {
  // ========== validatePartyRoles ==========
  describe('validatePartyRoles', () => {
    it('有效数据', () => {
      const input = JSON.stringify([
        { role: 'A', label: '放款方', selectable: true, isHost: false },
        { role: 'B', label: '借款方', selectable: true, isHost: true },
      ]);
      const result = validatePartyRoles(input);
      expect(result.success).toBe(true);
    });

    it('最少一个角色', () => {
      const result = validatePartyRoles('[]');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('至少需要一个');
    });

    it('role 不能为空', () => {
      const input = JSON.stringify([{ role: '', label: '测试' }]);
      const result = validatePartyRoles(input);
      expect(result.success).toBe(false);
    });

    it('label 不能为空', () => {
      const input = JSON.stringify([{ role: 'A', label: '' }]);
      const result = validatePartyRoles(input);
      expect(result.success).toBe(false);
    });

    it('默认值处理', () => {
      const input = JSON.stringify([{ role: 'A', label: '测试' }]);
      const result = validatePartyRoles(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].selectable).toBe(true);
        expect(result.data[0].isHost).toBe(false);
      }
    });

    it('非法 JSON', () => {
      expect(validatePartyRoles('invalid').success).toBe(false);
    });
  });

  // ========== validateInputSchema ==========
  describe('validateInputSchema', () => {
    it('有效数据', () => {
      const input = JSON.stringify([
        { key: 'amount', label: '金额', type: 'NUMBER', required: true, min: 0 },
        { key: 'name', label: '名称', type: 'STRING' },
        { key: 'active', label: '是否启用', type: 'BOOLEAN' },
      ]);
      const result = validateInputSchema(input);
      expect(result.success).toBe(true);
    });

    it('支持 SELECT 类型', () => {
      const input = JSON.stringify([
        {
          key: 'term',
          label: '期限',
          type: 'SELECT',
          enum: [
            { value: 1, label: '1年' },
            { value: 3, label: '3年' },
          ],
        },
      ]);
      const result = validateInputSchema(input);
      expect(result.success).toBe(true);
    });

    it('不支持的类型', () => {
      const input = JSON.stringify([{ key: 'x', label: 'X', type: 'INVALID' }]);
      const result = validateInputSchema(input);
      expect(result.success).toBe(false);
    });

    it('key 不能为空', () => {
      const input = JSON.stringify([{ key: '', label: 'X', type: 'STRING' }]);
      const result = validateInputSchema(input);
      expect(result.success).toBe(false);
    });

    it('空数组有效', () => {
      const result = validateInputSchema('[]');
      expect(result.success).toBe(true);
    });
  });

  // ========== validateEffects ==========
  describe('validateEffects', () => {
    it('FIELD 效果', () => {
      const input = JSON.stringify([
        { type: 'FIELD', companyId: 'B', fieldKey: 'cash', op: 'SUB', value: 1000 },
      ]);
      const result = validateEffects(input);
      expect(result.success).toBe(true);
    });

    it('支持 ADD/SUB/SET 操作', () => {
      const input = JSON.stringify([
        { type: 'FIELD', companyId: 'B', fieldKey: 'a', op: 'ADD', value: 100 },
        { type: 'FIELD', companyId: 'B', fieldKey: 'b', op: 'SUB', value: 50 },
        { type: 'FIELD', companyId: 'B', fieldKey: 'c', op: 'SET', value: 'active' },
      ]);
      const result = validateEffects(input);
      expect(result.success).toBe(true);
    });

    it('不支持的操作类型', () => {
      const input = JSON.stringify([
        { type: 'FIELD', companyId: 'B', fieldKey: 'x', op: 'MULTIPLY', value: 2 },
      ]);
      const result = validateEffects(input);
      expect(result.success).toBe(false);
    });

    it('ASSIGN 效果', () => {
      const input = JSON.stringify([
        { type: 'ASSIGN', variable: 'total', value: 100 },
      ]);
      const result = validateEffects(input);
      expect(result.success).toBe(true);
    });

    it('FOREACH 效果', () => {
      const input = JSON.stringify([
        {
          type: 'FOREACH',
          collection: 'companies',
          item: 'company',
          body: [
            { type: 'FIELD', companyId: 'company', fieldKey: 'tax', op: 'SUB', value: 100 },
          ],
        },
      ]);
      const result = validateEffects(input);
      expect(result.success).toBe(true);
    });

    it('IF 效果', () => {
      const input = JSON.stringify([
        {
          type: 'IF',
          condition: { type: 'FIELD_COMPARE', companyId: 'B', fieldKey: 'credit', op: '>=', value: 60 },
          then: [
            { type: 'FIELD', companyId: 'B', fieldKey: 'loan', op: 'ADD', value: 1000 },
          ],
          else: [],
        },
      ]);
      const result = validateEffects(input);
      expect(result.success).toBe(true);
    });

    it('无效的 type', () => {
      const input = JSON.stringify([{ type: 'INVALID' }]);
      const result = validateEffects(input);
      expect(result.success).toBe(false);
    });

    it('空数组有效', () => {
      const result = validateEffects('[]');
      expect(result.success).toBe(true);
    });
  });

  // ========== validateConditions ==========
  describe('validateConditions', () => {
    it('FIELD_COMPARE 条件', () => {
      const input = JSON.stringify([
        { type: 'FIELD_COMPARE', companyId: 'B', fieldKey: 'creditRating', op: '>=', value: 60 },
      ]);
      const result = validateConditions(input);
      expect(result.success).toBe(true);
    });

    it('INDUSTRY_IS 条件', () => {
      const input = JSON.stringify([
        { type: 'INDUSTRY_IS', companyId: 'B', industryTypeKey: 'BANK' },
      ]);
      const result = validateConditions(input);
      expect(result.success).toBe(true);
    });

    it('支持所有比较操作符', () => {
      const ops = ['>', '<', '>=', '<=', '==', '!='];
      for (const op of ops) {
        const input = JSON.stringify([
          { type: 'FIELD_COMPARE', companyId: 'B', fieldKey: 'x', op, value: 10 },
        ]);
        const result = validateConditions(input);
        expect(result.success).toBe(true);
      }
    });

    it('不支持的比较操作符', () => {
      const input = JSON.stringify([
        { type: 'FIELD_COMPARE', companyId: 'B', fieldKey: 'x', op: 'LIKE', value: 'test' },
      ]);
      const result = validateConditions(input);
      expect(result.success).toBe(false);
    });

    it('无效的条件类型', () => {
      const input = JSON.stringify([{ type: 'INVALID' }]);
      const result = validateConditions(input);
      expect(result.success).toBe(false);
    });

    it('空数组有效', () => {
      const result = validateConditions('[]');
      expect(result.success).toBe(true);
    });
  });

  // ========== validateGraph ==========
  describe('validateGraph', () => {
    it('有效图数据', () => {
      const input = JSON.stringify({
        nodes: [
          { id: 'n1', type: 'START', x: 0, y: 0 },
          { id: 'n2', type: 'END', x: 100, y: 100 },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
        ],
      });
      const result = validateGraph(input);
      expect(result.success).toBe(true);
    });

    it('空图有效', () => {
      const input = JSON.stringify({ nodes: [], edges: [] });
      const result = validateGraph(input);
      expect(result.success).toBe(true);
    });

    it('节点 id 不能为空', () => {
      const input = JSON.stringify({
        nodes: [{ id: '', type: 'X' }],
        edges: [],
      });
      const result = validateGraph(input);
      expect(result.success).toBe(false);
    });

    it('边的 source 不能为空', () => {
      const input = JSON.stringify({
        nodes: [{ id: 'n1', type: 'X' }],
        edges: [{ id: 'e1', source: '', target: 'n1' }],
      });
      const result = validateGraph(input);
      expect(result.success).toBe(false);
    });

    it('缺少 nodes 字段', () => {
      const result = validateGraph('{"edges": []}');
      expect(result.success).toBe(false);
    });
  });

  // ========== validateContractTypeJsonFields ==========
  describe('validateContractTypeJsonFields', () => {
    it('全部有效', () => {
      const result = validateContractTypeJsonFields({
        partyRoles: JSON.stringify([{ role: 'A', label: '甲' }]),
        inputSchema: JSON.stringify([]),
        effects: JSON.stringify([]),
        conditions: JSON.stringify([]),
      });
      expect(result.overall).toBe(true);
    });

    it('任一失败则 overall 为 false', () => {
      const result = validateContractTypeJsonFields({
        partyRoles: JSON.stringify([{ role: 'A', label: '甲' }]),
        effects: 'invalid-json',
      });
      expect(result.overall).toBe(false);
      expect(result.results.partyRoles?.success).toBe(true);
      expect(result.results.effects?.success).toBe(false);
    });

    it('只校验传入的字段', () => {
      const result = validateContractTypeJsonFields({
        partyRoles: JSON.stringify([{ role: 'A', label: '甲' }]),
      });
      expect(result.overall).toBe(true);
      expect(result.results.inputSchema).toBeUndefined();
    });

    it('空对象有效', () => {
      const result = validateContractTypeJsonFields({});
      expect(result.overall).toBe(true);
    });
  });
});
