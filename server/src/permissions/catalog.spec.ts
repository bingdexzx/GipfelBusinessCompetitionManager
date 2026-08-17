/**
 * permissions/catalog.ts 单测
 *
 * 覆盖：
 * 1. hasPermission - 权限判定
 * 2. parsePermissions / serializePermissions - 序列化
 * 3. parseCompanyScopes / serializeCompanyScopes - 范围解析
 * 4. canReadCompanyAllFields - 全量字段读取权限
 * 5. companyListScopes - 公司列表范围
 */

import {
  hasPermission,
  parsePermissions,
  serializePermissions,
  parseCompanyScopes,
  serializeCompanyScopes,
  canReadCompanyAllFields,
  companyListScopes,
  isValidPermissions,
  ALL_PERMISSION_KEYS,
} from './catalog';

describe('permissions/catalog', () => {
  // ========== hasPermission ==========
  describe('hasPermission', () => {
    // SUPER_ADMIN 始终放行
    it('SUPER_ADMIN 始终放行', () => {
      expect(hasPermission('SUPER_ADMIN', null, 'account:manage')).toBe(true);
      expect(hasPermission('SUPER_ADMIN', [], 'competition:manage')).toBe(true);
      expect(hasPermission('SUPER_ADMIN', null, ['data:material:edit', 'stock:manage'])).toBe(true);
    });

    // 空需求
    it('空需求始终满足', () => {
      expect(hasPermission('PLAYER', [], [])).toBe(true);
      expect(hasPermission('PLAYER', null, [])).toBe(true);
    });

    // 精确匹配
    it('精确匹配', () => {
      expect(hasPermission('PLAYER', ['data:material:view'], 'data:material:view')).toBe(true);
      expect(hasPermission('PLAYER', ['data:material:view'], 'data:material:edit')).toBe(false);
    });

    // view 蕴含：持有该域任意动作即满足 view
    describe('view 蕴含', () => {
      it('edit 满足 view', () => {
        expect(hasPermission('PLAYER', ['data:material:edit'], 'data:material:view')).toBe(true);
      });

      it('manage 满足 view', () => {
        expect(hasPermission('PLAYER', ['contract:manage'], 'contract:view')).toBe(true);
      });

      it('execute 满足 view', () => {
        expect(hasPermission('PLAYER', ['contract:execute'], 'contract:view')).toBe(true);
      });

      it('audit 满足 view', () => {
        expect(hasPermission('PLAYER', ['contract:audit'], 'contract:view')).toBe(true);
      });

      it('空权限不满足 view', () => {
        expect(hasPermission('PLAYER', [], 'data:material:view')).toBe(false);
        expect(hasPermission('PLAYER', null, 'data:material:view')).toBe(false);
      });
    });

    // edit 蕴含：manage 满足 edit
    describe('edit 蕴含', () => {
      it('manage 满足 edit', () => {
        expect(hasPermission('PLAYER', ['data:material:manage'], 'data:material:edit')).toBe(true);
      });

      it('view 不满足 edit', () => {
        expect(hasPermission('PLAYER', ['data:material:view'], 'data:material:edit')).toBe(false);
      });
    });

    // manage 蕴含 execute（D1 确认：manage ⊇ execute）
    describe('manage 蕴含 execute', () => {
      it('manage 满足 execute', () => {
        expect(hasPermission('PLAYER', ['contract:manage'], 'contract:execute')).toBe(true);
      });
    });

    // execute 蕴含 audit（D1 确认：execute ⊇ audit）
    describe('execute 蕴含 audit', () => {
      it('execute 满足 audit', () => {
        expect(hasPermission('PLAYER', ['contract:execute'], 'contract:audit')).toBe(true);
      });

      it('manage 也满足 audit', () => {
        expect(hasPermission('PLAYER', ['contract:manage'], 'contract:audit')).toBe(true);
      });
    });

    // 低等级不蕴含高等级
    describe('低等级不蕴含高等级', () => {
      it('audit 不满足 execute', () => {
        expect(hasPermission('PLAYER', ['contract:audit'], 'contract:execute')).toBe(false);
      });

      it('view 不满足 edit', () => {
        expect(hasPermission('PLAYER', ['data:material:view'], 'data:material:edit')).toBe(false);
      });

      it('edit 不满足 manage', () => {
        expect(hasPermission('PLAYER', ['data:material:edit'], 'data:material:manage')).toBe(false);
      });
    });

    // 精确匹配
    describe('精确匹配', () => {
      it('需要精确持有 manage', () => {
        expect(hasPermission('PLAYER', ['contract:manage'], 'contract:manage')).toBe(true);
      });

      it('需要精确持有 execute', () => {
        expect(hasPermission('PLAYER', ['contract:execute'], 'contract:execute')).toBe(true);
      });

      it('需要精确持有 audit', () => {
        expect(hasPermission('PLAYER', ['contract:audit'], 'contract:audit')).toBe(true);
      });
    });

    // AND 语义
    describe('AND 语义', () => {
      it('全部满足', () => {
        expect(
          hasPermission('PLAYER', ['data:material:view', 'data:part:view'], [
            'data:material:view',
            'data:part:view',
          ]),
        ).toBe(true);
      });

      it('部分满足', () => {
        expect(
          hasPermission('PLAYER', ['data:material:view'], ['data:material:view', 'data:part:view']),
        ).toBe(false);
      });
    });

    // 域前缀精确匹配（避免 startsWith 误匹配）
    it('域前缀精确匹配', () => {
      // data:material:view 不应匹配 data:material:edit:xxx
      expect(hasPermission('PLAYER', ['data:material:edit:xxx'], 'data:material:view')).toBe(false);
    });
  });

  // ========== parsePermissions / serializePermissions ==========
  describe('parsePermissions', () => {
    it('null 返回空数组', () => {
      expect(parsePermissions(null)).toEqual([]);
    });

    it('undefined 返回空数组', () => {
      expect(parsePermissions(undefined)).toEqual([]);
    });

    it('空字符串返回空数组', () => {
      expect(parsePermissions('')).toEqual([]);
    });

    it('解析 JSON 数组', () => {
      expect(parsePermissions('["data:material:view","data:part:edit"]')).toEqual([
        'data:material:view',
        'data:part:edit',
      ]);
    });

    it('非数组返回空', () => {
      expect(parsePermissions('"not-array"')).toEqual([]);
    });

    it('非法 JSON 返回空', () => {
      expect(parsePermissions('invalid-json')).toEqual([]);
    });

    it('过滤非字符串元素', () => {
      expect(parsePermissions('[1, "valid", null]')).toEqual(['valid']);
    });
  });

  describe('serializePermissions', () => {
    it('null 返回 null', () => {
      expect(serializePermissions(null)).toBeNull();
    });

    it('空数组返回 null', () => {
      expect(serializePermissions([])).toBeNull();
    });

    it('序列化并去重', () => {
      const result = serializePermissions(['a', 'b', 'a']);
      expect(JSON.parse(result!)).toEqual(['a', 'b']);
    });
  });

  // ========== parseCompanyScopes / serializeCompanyScopes ==========
  describe('parseCompanyScopes', () => {
    it('null 返回空数组', () => {
      expect(parseCompanyScopes(null)).toEqual([]);
    });

    it('空数组', () => {
      expect(parseCompanyScopes('[]')).toEqual([]);
    });

    it('解析数字数组', () => {
      expect(parseCompanyScopes('[1, 2, 3]')).toEqual([1, 2, 3]);
    });

    it('字符串数字转数字', () => {
      expect(parseCompanyScopes('["1", "2"]')).toEqual([1, 2]);
    });

    it('过滤非法值', () => {
      expect(parseCompanyScopes('[1, "abc", null, 3]')).toEqual([1, 3]);
    });
  });

  describe('serializeCompanyScopes', () => {
    it('null 返回 null', () => {
      expect(serializeCompanyScopes(null)).toBeNull();
    });

    it('空数组返回 null', () => {
      expect(serializeCompanyScopes([])).toBeNull();
    });

    it('序列化并去重', () => {
      const result = serializeCompanyScopes([1, 2, 1, 3]);
      expect(JSON.parse(result!)).toEqual([1, 2, 3]);
    });

    it('过滤非数字', () => {
      const result = serializeCompanyScopes([1, NaN, 2, Infinity]);
      expect(JSON.parse(result!)).toEqual([1, 2]);
    });
  });

  // ========== canReadCompanyAllFields ==========
  describe('canReadCompanyAllFields', () => {
    it('SUPER_ADMIN 恒放行', () => {
      expect(canReadCompanyAllFields('SUPER_ADMIN', null, null, 1)).toBe(true);
    });

    it('company:manage 恒放行', () => {
      expect(
        canReadCompanyAllFields('PLAYER', ['company:manage'], null, 1),
      ).toBe(true);
    });

    it('data:region:edit 恒放行', () => {
      expect(
        canReadCompanyAllFields('PLAYER', ['data:region:edit'], null, 1),
      ).toBe(true);
    });

    it('company:view + 空范围 = 不限制', () => {
      expect(
        canReadCompanyAllFields('PLAYER', ['company:view'], null, 1),
      ).toBe(true);
      expect(
        canReadCompanyAllFields('PLAYER', ['company:view'], [], 1),
      ).toBe(true);
    });

    it('company:view + 有范围 = 按范围限制', () => {
      expect(
        canReadCompanyAllFields('PLAYER', ['company:view'], [1, 2], 1),
      ).toBe(true);
      expect(
        canReadCompanyAllFields('PLAYER', ['company:view'], [1, 2], 3),
      ).toBe(false);
    });

    it('无相关权限 = 拒绝', () => {
      expect(
        canReadCompanyAllFields('PLAYER', ['data:material:view'], null, 1),
      ).toBe(false);
    });
  });

  // ========== companyListScopes ==========
  describe('companyListScopes', () => {
    it('SUPER_ADMIN 返回 null（不限制）', () => {
      expect(companyListScopes('SUPER_ADMIN', null, null)).toBeNull();
    });

    it('company:manage 返回 null', () => {
      expect(companyListScopes('PLAYER', ['company:manage'], null)).toBeNull();
    });

    it('空范围返回 null', () => {
      expect(companyListScopes('PLAYER', ['company:view'], null)).toBeNull();
      expect(companyListScopes('PLAYER', ['company:view'], [])).toBeNull();
    });

    it('有范围返回范围', () => {
      expect(companyListScopes('PLAYER', ['company:view'], [1, 2])).toEqual([1, 2]);
    });
  });

  // ========== isValidPermissions ==========
  describe('isValidPermissions', () => {
    it('有效权限数组', () => {
      expect(isValidPermissions(['data:material:view', 'contract:manage'])).toBe(true);
    });

    it('空数组有效', () => {
      expect(isValidPermissions([])).toBe(true);
    });

    it('包含无效 key', () => {
      expect(isValidPermissions(['invalid:key'])).toBe(false);
    });

    it('包含废弃 key（仍视为合法）', () => {
      expect(isValidPermissions(['settings:view'])).toBe(true);
    });

    it('非数组', () => {
      expect(isValidPermissions('not-array')).toBe(false);
    });

    it('包含非字符串', () => {
      expect(isValidPermissions([123])).toBe(false);
    });
  });

  // ========== ALL_PERMISSION_KEYS ==========
  describe('ALL_PERMISSION_KEYS', () => {
    it('包含所有权限 key', () => {
      expect(ALL_PERMISSION_KEYS.length).toBeGreaterThan(0);
      expect(ALL_PERMISSION_KEYS).toContain('data:material:view');
      expect(ALL_PERMISSION_KEYS).toContain('contract:manage');
      expect(ALL_PERMISSION_KEYS).toContain('stock:view');
      expect(ALL_PERMISSION_KEYS).toContain('account:manage');
    });

    it('无重复', () => {
      const unique = new Set(ALL_PERMISSION_KEYS);
      expect(unique.size).toBe(ALL_PERMISSION_KEYS.length);
    });
  });
});
