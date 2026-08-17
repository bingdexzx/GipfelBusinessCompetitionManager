/**
 * role-templates.ts 单测
 *
 * 覆盖：
 * 1. getDefaultPermissions
 * 2. getDefaultScopes
 * 3. assertGrantAllowed
 * 4. isSuperAdminOnly
 */

import {
  ROLE_TEMPLATES,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  getDefaultPermissions,
  getDefaultScopes,
  assertGrantAllowed,
  isSuperAdminOnly,
} from './role-templates';

describe('role-templates', () => {
  // ========== ROLE_TEMPLATES ==========
  describe('ROLE_TEMPLATES', () => {
    it('包含三个角色', () => {
      expect(Object.keys(ROLE_TEMPLATES)).toEqual(['SUPER_ADMIN', 'COMPETITION_ADMIN', 'PLAYER']);
    });

    it('SUPER_ADMIN 默认权限为空', () => {
      expect(ROLE_TEMPLATES.SUPER_ADMIN.defaultPermissions).toEqual([]);
    });

    it('COMPETITION_ADMIN 包含 contract:manage', () => {
      expect(ROLE_TEMPLATES.COMPETITION_ADMIN.defaultPermissions).toContain('contract:manage');
    });

    it('PLAYER 包含基础视图权限', () => {
      expect(ROLE_TEMPLATES.PLAYER.defaultPermissions).toContain('data:material:view');
      expect(ROLE_TEMPLATES.PLAYER.defaultPermissions).toContain('contract:view');
    });
  });

  // ========== getDefaultPermissions ==========
  describe('getDefaultPermissions', () => {
    it('SUPER_ADMIN 返回空数组', () => {
      expect(getDefaultPermissions('SUPER_ADMIN')).toEqual([]);
    });

    it('COMPETITION_ADMIN 返回正确权限', () => {
      const perms = getDefaultPermissions('COMPETITION_ADMIN');
      expect(perms).toContain('contract:manage');
      expect(perms).toContain('contract:audit');
      expect(perms).toContain('contract:execute');
      expect(perms).toContain('stock:edit');
    });

    it('PLAYER 返回基础视图权限', () => {
      const perms = getDefaultPermissions('PLAYER');
      expect(perms).toContain('data:material:view');
      expect(perms).not.toContain('contract:manage');
    });

    it('未知角色返回空数组', () => {
      expect(getDefaultPermissions('UNKNOWN')).toEqual([]);
    });
  });

  // ========== getDefaultScopes ==========
  describe('getDefaultScopes', () => {
    it('SUPER_ADMIN 范围全为 null', () => {
      const scopes = getDefaultScopes('SUPER_ADMIN');
      expect(scopes?.companyScopes).toBeNull();
      expect(scopes?.viewCompanyScopes).toBeNull();
    });

    it('PLAYER companyScopes 为空数组', () => {
      const scopes = getDefaultScopes('PLAYER');
      expect(scopes?.companyScopes).toEqual([]);
    });

    it('未知角色返回 null', () => {
      expect(getDefaultScopes('UNKNOWN')).toBeNull();
    });
  });

  // ========== assertGrantAllowed ==========
  describe('assertGrantAllowed', () => {
    it('非超管不能写权限', () => {
      const result = assertGrantAllowed('COMPETITION_ADMIN', 'PLAYER', ['data:material:view']);
      expect(result.allowed).toBe(false);
      expect(result.violations).toContain('仅超管可修改权限');
    });

    it('超管可以授予权限', () => {
      const result = assertGrantAllowed('SUPER_ADMIN', 'PLAYER', ['data:material:view']);
      expect(result.allowed).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it('超管角色权限必须为空', () => {
      const result = assertGrantAllowed('SUPER_ADMIN', 'SUPER_ADMIN', ['data:material:view']);
      expect(result.allowed).toBe(false);
      expect(result.violations).toContain('超管权限不落库，必须为空数组');
    });

    it('超管角色空权限允许', () => {
      const result = assertGrantAllowed('SUPER_ADMIN', 'SUPER_ADMIN', []);
      expect(result.allowed).toBe(true);
    });

    it('超管专属权限不可授予非超管', () => {
      const result = assertGrantAllowed('SUPER_ADMIN', 'PLAYER', ['account:manage']);
      expect(result.allowed).toBe(false);
      expect(result.violations[0]).toContain('超管专属权限');
    });

    it('超管专属权限列表完整', () => {
      expect(SUPER_ADMIN_ONLY_PERMISSIONS).toContain('competition:manage');
      expect(SUPER_ADMIN_ONLY_PERMISSIONS).toContain('account:manage');
      expect(SUPER_ADMIN_ONLY_PERMISSIONS).toContain('stock:manage');
    });

    it('超出授予上限', () => {
      const result = assertGrantAllowed('SUPER_ADMIN', 'PLAYER', ['contract:manage']);
      expect(result.allowed).toBe(false);
      expect(result.violations[0]).toContain('超出');
    });

    it('COMPETITION_ADMIN 可授予基础权限', () => {
      const result = assertGrantAllowed('SUPER_ADMIN', 'COMPETITION_ADMIN', [
        'data:material:view',
        'contract:manage',
      ]);
      expect(result.allowed).toBe(true);
    });

    it('COMPETITION_ADMIN 扩展集需超管显式放开', () => {
      // 默认情况下扩展集不在授予上限内
      const result = assertGrantAllowed('SUPER_ADMIN', 'COMPETITION_ADMIN', ['message:manage']);
      expect(result.allowed).toBe(false);
    });
  });

  // ========== isSuperAdminOnly ==========
  describe('isSuperAdminOnly', () => {
    it('SUPER_ADMIN 返回 true', () => {
      expect(isSuperAdminOnly('SUPER_ADMIN')).toBe(true);
    });

    it('COMPETITION_ADMIN 返回 false', () => {
      expect(isSuperAdminOnly('COMPETITION_ADMIN')).toBe(false);
    });

    it('PLAYER 返回 false', () => {
      expect(isSuperAdminOnly('PLAYER')).toBe(false);
    });

    it('未知角色返回 false', () => {
      expect(isSuperAdminOnly('UNKNOWN')).toBe(false);
    });
  });
});
