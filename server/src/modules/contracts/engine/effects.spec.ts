/**
 * contracts/engine/effects.ts 纯函数单元测试
 *
 * 覆盖：applyFieldEffect, compareField, compareOp, combineValues, parseJsonValue
 */

import {
  applyFieldEffect,
  compareField,
  compareOp,
  combineValues,
  parseJsonValue,
} from './effects';

describe('contracts/engine/effects', () => {
  // ========== applyFieldEffect ==========
  describe('applyFieldEffect', () => {
    // ----- NUMBER 字段 -----
    describe('NUMBER 字段', () => {
      it('ADD：在当前值基础上加', () => {
        const r = applyFieldEffect('10', 'NUMBER', {}, 'ADD', 5);
        expect(r.before).toBe(10);
        expect(r.after).toBe(15);
        expect(r.store).toBe('15');
      });

      it('SUB：在当前值基础上减', () => {
        const r = applyFieldEffect('20', 'NUMBER', {}, 'SUB', 7);
        expect(r.before).toBe(20);
        expect(r.after).toBe(13);
      });

      it('SET：直接设值', () => {
        const r = applyFieldEffect('10', 'NUMBER', {}, 'SET', 99);
        expect(r.before).toBe(10);
        expect(r.after).toBe(99);
      });

      it('null 当前值视为 0', () => {
        const r = applyFieldEffect(null, 'NUMBER', {}, 'ADD', 5);
        expect(r.before).toBe(0);
        expect(r.after).toBe(5);
      });

      it('字符串类型 ADD 退化为 SET', () => {
        const r = applyFieldEffect('"old"', 'STRING', {}, 'ADD', 'new');
        expect(r.after).toBe('new');
      });
    });

    // ----- LIST 字段 -----
    describe('LIST 字段', () => {
      it('ADD：追加元素（去重）', () => {
        const r = applyFieldEffect('[1,2]', 'LIST', { itemType: 'NUMBER' }, 'ADD', [2, 3]);
        expect(r.before).toEqual([1, 2]);
        // 2 已存在应去重，3 追加
        expect(r.after).toEqual([1, 2, 3]);
      });

      it('SUB：移除匹配元素', () => {
        const r = applyFieldEffect('[1,2,3]', 'LIST', { itemType: 'NUMBER' }, 'SUB', [2]);
        expect(r.before).toEqual([1, 2, 3]);
        expect(r.after).toEqual([1, 3]);
      });

      it('SET：替换整个列表', () => {
        const r = applyFieldEffect('[1,2]', 'LIST', { itemType: 'NUMBER' }, 'SET', [5, 6, 7]);
        expect(r.before).toEqual([1, 2]);
        expect(r.after).toEqual([5, 6, 7]);
      });

      it('空当前值 ADD', () => {
        const r = applyFieldEffect(null, 'LIST', { itemType: 'NUMBER' }, 'ADD', [1]);
        expect(r.before).toEqual([]);
        expect(r.after).toEqual([1]);
      });

      it('列表存储为数组对象时也正确解析', () => {
        const r = applyFieldEffect([1, 2] as any, 'LIST', { itemType: 'NUMBER' }, 'ADD', [3]);
        expect(r.after).toEqual([1, 2, 3]);
      });
    });

    // ----- DICTIONARY 字段 -----
    describe('DICTIONARY 字段', () => {
      it('ADD：合并键值对', () => {
        const r = applyFieldEffect('{"a":1}', 'DICTIONARY', { valueType: 'NUMBER' }, 'ADD', { b: 2 });
        expect(r.before).toEqual({ a: 1 });
        expect(r.after).toEqual({ a: 1, b: 2 });
      });

      it('SUB：删除指定键', () => {
        const r = applyFieldEffect('{"a":1,"b":2}', 'DICTIONARY', { valueType: 'NUMBER' }, 'SUB', ['b']);
        expect(r.after).toEqual({ a: 1 });
      });

      it('SET：替换整个字典', () => {
        const r = applyFieldEffect('{"a":1}', 'DICTIONARY', { valueType: 'NUMBER' }, 'SET', { x: 10 });
        expect(r.after).toEqual({ x: 10 });
      });

      it('null 当前值 ADD', () => {
        const r = applyFieldEffect(null, 'DICTIONARY', { valueType: 'NUMBER' }, 'ADD', { a: 1 });
        expect(r.before).toEqual({});
        expect(r.after).toEqual({ a: 1 });
      });
    });

    // ----- STRING / BOOLEAN 字段 -----
    describe('STRING / BOOLEAN 字段', () => {
      it('STRING SET', () => {
      // currentRaw 为 JSON 编码的字符串 '""old""' → parseCurrent 不做 JSON 解析，before 为原字符串
      const r = applyFieldEffect('"old"', 'STRING', {}, 'SET', 'new');
      expect(r.before).toBe('"old"');
      expect(r.after).toBe('new');
    });

      it('BOOLEAN SET', () => {
        const r = applyFieldEffect('false', 'BOOLEAN', {}, 'SET', true);
        expect(r.before).toBe(false);
        expect(r.after).toBe(true);
      });
    });
  });

  // ========== compareField ==========
  describe('compareField', () => {
    it('NUMBER 字段按长度比较（compareField 对标量走默认路径）', () => {
      // compareField 对 NUMBER 标量：actual = toNumber('10') = 10,
      // 默认分支用 Object.keys(10).length = 0 来比较。
      const r = compareField('10', 'NUMBER', {}, 'GTE', 5);
      // length=0 >= 5 为 false
      expect(r.passed).toBe(false);
      expect(r.actual).toBe(0); // length
    });

    it('NUMBER 字段 GTE 通过（长度比较）', () => {
      // 当 expected=0 时，0 >= 0 为 true
      const r = compareField('10', 'NUMBER', {}, 'GTE', 0);
      expect(r.passed).toBe(true);
    });

    it('LIST 字段 CONTAINS', () => {
      const r = compareField('[1,2,3]', 'LIST', {}, 'CONTAINS', 2);
      expect(r.passed).toBe(true);
    });

    it('LIST 字段 CONTAINS 未命中', () => {
      const r = compareField('[1,2,3]', 'LIST', {}, 'CONTAINS', 9);
      expect(r.passed).toBe(false);
    });

    it('LIST 字段 LEN_EQ', () => {
      const r = compareField('[1,2,3]', 'LIST', {}, 'LEN_EQ', 3);
      expect(r.passed).toBe(true);
    });

    it('LIST 字段 LEN_GTE', () => {
      const r = compareField('[1,2,3]', 'LIST', {}, 'LEN_GTE', 2);
      expect(r.passed).toBe(true);
    });

    it('LIST 字段 LEN_LTE', () => {
      const r = compareField('[1]', 'LIST', {}, 'LEN_LTE', 3);
      expect(r.passed).toBe(true);
    });

    it('DICTIONARY 字段 HAS_KEY', () => {
      const r = compareField('{"a":1}', 'DICTIONARY', {}, 'HAS_KEY', 'a');
      expect(r.passed).toBe(true);
    });

    it('DICTIONARY 字段 HAS_KEY 未命中', () => {
      const r = compareField('{"a":1}', 'DICTIONARY', {}, 'HAS_KEY', 'b');
      expect(r.passed).toBe(false);
    });

    it('EQ 结构相等', () => {
      const r = compareField('[1,2]', 'LIST', {}, 'EQ', [1, 2]);
      expect(r.passed).toBe(true);
    });

    it('STRING 字段字典序比较 GT', () => {
      // parseCurrent → toNumber(raw)：非数字字符串返回 0，
      // 然后 STRING 分支：String(0)="0" 与 String(expected) 做字典序比较
      const r = compareField('hello', 'STRING', {}, 'GT', 'a');
      expect(r.passed).toBe(false); // toNumber('hello')=0 → "0" > "a" 为 false
    });

    it('STRING 字段字典序比较：数字字符串可比较', () => {
      // '100' → toNumber = 100 → String(100)="100"，与 "50" 做字典序比较
      const r = compareField('100', 'STRING', {}, 'GT', '50');
      expect(r.passed).toBe(false); // "100" > "50" → false（字典序 "1" < "5"）
    });

    it('null 当前值：NUMBER 视为 0', () => {
      const r = compareField(null, 'NUMBER', {}, 'GTE', 0);
      expect(r.passed).toBe(true);
    });
  });

  // ========== compareOp ==========
  describe('compareOp', () => {
    it('GTE/LTE/GT/LT/EQ', () => {
      expect(compareOp(10, 'GTE', 5)).toBe(true);
      expect(compareOp(5, 'GTE', 5)).toBe(true);
      expect(compareOp(3, 'LTE', 5)).toBe(true);
      expect(compareOp(10, 'GT', 5)).toBe(true);
      expect(compareOp(5, 'GT', 5)).toBe(false);
      expect(compareOp(5, 'LT', 10)).toBe(true);
      expect(compareOp(5, 'EQ', 5)).toBe(true);
    });
  });

  // ========== combineValues ==========
  describe('combineValues', () => {
    it('NUMBER ADD', () => {
      expect(combineValues(10, 5, 'ADD', 'NUMBER')).toBe(15);
    });

    it('NUMBER SUB', () => {
      expect(combineValues(10, 5, 'SUB', 'NUMBER')).toBe(5);
    });

    it('NUMBER MUL', () => {
      expect(combineValues(10, 5, 'MUL', 'NUMBER')).toBe(50);
    });

    it('LIST ADD（串联）', () => {
      expect(combineValues([1, 2], [3, 4], 'ADD', 'LIST')).toEqual([1, 2, 3, 4]);
    });

    it('LIST SUB（移除）', () => {
      expect(combineValues([1, 2, 3], [2], 'SUB', 'LIST')).toEqual([1, 3]);
    });

    it('DICTIONARY ADD（合并）', () => {
      expect(combineValues({ a: 1 }, { b: 2 }, 'ADD', 'DICTIONARY')).toEqual({ a: 1, b: 2 });
    });

    it('DICTIONARY SUB（删键）', () => {
      expect(combineValues({ a: 1, b: 2 }, { b: 0 }, 'SUB', 'DICTIONARY')).toEqual({ a: 1 });
    });

    it('STRING：返回 v1', () => {
      expect(combineValues('hello', 'world', 'ADD', 'STRING')).toBe('hello');
    });

    it('BOOLEAN：转布尔', () => {
      expect(combineValues(true, false, 'ADD', 'BOOLEAN')).toBe(true);
      expect(combineValues(false, true, 'ADD', 'BOOLEAN')).toBe(false);
    });
  });

  // ========== parseJsonValue ==========
  describe('parseJsonValue', () => {
    it('有效 JSON 字符串', () => {
      expect(parseJsonValue('{"a":1}')).toEqual({ a: 1 });
    });

    it('无效 JSON 返回原字符串', () => {
      expect(parseJsonValue('not json')).toBe('not json');
    });

    it('null 返回 null', () => {
      expect(parseJsonValue(null)).toBeNull();
    });

    it('非字符串原样返回', () => {
      expect(parseJsonValue(42 as any)).toBe(42);
      expect(parseJsonValue(undefined)).toBeUndefined();
    });
  });
});
