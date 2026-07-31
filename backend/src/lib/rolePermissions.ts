// ─────────────────────────────────────────────────────────────────────────────
// Role presets — default permission sets per Role.
//
// These reproduce the app's PRE-EXISTING role-based behaviour so that switching
// route guards from requireRole() to requirePermission() causes NO regression.
// Members start from their role preset and may have individual keys overridden
// via User.permissionOverrides.
//
// ADMIN, SUPER_ADMIN, and OWNER are full-access and handled directly in getEffectivePermissions
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

// ACCOUNTS: read-only operational access + financial visibility, plus the
// invoice workflow: review completion reports and sign jobs off as COMPLETED.
const ACCOUNTS: PermissionKey[] = [
  ...OPEN_VIEWS,
  'engineers:view',
  'financials:view',
  'engineer_costs:view',
  'documents:view',
  'jobs:complete',
];

// CONTRACTOR: view-only of the resources needed to work an assigned job —
// NOT the standalone client/property/tenant directories. Those routes let a
// member browse every client/property/tenant in the system independent of
// any job assignment; a job a contractor is actually assigned to still
// carries its own property address, tenant name/phone, and access notes
// embedded in the job response (jobs:view), so nothing needed to do the
// work is lost. Engineer names (not rates — engineer_costs:view is
// withheld) are already visible via the `contractor` field on work logs,
// so gating GET /api/engineers would only break the work-log form's picker
// without hiding anything.
const CONTRACTOR: PermissionKey[] = [
  'jobs:view',
  'worklogs:view',
  'communications:view',
  'reminders:view',
  'media:view',
  'settings:view',
  'engineers:view',
];

/** Presets for the non-admin roles. ADMIN/OWNER resolve to all permissions. */
export const ROLE_PRESETS: Record<'PM' | 'ACCOUNTS' | 'CONTRACTOR', PermissionKey[]> = {
  PM,
  ACCOUNTS,
  CONTRACTOR,
};

// Permissions a SUPER_ADMIN can never lose via overrides (anti-lockout floor).
export const SUPER_ADMIN_FLOOR: PermissionKey[] = [
  'users:view', 'users:create', 'users:edit', 'users:delete',
  'settings:view', 'settings:edit',
];

// Permissions an OWNER can never lose via overrides (anti-lockout floor).
export const OWNER_FLOOR: PermissionKey[] = [
  'users:view', 'users:create', 'users:edit', 'users:delete',
  'settings:view', 'settings:edit',
];
