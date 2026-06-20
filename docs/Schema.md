# Schema.md — Affinity Workspace

Database: PostgreSQL, accessed via Prisma. This document explains the model relationships, the financial querying strategy, and the immutability patterns that make the 2-year historical-accuracy requirement structurally enforced rather than just policy.

## Models & Relationships

### `User`
Internal team members only (`PM`, `ADMIN`, `ACCOUNTS`, `OWNER`). Holds `hourlyRate` (used to freeze `WorkLog.rateApplied` at log time), magic-link auth fields, and a soft-delete (`deletedAt`). A `User` fans out into several relations: jobs they're assigned as contractor-of-record, work logs they performed or logged on someone else's behalf, audit entries they triggered, communications they logged, and documents they generated.

### `Client`
A client company. Has many `Job` records directly, and is linked to `Property` via `currentClientId` — the property's *current* client, which can change over time (see `PropertyTenantHistory` below for the tenant side of that same problem).

### `Property`
A physical address. Holds the live, current state — current client, current tenant name/phone, access notes, key location — plus a `normalizedAddress` index for matching/search and a `buildingGroupId` for grouping units under one building. Properties have many `Job` records and many `PropertyTenantHistory` records.

### `PropertyTenantHistory`
A separate append-style table tracking tenants over time at a property (`movedIn`/`movedOut`), decoupled from the `Property`'s "current tenant" fields. This is what lets the system answer "who lived here in March 2025" without corrupting the live current-tenant fields used for day-to-day operations.

### `Job`
The central entity — one row per job, foreign-keyed to both `Property` and `Client`. Key relationship-design points:
- `tenantSnapshotName` / `tenantSnapshotPhone` are **frozen at job creation**, deliberately duplicating data that also lives on `Property`/tenant history — see Immutability below.
- `assignedContractorId` links to `User` via the `AssignedContractor` relation (nullable — a job may be unassigned).
- `version` is the optimistic-locking counter used by the state-machine update path.
- Has many `JobMedia`, `WorkLog`, `CommunicationLog`, and `GeneratedDocument` records.
- Indexed on `(status, createdAt)` and `(propertyId, createdAt)` — both reflect the two real query patterns: "list jobs by status" (Job List screen) and "history of jobs at this property."

### `JobMedia`
Diagnostic or completion photos/video, stored as an Object Storage `storageKey` — **never a local filesystem path**, since the app must survive losing the VM. Foreign-keyed to `Job`.

### `WorkLog`
The labor/cost ledger line for a job. Foreign-keyed to `Job`, to the `User` who did the work (`contractorId`), and separately to the `User` who logged it (`loggedById`) — these are frequently different people, since the PM is the one entering data on the contractor's behalf. `rateApplied` is **frozen at log time** (see Immutability). Soft-deletable (`deletedAt`), which the P&L query explicitly filters out.

### `AuditLog`
Append-only activity log. Generic by design — `entityType` + `entityId` + `action` + `before`/`after` JSON blobs — so it can record changes to `Job`, `Property`, `Client`, or `WorkLog` without a separate audit table per entity. Foreign-keyed only to the `User` who performed the action. **No update or delete routes are ever built against this table** — see Immutability.

### `CommunicationLog`
One row per logged communication (call/email/WhatsApp), foreign-keyed to `Job` and to the `User` who performed it. `direction` (`TO_TENANT`/`TO_CLIENT`) and `outcome` (`CONFIRMED`/`NO_RESPONSE`/`SENT`) make this queryable for the Dashboard's "what's outstanding" view. This table is the structural enforcement of "no silent automation" — every communication that happened is provably tied to a PM action.

### `GeneratedDocument`
An immutable record of a generated PDF (Quote / Job Sheet / Completion Report), foreign-keyed to `Job` and to the `User` who generated it. `storageKey` points at the immutable PDF in Object Storage; `snapshotData` is the exact JSON payload used to render that PDF, kept independently of whatever the live `Job` data looks like later. `sentTo` is an optional manual note of where it was sent — not evidence of automated sending.

## Financial Querying Strategy

P&L is deliberately **not** computed in application code by pulling rows and summing in JavaScript. It's a single indexed SQL join-and-aggregate query against `jobs` and `work_logs`:

```sql
SELECT
  j.id,
  j.job_number,
  j.quoted_value AS revenue,
  COALESCE(SUM(w.hours_worked * w.rate_applied), 0) AS labor_cost,
  COALESCE(SUM(w.material_cost), 0) AS material_cost,
  j.quoted_value
    - COALESCE(SUM(w.hours_worked * w.rate_applied), 0)
    - COALESCE(SUM(w.material_cost), 0) AS profit
FROM jobs j
LEFT JOIN work_logs w ON w.job_id = j.id AND w.deleted_at IS NULL
WHERE j.id = $1
GROUP BY j.id;
```

This is the one place raw SQL is used instead of Prisma's query builder (see Rules.md). Two things make this safe and correct rather than just convenient:
- The `job_id` foreign key on `work_logs` makes an orphaned work log **structurally impossible** — Postgres enforces it, the application doesn't have to police it.
- `rateApplied` and `materialCost` are stored per-`WorkLog` row (frozen at entry time), so this aggregation always reflects what was actually charged at the time, not today's hourly rate — a rate change on a `User` record never silently rewrites historical P&L.

## Immutability Patterns

The 2-year historical-accuracy requirement is the reason several patterns appear repeatedly across the schema rather than being one-off decisions:

- **Frozen snapshot fields.** `Job.tenantSnapshotName`/`tenantSnapshotPhone` capture who the tenant was *at job creation*, independent of `Property`'s live current-tenant fields or `PropertyTenantHistory` changing later. Similarly, `WorkLog.rateApplied` freezes the contractor's rate at the moment the work was logged, independent of `User.hourlyRate` changing afterward. The pattern: anything that feeds a financial or compliance record gets copied at the moment of the event, not referenced live.
- **Append-only `AuditLog`.** No update or delete routes are ever built against it, by rule (see Rules.md) — it can only grow. `before`/`after` JSON snapshots on each row mean the full change history of any entity is reconstructable without needing point-in-time database snapshots.
- **Immutable generated documents.** Once a `GeneratedDocument` PDF is generated, it is never regenerated in place or edited — a new quote revision is a new `GeneratedDocument` row, not a mutation of an old one. `snapshotData` preserves exactly what was used to render it.
- **Soft deletes.** `User`, `Client`, `Property`, and `WorkLog` all use `deletedAt` rather than hard deletes, so historical jobs/work logs referencing a "deleted" client or contractor remain fully intact and queryable.
- **Optimistic locking, not a separate concern, but related.** `Job.version` exists to prevent concurrent-edit data corruption — a different problem from historical immutability, but it shares the same underlying value: the data, once written, should reflect a true and unambiguous sequence of events.
