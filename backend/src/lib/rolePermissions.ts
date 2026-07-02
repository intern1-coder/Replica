// ─────────────────────────────────────────────────────────────────────────────
// Role presets — default permission sets per Role.
//
// These reproduce the app's PRE-EXISTING role-based behaviour so that switching
// route guards from requireRole() to requirePermission() causes NO regression.
// Members start from their role preset and may have individual keys overridden
// via User.permissionOverrides.
//
// ADMIN and OWNER are full-access and handled directly in getEffectivePermissions
// (so they always inherit any newly-added permission key automatically).
// ─────────────────────────────────────────────────────────────────────────────

import type { PermissionKey } from './permissions';

// Views that were ungated (any authenticated user) under the old role system.
const OPEN_VIEWS: PermissionKey[] = [
  'jobs:view',
  'clients:view',
  'properties:view',
  'tenants:view',
  'worklogs:view',
  'communications:view',
  'reminders:view',
  'media:view',
  'settings:view',
];

// PM: create/edit across operational resources, no hard deletes, no team mgmt.
const PM: PermissionKey[] = [
  ...OPEN_VIEWS,
  'engineers:view',
  'jobs:create', 'jobs:edit',
  'clients:create', 'clients:edit',
  'properties:create', 'properties:edit',
  'tenants:create', 'tenants:edit',
  'engineers:create', 'engineers:edit',
  'worklogs:create', 'worklogs:edit',
  'communications:create',
  'reminders:manage',
  'media:upload',
  'media:delete',
  'lineitems:view', 'lineitems:create', 'lineitems:edit', 'lineitems:delete',
  'documents:view', 'documents:create', 'documents:edit',
  'financials:view',
  'engineer_costs:view',
  'audit:view',
];

// ACCOUNTS: read-only operational access + financial visibility.
const ACCOUNTS: PermissionKey[] = [
  ...OPEN_VIEWS,
  'financials:view',
  'engineer_costs:view',
];

// CONTRACTOR: view-only of the open resources.
const CONTRACTOR: PermissionKey[] = [...OPEN_VIEWS];

/** Presets for the non-admin roles. ADMIN/OWNER resolve to all permissions. */
export const ROLE_PRESETS: Record<'PM' | 'ACCOUNTS' | 'CONTRACTOR', PermissionKey[]> = {
  PM,
  ACCOUNTS,
  CONTRACTOR,
};

// Permissions an OWNER can never lose via overrides (anti-lockout floor).
export const OWNER_FLOOR: PermissionKey[] = [
  'users:view', 'users:create', 'users:edit', 'users:delete',
  'settings:view', 'settings:edit',
];
