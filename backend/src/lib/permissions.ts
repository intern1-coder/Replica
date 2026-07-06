// ─────────────────────────────────────────────────────────────────────────────
// Permission catalog — single source of truth for granular access control.
//
// A permission key has the shape `resource:action`. Roles map to a default set
// of these keys (see rolePermissions.ts); individual members can override single
// keys on top of their role preset via User.permissionOverrides (sparse JSON).
//
// This file is the shared contract between backend guards and the frontend
// permission matrix UI — keep PERMISSION_GROUPS in sync with the route guards.
// ─────────────────────────────────────────────────────────────────────────────

import { Role } from '@prisma/client';
import { ROLE_PRESETS, OWNER_FLOOR, SUPER_ADMIN_FLOOR } from './rolePermissions';

/**
 * Grouped catalog: resource -> list of actions. Drives both the typed key union
 * below and the frontend matrix renderer. `label` is for UI display.
 */
export const PERMISSION_GROUPS = [
  { resource: 'jobs', label: 'Jobs', actions: ['view', 'create', 'edit', 'delete', 'authorize', 'complete'] },
  { resource: 'clients', label: 'Clients', actions: ['view', 'create', 'edit', 'delete'] },
  { resource: 'properties', label: 'Properties', actions: ['view', 'create', 'edit', 'delete'] },
  { resource: 'tenants', label: 'Tenants', actions: ['view', 'create', 'edit', 'delete'] },
  { resource: 'engineers', label: 'Engineers', actions: ['view', 'create', 'edit', 'delete'] },
  { resource: 'worklogs', label: 'Work Logs', actions: ['view', 'create', 'edit', 'delete'] },
  { resource: 'communications', label: 'Communications', actions: ['view', 'create'] },
  { resource: 'reminders', label: 'Reminders', actions: ['view', 'manage'] },
  { resource: 'media', label: 'Job Media', actions: ['view', 'upload', 'delete'] },
  { resource: 'lineitems', label: 'Quote Line Items', actions: ['view', 'create', 'edit', 'delete'] },
  { resource: 'documents', label: 'Documents', actions: ['view', 'create', 'edit'] },
  { resource: 'settings', label: 'Settings', actions: ['view', 'edit'] },
  { resource: 'users', label: 'Team Access', actions: ['view', 'create', 'edit', 'delete'] },
  // Section-level visibility ("what they can see") — single `view` action each.
  { resource: 'financials', label: 'Financials (P&L)', actions: ['view'] },
  { resource: 'engineer_costs', label: 'Engineer Costs/Rates', actions: ['view'] },
  { resource: 'audit', label: 'Audit Trail', actions: ['view'] },
] as const;

type Group = (typeof PERMISSION_GROUPS)[number];
export type PermissionKey = `${Group['resource']}:${Group['actions'][number]}`;

/** Flat list of every valid permission key. */
export const ALL_PERMISSIONS: PermissionKey[] = PERMISSION_GROUPS.flatMap((g) =>
  g.actions.map((a) => `${g.resource}:${a}` as PermissionKey)
);

const ALL_PERMISSIONS_SET = new Set<string>(ALL_PERMISSIONS);

export function isPermissionKey(key: string): key is PermissionKey {
  return ALL_PERMISSIONS_SET.has(key);
}

/** Sparse per-member overrides: only keys that differ from the role preset. */
export type PermissionOverrides = Partial<Record<PermissionKey, boolean>>;

/**
 * Resolves a member's effective permissions: start from the role preset, then
 * apply sparse overrides. OWNER always retains the safe floor (never lock out).
 * Returns a complete map of every key -> boolean.
 */
export function getEffectivePermissions(
  role: Role,
  overrides?: PermissionOverrides | null,
  // Legacy per-user flag — grants jobs:authorize as a baseline (overrides still win).
  canAuthorizeJobs = false
): Record<PermissionKey, boolean> {
  // SUPER_ADMIN, ADMIN, and OWNER are full-access by default.
  const fullAccess =
    role === Role.SUPER_ADMIN || role === Role.ADMIN || role === Role.OWNER;
  const preset = fullAccess
    ? new Set<string>(ALL_PERMISSIONS)
    : new Set<string>(ROLE_PRESETS[role as 'PM' | 'ACCOUNTS' | 'CONTRACTOR'] ?? []);

  if (canAuthorizeJobs) preset.add('jobs:authorize');

  const result = {} as Record<PermissionKey, boolean>;

  for (const key of ALL_PERMISSIONS) {
    let allowed = preset.has(key);
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
      allowed = !!overrides[key];
    }
    result[key] = allowed;
  }

  // SUPER_ADMIN safe floor — these can never be removed via overrides (anti-lockout).
  if (role === Role.SUPER_ADMIN) {
    for (const key of SUPER_ADMIN_FLOOR) result[key] = true;
  }

  // OWNER safe floor — these can never be removed via overrides (anti-lockout).
  if (role === Role.OWNER) {
    for (const key of OWNER_FLOOR) result[key] = true;
  }

  applyViewDependencies(result);

  return result;
}

/**
 * Ensures mutating actions never exist without `view` for the same resource.
 * If view is denied, all other actions for that resource are cleared.
 */
export function applyViewDependencies(result: Record<PermissionKey, boolean>): void {
  for (const group of PERMISSION_GROUPS) {
    if (!group.actions.includes('view')) continue;

    const viewKey = `${group.resource}:view` as PermissionKey;
    const hasMutating = group.actions.some((action) => {
      if (action === 'view') return false;
      return result[`${group.resource}:${action}` as PermissionKey];
    });

    if (hasMutating) {
      result[viewKey] = true;
    }

    if (!result[viewKey]) {
      for (const action of group.actions) {
        if (action === 'view') continue;
        result[`${group.resource}:${action}` as PermissionKey] = false;
      }
    }
  }
}

/**
 * Coerces an untrusted JSON value (User.permissionOverrides) into a clean,
 * validated PermissionOverrides object — drops unknown keys and non-booleans.
 */
export function sanitizeOverrides(raw: unknown): PermissionOverrides {
  const out: PermissionOverrides = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isPermissionKey(k) && typeof v === 'boolean') {
        out[k] = v;
      }
    }
  }
  return out;
}

/** Single-key check against an effective permission map. */
export function hasPermission(
  effective: Record<PermissionKey, boolean> | undefined,
  key: PermissionKey
): boolean {
  return !!effective?.[key];
}
