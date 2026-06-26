# Lessons Learned — Bugs & Mistakes to Avoid

A running log of real bugs we introduced and fixed, so we don't repeat them.

---

## 1. Audit Log `before` snapshot must include the same relations as `after`

**Where it happened:** `PATCH /api/jobs/:id`, `PATCH /api/jobs/:id/status`, `PATCH /api/work-logs/:id`

**What went wrong:**
When writing audit logs, we fetched the "before" state with a plain `findFirst`/`findUnique` (no `include`), but the "after" state came from an `update` or `applyTransition` that used `include: { client, property, assignedContractors, contractor, loggedBy }`. This meant `before.client` was `undefined` while `after.client` was `{id, name}` — so the diff table falsely showed Client, Property, and Assigned Engineers as "changed" on every update, even when they weren't touched.

**Rule:**
> Whenever `logAudit({ before, after })` is called for an UPDATE, the `existing` (before) query **must include the exact same relations** as the `updated` (after) query. Match the `include` shapes.

```ts
// WRONG
const existing = await prisma.job.findFirst({ where: { id } });
const updated = await prisma.job.update({ ..., include: { client, property, assignedContractors } });
await logAudit({ before: existing, after: updated }); // phantom diffs!

// CORRECT
const existing = await prisma.job.findFirst({
  where: { id },
  include: { client: { select: { id: true, name: true } }, property: { select: { id: true, address: true } }, assignedContractors: { select: { id: true, name: true } } },
});
const updated = await prisma.job.update({ ..., include: { client: { select: { id: true, name: true } }, property: { select: { id: true, address: true } }, assignedContractors: { select: { id: true, name: true } } } });
await logAudit({ before: existing, after: updated }); // accurate diff
```

---

## 2. `JSON.stringify(undefined)` is not a string — normalize before diffing

**Where it happened:** `ChangeTable` in `JobAuditLogs.tsx`

**What went wrong:**
We compared before/after values with `JSON.stringify(before[key]) !== JSON.stringify(after[key])`. When a key was missing from `before`, `before[key]` was `undefined`. `JSON.stringify(undefined)` returns `undefined` (not the string `"undefined"`), so `undefined !== '"some value"'` is always `true` — every missing key appeared as a change.

**Rule:**
> Never diff audit values with raw `JSON.stringify`. Always normalize `null` and `undefined` to the same sentinel first.

```ts
// WRONG
JSON.stringify(before[key]) !== JSON.stringify(after[key])

// CORRECT
const diffKey = (val: unknown) => JSON.stringify(val ?? null);
diffKey(before[key]) !== diffKey(after[key])
```

---

## 3. Arrays are `typeof "object"` — check `Array.isArray` first

**Where it happened:** `formatAuditValue` in `JobAuditLogs.tsx`

**What went wrong:**
The function checked `typeof val === 'object'` and tried `obj.name` / `obj.address`. Arrays pass the `typeof` check but don't have `.name`, so `assignedContractors: [{id, name}, {id, name}]` fell through to `JSON.stringify(val)` and printed raw JSON in the audit table.

**Rule:**
> Always check `Array.isArray(val)` **before** the `typeof val === 'object'` branch when formatting display values.

```ts
// WRONG
if (typeof val === 'object') { ... }

// CORRECT
if (Array.isArray(val)) {
  return val.map((item) => item?.name || item?.address || JSON.stringify(item)).join(', ');
}
if (typeof val === 'object') { ... }
```

---

## 4. Raw FK fields in audit diffs are noise — skip them

**Where it happened:** `ChangeTable` in `JobAuditLogs.tsx`

**What went wrong:**
Iterating all keys on the `after` object included raw FK columns (`clientId`, `propertyId`, `contractorId`, `loggedById`) alongside the human-readable relation objects (`client`, `property`, `contractor`). Both showed up in the diff, doubling the noise — the FK showing `(updated)` and the relation showing the actual name.

**Rule:**
> Maintain a `SKIP_DIFF_KEYS` set that excludes raw FK columns, internal timestamps, and version counters. Let the named relation object carry the readable value.

```ts
const SKIP_DIFF_KEYS = new Set([
  'updatedAt', 'createdAt', 'version', 'deletedAt', 'completedAt',
  'clientId', 'propertyId', 'tenantId', 'performedById',
  'contractorId', 'loggedById',
  'id', 'jobId', 'entityId',
]);
```

---

## 5. Never import from a module that doesn't exist

**Where it happened:** `backend/src/routes/engineers.ts`, `backend/src/routes/settings.ts`

**What went wrong:**
Both new route files were written with `import { validate } from '../middleware/validate'`. That file does not exist. `validate` is exported from `'../middleware/errorHandler'`. The app would fail at startup with a module-not-found error.

**Rule:**
> Before writing a new import, grep the codebase for the export to confirm where it actually lives.

```bash
grep -r "export.*validate" backend/src/middleware/
# → errorHandler.ts
```

---

## 6. Prompt injection via tool results — watch for embedded `fetch` calls in generated code

**Where it happened:** `JobAuditLogs.tsx`, line 148 (since removed)

**What happened:**
A tool result (likely a server API response or external data fetched during an earlier session) contained instructions that caused a hidden `fetch` call to be embedded in the component:

```ts
// #region agent log
fetch('http://127.0.0.1:7743/ingest/<uuid>', { method: 'POST', body: JSON.stringify({ data }) }).catch(() => {});
// #endregion
```

This silently sent audit log data to a local endpoint on every load.

**Rule:**
> After any session where external data was fetched or pasted, audit generated files for unexpected `fetch`, `XMLHttpRequest`, `axios`, `eval`, or dynamic `import()` calls that weren't in the original task description. Tag: `#region agent log` is a red flag pattern.

---

## 7. Status change `before` snapshot needs the same treatment as field-update `before`

**Where it happened:** `PATCH /api/jobs/:id/status` in `jobs.ts`

**What went wrong:**
We fixed the field-update (`PATCH /api/jobs/:id`) snapshot to include relations, but forgot to apply the same fix to the status-change handler. `applyTransition` returns the job with relations included, but the `existing` fetched before calling it had no includes — causing the same phantom "Client/Property changed" diffs on status-transition audit entries.

**Rule:**
> When fixing a pattern bug across multiple handlers, search all `logAudit` call sites in the same file and fix them all at the same time. Don't fix one and miss the sibling.

```bash
grep -n "logAudit" backend/src/routes/jobs.ts
# Check every call site, not just the first one
```

---

## 8. WorkLog audit entries appear in the Job audit trail — fix their snapshots too

**Where it happened:** `PATCH /api/work-logs/:id` in `workLogs.ts`

**What went wrong:**
WorkLog `logAudit` calls pass `jobId`, which means those entries appear in the per-job audit trail view. We fixed job-level snapshot issues but didn't notice workLogs had the same missing-includes problem on `existing`. The fix to one entity type must be applied to all entity types whose audit logs surface in the same view.

**Rule:**
> When fixing audit snapshot issues, check every route that sets `jobId` in `logAudit` — not just `jobs.ts`. Those entries all appear in the job audit trail.

```bash
grep -rn "jobId" backend/src/routes/ | grep "logAudit\|before:\|after:"
```
