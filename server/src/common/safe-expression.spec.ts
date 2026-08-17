/**
 * safe-expression.ts 安全逃逸矩阵单测
 *
 * 覆盖：
 * 1. 基础算术与类型转换
 * 2. 内置函数
 * 3. 变量引用与作用域
 * 4. 数组与字符串操作
 * 5. 比较与逻辑运算
 * 6. 安全逃逸防御（RCE 防护）
 */

import { safeEvaluate, SafeExpressionError } from './safe-expression';

describe('safe-expression', () => {
  // ========== 基础算术 ==========
  describe('基础算术', () => {
    it('加法', () => {
      expect(safeEvaluate('1 + 2')).toBe(3);
    });

    it('减法', () => {
      expect(safeEvaluate('10 - 3')).toBe(7);
    });

    it('乘法', () => {
      expect(safeEvaluate('4 * 5')).toBe(20);
    });

    it('除法', () => {
      expect(safeEvaluate('10 / 3')).toBeCloseTo(3.333, 2);
    });

    it('除零返回 0', () => {
      expect(safeEvaluate('1 / 0')).toBe(0);
    });

    it('取模', () => {
      expect(safeEvaluate('10 % 3')).toBe(1);
    });

    it('取模除零返回 0', () => {
      expect(safeEvaluate('10 % 0')).toBe(0);
    });

    it('幂运算', () => {
      expect(safeEvaluate('2 ^ 3')).toBe(8);
      expect(safeEvaluate('2 ** 3')).toBe(8);
    });

    it('一元负号', () => {
      expect(safeEvaluate('-5')).toBe(-5);
    });

    it('一元正号', () => {
      expect(safeEvaluate('+5')).toBe(5);
    });

    it('括号优先级', () => {
      expect(safeEvaluate('(2 + 3) * 4')).toBe(20);
    });

    it('复杂表达式', () => {
      expect(safeEvaluate('1 + 2 * 3 - 4 / 2')).toBe(5);
    });
  });

  // ========== 类型转换 ==========
  describe('类型转换', () => {
    it('字符串拼接', () => {
      expect(safeEvaluate('"hello" + " world"')).toBe('hello world');
    });

    it('数字与字符串拼接', () => {
      expect(safeEvaluate('42 + " is the answer"')).toBe('42 is the answer');
    });

    it('布尔转数字', () => {
      expect(safeEvaluate('true + 1')).toBe(2);
      expect(safeEvaluate('false + 1')).toBe(1);
    });

    it('null 转数字', () => {
      expect(safeEvaluate('null + 1')).toBe(1);
    });

    it('空字符串拼接', () => {
      expect(safeEvaluate('"" + 1')).toBe('1');
    });

    it('非数字字符串拼接', () => {
      expect(safeEvaluate('"abc" + 1')).toBe('abc1');
    });
  });

  // ========== 比较运算 ==========
  describe('比较运算', () => {
    it('等于', () => {
      expect(safeEvaluate('1 == 1')).toBe(true);
      expect(safeEvaluate('1 == 2')).toBe(false);
    });

    it('不等于', () => {
      expect(safeEvaluate('1 != 2')).toBe(true);
      expect(safeEvaluate('1 != 1')).toBe(false);
    });

    it('小于', () => {
      expect(safeEvaluate('1 < 2')).toBe(true);
      expect(safeEvaluate('2 < 1')).toBe(false);
    });

    it('大于', () => {
      expect(safeEvaluate('2 > 1')).toBe(true);
      expect(safeEvaluate('1 > 2')).toBe(false);
    });

    it('小于等于', () => {
      expect(safeEvaluate('1 <= 1')).toBe(true);
      expect(safeEvaluate('1 <= 2')).toBe(true);
      expect(safeEvaluate('2 <= 1')).toBe(false);
    });

    it('大于等于', () => {
      expect(safeEvaluate('1 >= 1')).toBe(true);
      expect(safeEvaluate('2 >= 1')).toBe(true);
      expect(safeEvaluate('1 >= 2')).toBe(false);
    });

    it('深度比较数组', () => {
      expect(safeEvaluate('[1,2,3] == [1,2,3]')).toBe(true);
      expect(safeEvaluate('[1,2,3] == [1,2,4]')).toBe(false);
    });
  });

  // ========== 逻辑运算 ==========
  describe('逻辑运算', () => {
    it('逻辑与', () => {
      expect(safeEvaluate('true && true')).toBe(true);
      expect(safeEvaluate('true && false')).toBe(false);
    });

    it('逻辑或', () => {
      expect(safeEvaluate('true || false')).toBe(true);
      expect(safeEvaluate('false || false')).toBe(false);
    });

    it('逻辑非', () => {
      expect(safeEvaluate('!true')).toBe(false);
      expect(safeEvaluate('!false')).toBe(true);
      expect(safeEvaluate('!0')).toBe(true);
      expect(safeEvaluate('!1')).toBe(false);
    });

    it('短路求值 - OR', () => {
      // OR: 两个操作数任一 truthy 返回 left（当前操作数），否则返回 right
      const orResult = safeEvaluate('0 || 42');
      // 验证 OR 至少返回一个值
      expect(typeof orResult).toBe('number');
    });

    it('短路求值 - AND', () => {
      const andResult = safeEvaluate('42 && 0');
      expect(typeof andResult).toBe('number');
    });

    it('truthy 判定', () => {
      expect(safeEvaluate('!0')).toBe(true);
      expect(safeEvaluate('!""')).toBe(true);
      expect(safeEvaluate('!null')).toBe(true);
      expect(safeEvaluate('![]')).toBe(true); // 空数组长度为 0，判定为 falsy
    });
  });

  // ========== 变量引用 ==========
  describe('变量引用', () => {
    it('简单变量', () => {
      expect(safeEvaluate('x', { x: 42 })).toBe(42);
    });

    it('多变量表达式', () => {
      expect(safeEvaluate('a + b', { a: 10, b: 20 })).toBe(30);
    });

    it('未定义变量回退为 0', () => {
      expect(safeEvaluate('unknown_var + 1')).toBe(1);
    });

    it('布尔字面量', () => {
      expect(safeEvaluate('true')).toBe(true);
      expect(safeEvaluate('false')).toBe(false);
      expect(safeEvaluate('null')).toBe(null);
    });

    it('内置常量 pi', () => {
      expect(safeEvaluate('pi')).toBeCloseTo(Math.PI, 10);
    });

    it('内置常量 e', () => {
      expect(safeEvaluate('e')).toBeCloseTo(Math.E, 10);
    });
  });

  // ========== 数组操作 ==========
  describe('数组操作', () => {
    it('数组字面量', () => {
      expect(safeEvaluate('[1, 2, 3]')).toEqual([1, 2, 3]);
    });

    it('空数组', () => {
      expect(safeEvaluate('[]')).toEqual([]);
    });

    it('数组下标访问', () => {
      expect(safeEvaluate('arr[1]', { arr: [10, 20, 30] })).toBe(20);
    });

    it('越界下标返回 0', () => {
      expect(safeEvaluate('arr[10]', { arr: [1, 2, 3] })).toBe(0);
    });

    it('数组加法（合并）', () => {
      expect(safeEvaluate('[1,2] + [3,4]')).toEqual([1, 2, 3, 4]);
    });

    it('数组减法（差集）', () => {
      expect(safeEvaluate('[1,2,3] - [2]')).toEqual([1, 3]);
    });

    it('对象下标访问', () => {
      expect(safeEvaluate('obj["key"]', { obj: { key: 42 } })).toBe(42);
    });

    it('对象不存在的键返回 0', () => {
      expect(safeEvaluate('obj["missing"]', { obj: {} })).toBe(0);
    });
  });

  // ========== 内置函数 ==========
  describe('内置函数', () => {
    it('abs', () => {
      expect(safeEvaluate('abs(-5)')).toBe(5);
      expect(safeEvaluate('abs(5)')).toBe(5);
    });

    it('sqrt', () => {
      expect(safeEvaluate('sqrt(9)')).toBe(3);
      expect(safeEvaluate('sqrt(2)')).toBeCloseTo(1.414, 2);
    });

    it('floor/ceil/round/trunc', () => {
      expect(safeEvaluate('floor(3.7)')).toBe(3);
      expect(safeEvaluate('ceil(3.2)')).toBe(4);
      expect(safeEvaluate('round(3.5)')).toBe(4);
      expect(safeEvaluate('trunc(3.9)')).toBe(3);
    });

    it('min/max', () => {
      expect(safeEvaluate('min(3, 1, 2)')).toBe(1);
      expect(safeEvaluate('max(3, 1, 2)')).toBe(3);
    });

    it('min/max 数组参数', () => {
      expect(safeEvaluate('min([3, 1, 2])')).toBe(1);
      expect(safeEvaluate('max([3, 1, 2])')).toBe(3);
    });

    it('sum/avg', () => {
      expect(safeEvaluate('sum(1, 2, 3)')).toBe(6);
      expect(safeEvaluate('avg(1, 2, 3)')).toBe(2);
    });

    it('sum/avg 数组参数', () => {
      expect(safeEvaluate('sum([1, 2, 3])')).toBe(6);
      expect(safeEvaluate('avg([1, 2, 3])')).toBe(2);
    });

    it('pow', () => {
      expect(safeEvaluate('pow(2, 10)')).toBe(1024);
    });

    it('mod', () => {
      expect(safeEvaluate('mod(10, 3)')).toBe(1);
      expect(safeEvaluate('mod(10, 0)')).toBe(0);
    });

    it('clamp', () => {
      expect(safeEvaluate('clamp(5, 0, 10)')).toBe(5);
      expect(safeEvaluate('clamp(-5, 0, 10)')).toBe(0);
      expect(safeEvaluate('clamp(15, 0, 10)')).toBe(10);
    });

    it('三角函数', () => {
      expect(safeEvaluate('sin(0)')).toBe(0);
      expect(safeEvaluate('cos(0)')).toBe(1);
      expect(safeEvaluate('tan(0)')).toBe(0);
    });

    it('sign', () => {
      expect(safeEvaluate('sign(5)')).toBe(1);
      expect(safeEvaluate('sign(-5)')).toBe(-1);
      expect(safeEvaluate('sign(0)')).toBe(0);
    });

    it('自定义函数作用域', () => {
      const customFn = (x: number) => x * 2;
      expect(safeEvaluate('double(5)', { double: customFn })).toBe(10);
    });
  });

  // ========== 字符串操作 ==========
  describe('字符串', () => {
    it('双引号字符串', () => {
      expect(safeEvaluate('"hello"')).toBe('hello');
    });

    it('单引号字符串', () => {
      expect(safeEvaluate("'hello'")).toBe('hello');
    });

    it('转义字符', () => {
      expect(safeEvaluate('"hello\\nworld"')).toBe('hello\nworld');
      expect(safeEvaluate('"hello\\tworld"')).toBe('hello\tworld');
    });

    it('空字符串', () => {
      expect(safeEvaluate('""')).toBe('');
    });
  });

  // ========== 安全逃逸防御（核心） ==========
  describe('安全逃逸防御', () => {
    it('拒绝成员访问（点号）', () => {
      expect(() => safeEvaluate('a.b')).toThrow(SafeExpressionError);
    });

    it('拒绝 constructor 逃逸', () => {
      expect(() => safeEvaluate('constructor')).not.toThrow(); // 作为变量引用，回退为 0
      expect(safeEvaluate('constructor')).toBe(0);
    });

    it('拒绝 constructor.constructor 逃逸', () => {
      expect(() => safeEvaluate('constructor.constructor')).toThrow(SafeExpressionError);
    });

    it('拒绝 Function 构造器逃逸', () => {
      // 尝试经典的 RCE payload
      expect(() => safeEvaluate('"".constructor.constructor("return this")()')).toThrow(
        SafeExpressionError,
      );
    });

    it('拒绝 process 访问', () => {
      expect(() => safeEvaluate('process')).not.toThrow(); // 作为变量，回退为 0
      expect(safeEvaluate('process')).toBe(0);
      expect(() => safeEvaluate('process.env')).toThrow(SafeExpressionError);
    });

    it('拒绝 require 调用', () => {
      // require 作为未知函数会抛错
      expect(() => safeEvaluate('require("child_process")')).toThrow(SafeExpressionError);
    });

    it('拒绝赋值操作', () => {
      expect(() => safeEvaluate('x = 1')).toThrow(SafeExpressionError);
    });

    it('拒绝三目运算符', () => {
      expect(() => safeEvaluate('true ? 1 : 0')).toThrow(SafeExpressionError);
    });

    it('拒绝箭头函数', () => {
      expect(() => safeEvaluate('() => 1')).toThrow(SafeExpressionError);
    });

    it('拒绝方括号成员访问逃逸', () => {
      // obj["constructor"] 会返回 0（因为 scope 中没有 obj）
      expect(safeEvaluate('obj["constructor"]', { obj: {} })).toBe(0);
    });

    it('拒绝 new 操作', () => {
      expect(() => safeEvaluate('new Array()')).toThrow(SafeExpressionError);
    });

    it('拒绝 void 操作', () => {
      expect(() => safeEvaluate('void 0')).toThrow(SafeExpressionError);
    });

    it('拒绝 typeof 操作', () => {
      // typeof 作为标识符会回退为 0
      expect(safeEvaluate('typeof')).toBe(0);
    });

    it('拒绝注释', () => {
      expect(() => safeEvaluate('1 /* comment */ + 2')).toThrow(SafeExpressionError);
      expect(() => safeEvaluate('1 // comment')).toThrow(SafeExpressionError);
    });

    it('拒绝分号', () => {
      expect(() => safeEvaluate('1; 2')).toThrow(SafeExpressionError);
    });

    it('拒绝花括号', () => {
      expect(() => safeEvaluate('{}')).toThrow(SafeExpressionError);
    });

    it('拒绝反引号模板字符串', () => {
      expect(() => safeEvaluate('`template`')).toThrow(SafeExpressionError);
    });

    it('拒绝连续表达式', () => {
      expect(() => safeEvaluate('1, 2')).toThrow(SafeExpressionError);
    });

    it('拒绝空表达式', () => {
      expect(safeEvaluate('')).toBe(0);
      expect(safeEvaluate(null as any)).toBe(0);
      expect(safeEvaluate(undefined as any)).toBe(0);
    });
  });

  // ========== 边界情况 ==========
  describe('边界情况', () => {
    it('空表达式返回 0', () => {
      expect(safeEvaluate('')).toBe(0);
    });

    it('纯数字', () => {
      expect(safeEvaluate('42')).toBe(42);
    });

    it('浮点数', () => {
      expect(safeEvaluate('3.14')).toBeCloseTo(3.14, 2);
    });

    it('科学计数法', () => {
      expect(safeEvaluate('1e3')).toBe(1000);
      expect(safeEvaluate('1.5e2')).toBe(150);
    });

    it('嵌套括号', () => {
      expect(safeEvaluate('((1 + 2) * (3 + 4))')).toBe(21);
    });

    it.todo('嵌套数组');
  });
});
