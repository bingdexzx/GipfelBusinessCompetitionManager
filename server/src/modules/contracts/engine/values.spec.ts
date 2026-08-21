/**
 * contracts/engine/values.ts 纯函数单元测试
 *
 * 覆盖：toNumber, isTruthy, deepEqual, toNumberArray, castScalar,
 *       compareOp, condKindLabel, safeParse
 */

import {
  toNumber,
  isTruthy,
  deepEqual,
  toNumberArray,
  castScalar,
  compareOp,
  condKindLabel,
  safeParse,
} from './values';

describe('contracts/engine/values', () => {
  // ========== toNumber ==========
  describe('toNumber', () => {
    it('数字原样返回', () => {
      expect(toNumber(42)).toBe(42);
      expect(toNumber(0)).toBe(0);
      expect(toNumber(-3.14)).toBe(-3.14);
    });

    it('布尔值：true→1, false→0', () => {
      expect(toNumber(true)).toBe(1);
      expect(toNumber(false)).toBe(0);
    });

    it('null/undefined/空字符串→fallback(0)', () => {
      expect(toNumber(null)).toBe(0);
      expect(toNumber(undefined)).toBe(0);
      expect(toNumber('')).toBe(0);
    });

    it('数字字符串→数字', () => {
      expect(toNumber('123')).toBe(123);
      expect(toNumber('-5.5')).toBe(-5.5);
      expect(toNumber('0')).toBe(0);
    });

    it('NaN/Infinity：typeof 为 number，直接返回原值', () => {
      // toNumber 对 typeof === "number" 直接返回，不检查 isFinite
      expect(toNumber(NaN)).toBeNaN();
      expect(toNumber(Infinity)).toBe(Infinity);
      expect(toNumber(-Infinity)).toBe(-Infinity);
    });

    it('非数字字符串→fallback', () => {
      expect(toNumber('abc')).toBe(0);
      expect(toNumber('12a')).toBe(0);
    });

    it('自定义 fallback', () => {
      expect(toNumber(null, -1)).toBe(-1);
      expect(toNumber('abc', 99)).toBe(99);
    });
  });

  // ========== isTruthy ==========
  describe('isTruthy', () => {
    it('falsy 值', () => {
      expect(isTruthy(null)).toBe(false);
      expect(isTruthy(undefined)).toBe(false);
      expect(isTruthy(false)).toBe(false);
      expect(isTruthy(0)).toBe(false);
      expect(isTruthy('')).toBe(false);
      expect(isTruthy('  ')).toBe(false);
      expect(isTruthy([])).toBe(false);
      expect(isTruthy({})).toBe(false);
    });

    it('truthy 值', () => {
      expect(isTruthy(true)).toBe(true);
      expect(isTruthy(1)).toBe(true);
      expect(isTruthy(-1)).toBe(true);
      expect(isTruthy('hello')).toBe(true);
      expect(isTruthy(' a ')).toBe(true);
      expect(isTruthy([1])).toBe(true);
      expect(isTruthy({ a: 1 })).toBe(true);
    });
  });

  // ========== deepEqual ==========
  describe('deepEqual', () => {
    it('相同引用', () => {
      const obj = { a: 1 };
      expect(deepEqual(obj, obj)).toBe(true);
    });

    it('基本类型相等', () => {
      expect(deepEqual(1, 1)).toBe(true);
      expect(deepEqual('a', 'a')).toBe(true);
      expect(deepEqual(true, true)).toBe(true);
    });

    it('基本类型不等', () => {
      expect(deepEqual(1, 2)).toBe(false);
      expect(deepEqual('a', 'b')).toBe(false);
      expect(deepEqual(true, false)).toBe(false);
    });

    it('null/undefined', () => {
      expect(deepEqual(null, null)).toBe(true);
      expect(deepEqual(undefined, undefined)).toBe(true);
      expect(deepEqual(null, undefined)).toBe(false);
    });

    it('不同类型', () => {
      expect(deepEqual(1, '1')).toBe(false);
      expect(deepEqual(0, false)).toBe(false);
      // 注意：[] 和 {} 在 deepEqual 实现中 keys 数相同（均为 0），结果为 true
      // 这是实现的已知行为（不做 Array/Object 区分）
      expect(deepEqual([], {})).toBe(true);
    });

    it('数组相等', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
      expect(deepEqual([1, 3], [1, 2])).toBe(false);
    });

    it('对象相等', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
      expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });

    it('嵌套结构', () => {
      expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
      expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    });
  });

  // ========== toNumberArray ==========
  describe('toNumberArray', () => {
    it('数字数组', () => {
      expect(toNumberArray([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('混合数组（过滤非有限值）', () => {
      expect(toNumberArray([1, NaN, 3, Infinity])).toEqual([1, 3]);
    });

    it('JSON 字符串数组', () => {
      expect(toNumberArray('[10, 20, 30]')).toEqual([10, 20, 30]);
    });

    it('逗号分隔字符串', () => {
      expect(toNumberArray('1, 2, 3')).toEqual([1, 2, 3]);
    });

    it('空字符串→空数组', () => {
      expect(toNumberArray('')).toEqual([]);
      expect(toNumberArray('  ')).toEqual([]);
    });

    it('null/undefined/非数组→空数组', () => {
      expect(toNumberArray(null)).toEqual([]);
      expect(toNumberArray(undefined)).toEqual([]);
      expect(toNumberArray(42)).toEqual([]);
    });

    it('字符串数组（数字字符串）', () => {
      expect(toNumberArray(['5', '10', '15'])).toEqual([5, 10, 15]);
    });
  });

  // ========== castScalar ==========
  describe('castScalar', () => {
    it('NUMBER 类型：转数字', () => {
      expect(castScalar('NUMBER', '42')).toBe(42);
      expect(castScalar('NUMBER', true)).toBe(1);
      expect(castScalar('NUMBER', null)).toBe(0);
      expect(castScalar('NUMBER', 'abc')).toBe(0);
    });

    it('BOOLEAN 类型：转布尔', () => {
      expect(castScalar('BOOLEAN', true)).toBe(true);
      expect(castScalar('BOOLEAN', 'true')).toBe(true);
      expect(castScalar('BOOLEAN', 1)).toBe(true);
      expect(castScalar('BOOLEAN', '1')).toBe(true);
      expect(castScalar('BOOLEAN', '是')).toBe(true);
      expect(castScalar('BOOLEAN', false)).toBe(false);
      expect(castScalar('BOOLEAN', 'false')).toBe(false);
      expect(castScalar('BOOLEAN', 0)).toBe(false);
    });

    it('STRING 类型（默认）：转字符串', () => {
      expect(castScalar('STRING', 42)).toBe('42');
      expect(castScalar('STRING', true)).toBe('true');
      expect(castScalar('STRING', null)).toBe('');
      expect(castScalar('STRING', 'hello')).toBe('hello');
    });

    it('对象→JSON 字符串', () => {
      expect(castScalar('STRING', { a: 1 })).toBe('{"a":1}');
    });

    it('undefined type 默认 STRING', () => {
      expect(castScalar(undefined, 42)).toBe('42');
    });
  });

  // ========== compareOp ==========
  describe('compareOp', () => {
    it('GTE', () => {
      expect(compareOp(10, 'GTE', 5)).toBe(true);
      expect(compareOp(5, 'GTE', 5)).toBe(true);
      expect(compareOp(4, 'GTE', 5)).toBe(false);
    });

    it('LTE', () => {
      expect(compareOp(4, 'LTE', 5)).toBe(true);
      expect(compareOp(5, 'LTE', 5)).toBe(true);
      expect(compareOp(6, 'LTE', 5)).toBe(false);
    });

    it('GT', () => {
      expect(compareOp(10, 'GT', 5)).toBe(true);
      expect(compareOp(5, 'GT', 5)).toBe(false);
    });

    it('LT', () => {
      expect(compareOp(4, 'LT', 5)).toBe(true);
      expect(compareOp(5, 'LT', 5)).toBe(false);
    });

    it('EQ', () => {
      expect(compareOp(5, 'EQ', 5)).toBe(true);
      expect(compareOp(4, 'EQ', 5)).toBe(false);
    });
  });

  // ========== condKindLabel ==========
  describe('condKindLabel', () => {
    it('已知类型返回中文标签', () => {
      expect(condKindLabel('VALUE_COMPARE')).toBe('数值比较');
      expect(condKindLabel('FIELD_COMPARE')).toBe('字段比较');
      expect(condKindLabel('INDUSTRY_IS')).toBe('产业类型核对');
    });

    it('未知类型返回原字符串', () => {
      expect(condKindLabel('UNKNOWN_KIND')).toBe('UNKNOWN_KIND');
    });
  });

  // ========== safeParse ==========
  describe('safeParse', () => {
    it('有效 JSON', () => {
      expect(safeParse('{"a":1}', 'test')).toEqual({ a: 1 });
      expect(safeParse('[1,2,3]', 'test')).toEqual([1, 2, 3]);
    });

    it('无效 JSON 抛出错误', () => {
      expect(() => safeParse('not json', 'myLabel')).toThrow('myLabel 不是有效的 JSON');
    });
  });
});
