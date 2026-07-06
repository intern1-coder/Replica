import { Role } from '@prisma/client';

/** Roles a client ADMIN may assign when creating or editing team members. */
export const ADMIN_ASSIGNABLE_ROLES: Role[] = [
  Role.PM,
  Role.ADMIN,
  Role.ACCOUNTS,
  Role.CONTRACTOR,
];

export function isSuperAdmin(role: Role): boolean {
  return role === Role.SUPER_ADMIN;
}

export function canAssignRole(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === Role.SUPER_ADMIN) return true;
  if (actorRole === Role.ADMIN) return ADMIN_ASSIGNABLE_ROLES.includes(targetRole);
  return false;
}

export function canManageMember(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === Role.SUPER_ADMIN) return true;
  if (actorRole === Role.ADMIN) return !isSuperAdmin(targetRole);
  return false;
}

export function shouldHideFromTeamList(memberRole: Role, viewerRole: Role): boolean {
  return isSuperAdmin(memberRole) && viewerRole !== Role.SUPER_ADMIN;
}
