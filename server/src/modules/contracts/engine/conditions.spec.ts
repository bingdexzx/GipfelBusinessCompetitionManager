/**
 * contracts/engine/conditions.ts 纯函数单元测试
 *
 * 覆盖：condKindLabel, createCheckResult, createSkippedCheckResult,
 *       createPassedCheckResult, createFailedCheckResult, getCheckErrorMessage
 */

import {
  condKindLabel,
  createCheckResult,
  createSkippedCheckResult,
  createPassedCheckResult,
  createFailedCheckResult,
  getCheckErrorMessage,
} from './conditions';

describe('contracts/engine/conditions', () => {
  // ========== condKindLabel ==========
  describe('condKindLabel', () => {
    it('FIELD_COMPARE → 字段比较', () => {
      expect(condKindLabel('FIELD_COMPARE')).toBe('字段比较');
    });

    it('VALUE_COMPARE → 数值比较', () => {
      expect(condKindLabel('VALUE_COMPARE')).toBe('数值比较');
    });

    it('INDUSTRY_IS → 产业类型核对', () => {
      expect(condKindLabel('INDUSTRY_IS')).toBe('产业类型核对');
    });

    it('DICT_COMPARE → 字典比较', () => {
      expect(condKindLabel('DICT_COMPARE')).toBe('字典比较');
    });

    it('LIST_COMPARE → 列表比较', () => {
      expect(condKindLabel('LIST_COMPARE')).toBe('列表比较');
    });

    it('未知 kind 返回原字符串', () => {
      expect(condKindLabel('UNKNOWN')).toBe('UNKNOWN');
    });
  });

  // ========== createCheckResult ==========
  describe('createCheckResult', () => {
    it('基本字段', () => {
      const r = createCheckResult('FIELD_COMPARE', 'buyer', true, '通过');
      expect(r.kind).toBe('FIELD_COMPARE');
      expect(r.party).toBe('buyer');
      expect(r.passed).toBe(true);
      expect(r.detail).toBe('通过');
    });

    it('带可选字段', () => {
      const r = createCheckResult('VALUE_COMPARE', 'seller', false, '未通过', {
        label: '测试',
        actual: 10,
        expected: 20,
        customError: true,
      });
      expect(r.label).toBe('测试');
      expect(r.actual).toBe(10);
      expect(r.expected).toBe(20);
      expect(r.customError).toBe(true);
    });
  });

  // ========== createSkippedCheckResult ==========
  describe('createSkippedCheckResult', () => {
    it('跳过结果默认通过', () => {
      const r = createSkippedCheckResult('FIELD_COMPARE', 'buyer', '标签');
      expect(r.kind).toBe('FIELD_COMPARE');
      expect(r.party).toBe('buyer');
      expect(r.passed).toBe(true);
      expect(r.skipped).toBe(true);
      expect(r.label).toBe('标签');
      expect(r.detail).toContain('跳过');
    });

    it('无 label', () => {
      const r = createSkippedCheckResult('VALUE_COMPARE', 'seller');
      expect(r.label).toBeUndefined();
    });
  });

  // ========== createPassedCheckResult ==========
  describe('createPassedCheckResult', () => {
    it('通过结果', () => {
      const r = createPassedCheckResult('FIELD_COMPARE', 'buyer', '字段≥10', {
        label: '资金检查',
        actual: 100,
        expected: 10,
      });
      expect(r.passed).toBe(true);
      expect(r.kind).toBe('FIELD_COMPARE');
      expect(r.label).toBe('资金检查');
      expect(r.actual).toBe(100);
    });
  });

  // ========== createFailedCheckResult ==========
  describe('createFailedCheckResult', () => {
    it('失败结果', () => {
      const r = createFailedCheckResult('FIELD_COMPARE', 'buyer', '资金不足', {
        label: '资金检查',
        actual: 5,
        expected: 10,
      });
      expect(r.passed).toBe(false);
      expect(r.customError).toBe(false);
    });

    it('带自定义错误消息', () => {
      const r = createFailedCheckResult('VALUE_COMPARE', 'seller', '自定义错误', {
        errorMessage: '请补充资金',
      });
      expect(r.passed).toBe(false);
      expect(r.customError).toBe(true);
    });
  });

  // ========== getCheckErrorMessage ==========
  describe('getCheckErrorMessage', () => {
    it('通过结果返回空字符串', () => {
      const r = createPassedCheckResult('FIELD_COMPARE', 'buyer', 'ok');
      expect(getCheckErrorMessage(r)).toBe('');
    });

    it('失败结果返回格式化错误', () => {
      const r = createFailedCheckResult('FIELD_COMPARE', 'buyer', '资金不足', {
        label: '资金检查',
      });
      const msg = getCheckErrorMessage(r);
      expect(msg).toContain('字段比较');
      expect(msg).toContain('资金检查');
      expect(msg).toContain('资金不足');
    });

    it('customError 时直接返回 detail', () => {
      const r = createFailedCheckResult('VALUE_COMPARE', '', '自定义消息', {
        errorMessage: 'custom',
      });
      expect(getCheckErrorMessage(r)).toBe('自定义消息');
    });

    it('无 label 的错误消息', () => {
      const r = createFailedCheckResult('INDUSTRY_IS', 'buyer', '产业不符');
      const msg = getCheckErrorMessage(r);
      expect(msg).toContain('产业类型核对');
      expect(msg).toContain('产业不符');
    });
  });
});
