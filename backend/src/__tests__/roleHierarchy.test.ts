import {
  ADMIN_ASSIGNABLE_ROLES,
  canAssignRole,
  canManageMember,
  shouldHideFromTeamList,
} from '../lib/roleHierarchy';
import { Role } from '@prisma/client';

describe('roleHierarchy', () => {
  describe('canAssignRole', () => {
    it('SUPER_ADMIN can assign any role', () => {
      for (const role of Object.values(Role)) {
        expect(canAssignRole(Role.SUPER_ADMIN, role)).toBe(true);
      }
    });

    it('ADMIN can only assign team roles', () => {
      for (const role of ADMIN_ASSIGNABLE_ROLES) {
        expect(canAssignRole(Role.ADMIN, role)).toBe(true);
      }
      expect(canAssignRole(Role.ADMIN, Role.SUPER_ADMIN)).toBe(false);
      expect(canAssignRole(Role.ADMIN, Role.OWNER)).toBe(false);
    });
  });

  describe('canManageMember', () => {
    it('ADMIN cannot manage SUPER_ADMIN', () => {
      expect(canManageMember(Role.ADMIN, Role.SUPER_ADMIN)).toBe(false);
    });

    it('SUPER_ADMIN can manage ADMIN', () => {
      expect(canManageMember(Role.SUPER_ADMIN, Role.ADMIN)).toBe(true);
    });
  });

  describe('shouldHideFromTeamList', () => {
    it('hides SUPER_ADMIN from ADMIN viewers', () => {
      expect(shouldHideFromTeamList(Role.SUPER_ADMIN, Role.ADMIN)).toBe(true);
    });

    it('shows SUPER_ADMIN to SUPER_ADMIN viewers', () => {
      expect(shouldHideFromTeamList(Role.SUPER_ADMIN, Role.SUPER_ADMIN)).toBe(false);
    });
  });
});
