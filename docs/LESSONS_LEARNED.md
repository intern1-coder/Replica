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

---

## 9. Misleading profile affordance hides Logout

**Where it happened:** `frontend/src/components/AppShell.tsx`

**What went wrong:**
The sidebar showed a profile card with user name, avatar, and a `ChevronDown` icon — but the card was a static `<div>` with no click handler. New users assumed it opened account options. Logout was only reachable via the small header avatar (top-right), which is easy to miss. Change password was duplicated in the sidebar footer and header menu with no shared component.

**Rule:**
> Any profile affordance with a chevron or dropdown visual cue **must** be a real `<button>` that opens an account menu (Change password + Logout). If the sidebar shows a profile card, wire it first — do not rely on header-only logout. Share one menu component across sidebar and header entry points.

```tsx
// WRONG — chevron implies menu, but nothing happens
<div>
  <UserAvatar /> Admin User <ChevronDown />
</div>

// CORRECT — profile card opens account menu
<button aria-haspopup="menu" aria-expanded={open} onClick={toggleMenu}>
  <UserAvatar /> Admin User <ChevronDown className={open ? 'open' : ''} />
</button>
{open && <AccountMenuPanel onChangePassword={...} onLogout={...} />}
```

See also: `.claude/AGENTS.md`, `frontend/AGENTS.md` (Account / AppShell section).

---

## 10. Job media upload/delete must use the same storage backend

**Where it happened:** `storageService.ts`, `JobMedia.tsx`

**What went wrong:**
Local dev uses placeholder OCI credentials, so uploads went to disk (`uploads/`) but delete still called S3 → `SignatureDoesNotMatch` 500. Upload also added items twice (HTTP response + socket event). Image previews used absolute `http://localhost:3000/uploads/...` from the frontend origin → `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`.

**Rule:**
> Upload, signed-URL generation, and delete **must** share one `usesLocalStorage()` check. Use relative `/uploads/...` URLs in dev (Vite/Caddy proxy). Skip socket self-updates with `actorId`. Dedupe list updates with `prependById`. Block placeholder storage in production at startup.

---

## 11. Admin bootstrap script must be in the Docker image and run inside the container

**Where it happened:** Production deploy, July 2026 (`SUPER_ADMIN` role rollout)

**What went wrong:**

1. **`scripts/bootstrap-users.ts` was not copied into the production Docker image.** The Dockerfile only copied `dist/`, `prisma/`, and `templates/`. Running `docker compose exec app npx tsx scripts/bootstrap-users.ts` failed with `ERR_MODULE_NOT_FOUND: /app/scripts/bootstrap-users.ts`.

2. **Docs initially said `npm run bootstrap:users` on the host.** That only works in local dev. On the server, the script must run **inside** the `app` container where `DATABASE_URL` points at the `db` service.

3. **Bootstrap env vars were in `.env` but not passed into the container.** `docker-compose.yml` must list `SUPER_ADMIN_*` and `CLIENT_ADMIN_*` in the `environment:` block (with `${VAR}` substitution) or the exec'd process won't see them.

4. **Migration count mismatch (6 vs 7) with "No pending migrations".** The server hadn't pulled the branch containing `20260706100000_add_super_admin_role`. Old code + old migration list = silent skip of the new enum value.

5. **`docker compose up -d` without `--build` after a pull.** Reused the old image; even after fixing the Dockerfile locally, production kept the image without `scripts/` until `--build` was run.

6. **Local dev: `Value 'SUPER_ADMIN' not found in enum 'Role'` on login.** DB had the new role (bootstrap/migration ran) but Prisma Client wasn't regenerated — often blocked on Windows by `EPERM` while `npm run dev` holds the query engine DLL. Fix: stop backend → `npx prisma generate` → restart.

**Rules:**

> - Any new file under `backend/scripts/` that must run in production **must** be added to the Dockerfile production stage (`COPY --from=builder /app/scripts ./scripts`).
> - Document bootstrap as **`docker compose exec app npx tsx scripts/bootstrap-users.ts`**, never host-only `npm run`.
> - Pass bootstrap env vars through `docker-compose.yml` `environment:` from `.env`.
> - Deploy order: **`git pull` → `docker compose up -d --build` → `prisma migrate deploy` → bootstrap (if needed) → frontend build**.
> - `.env` bootstrap passwords are **install/recovery defaults only**; after users change passwords in the app, the database is the source of truth. Re-running bootstrap overwrites those two accounts.

**Correct production bootstrap output:**

```
✓ Super Admin: admin@example.local (SUPER_ADMIN)
✓ Client Admin: fahd@affinityproperty.co.uk (ADMIN)
Bootstrap complete.
```

See also: `docs/DEPLOY.md` §6, `backend/.env.example`, `backend/Dockerfile`.

---

## 12. Two “main” branches caused duplicate PRs and confused CI

**Where it happened:** GitHub repo setup, July 2026 (through PR #17)

**What went wrong:**

1. **GitHub default branch was `feature/pdf-cleanups-engineers`** while production deploy, CI, and docs all used **`master`**. New PRs often targeted the wrong base; the same work was merged twice (e.g. PR #16 → `master`, then PR #17 “Master” → sync into `feature/pdf-cleanups-engineers`).

2. **Long-lived feature branches were kept after merge** (`feature/super-admin-role`, `fix/unify-brand-icons`, etc.), cluttering the Branches page and suggesting open work when everything was already on `master`.

3. **Looked like “2 pipelines for 1 change”.** CI on `pull_request` plus CI on `push` to `master` after merge is normal. The real waste was **two PRs** for the same feature because of the dual-branch habit.

**Rules:**

> - **One trunk:** `master` only. GitHub default branch = CI target = `git pull` on the server = deploy source. All three must match.
> - **Short-lived branches:** `fix/…` or `feat/…` off `master` → **one PR into `master`** → merge → **delete the branch** (local + remote).
> - **Never** open “sync `master` into feature/X” PRs. Never merge the same feature to two long-lived branches.
> - Before creating a PR, confirm base branch is **`master`** (especially after changing the default branch in Settings).

**Cleanup (one-time, after fixing default branch):**

```bash
git push origin --delete fix/unify-brand-icons feature/pwa-and-client-restore feature/super-admin-role feature/pdf-cleanups-engineers
git checkout master && git pull && git fetch --prune
```

See also: `docs/CI.md` (branch workflow), `docs/DEPLOY.md` (ongoing deploy checklist), `.github/pull_request_template.md` (server commands shown on every new PR).

---

## 13. July 2026 session — UI/PDF fixes, repo cleanup, and deploy discipline

**Where it happened:** Local dev + GitHub, July 2026 (PR #18, #19)

### What we built (PR #18)

| Area | Fix |
|------|-----|
| Property autocomplete | Stopped duplicate `/clients` / `/properties` requests (unstable `labelKey` in effect deps) |
| Contractor dropdown | Dark-mode react-select theming (`reactSelectTheme.ts`) |
| PDF footers | Removed inline footer from templates; Puppeteer footer only (one per page) |
| PDF speed | Reuse Chromium browser, cache templates, parallel image fetch |
| Auto logout | Only clear session on **401**; retry transient `/auth/me` failures |
| Test data reset | `scripts/reset-test-data.ts` — wipes operational data, keeps users/settings |
| Docker | `JWT_EXPIRES_IN` passed through `docker-compose.yml` |

### What we fixed (repo / process)

| Mistake | Fix |
|---------|-----|
| GitHub default branch was `feature/pdf-cleanups-engineers`, deploy used `master` | Changed default branch to **`master`** |
| Same feature merged via two PRs (#16 then #17 “Master” sync) | **One PR → master only**; deleted stale remote branches |
| Merged branches left on GitHub (confusing Branches page) | `git push origin --delete` for old feature/fix branches |
| No server commands visible at PR time | Added `.github/pull_request_template.md` with copy-paste deploy block |
| Deploy checklist said `git pull origin <branch>` | Fixed to **`git pull origin master`** always |

### Rules

> - **Merging a PR does not deploy production.** After every merge to `master`, SSH to the server and run the deploy block (in the PR template or `docs/DEPLOY.md`).
> - **CI green ≠ deployed.** GitHub Actions tests the code; the EC2 box only updates when you `git pull` + rebuild there.
> - **Delete the PR branch** after merge (`fix/…` / `docs/…` should not accumulate on GitHub).

See also: PR #18, PR #19, `docs/CI.md`, `.github/pull_request_template.md`.

---

## 14. July 2026 — production audit, git history rewrite, and a scripts/src Docker gap

**Where it happened:** Production readiness audit + fixes, and a live data-wipe request, July 2026.

### What we built (worth reusing)

| Pattern | Where |
|---------|-------|
| Destructive scripts default to a dry run and require an explicit confirm token | `scripts/reset-test-data.ts` — prints row counts and changes nothing unless `RESET_CONFIRM=DELETE_ALL_DATA` is set |
| Storage cleanup happens *after* the DB transaction commits, best-effort, with failures logged and counted | same script — DB-first ordering means a re-run can't make things worse |
| Verify Docker/permission changes against the **real, built artifact**, not static review | `.dockerignore` and this session's `src/` fix were both confirmed with an actual `docker build` + a module-resolution check inside the built image, not just reading the Dockerfile |
| Rewrite git history in an **isolated mirror clone**, verify fully, then push | `git clone --mirror` → `git filter-repo` → `git log --all` sanity check → push, instead of touching the working repo's history directly |
| Optimistic-lock / permission-gate changes get their own test file before being called done | `jobs.assignment.test.ts`, `permissionGating.test.ts`, `resolveAuthenticatedUser.test.ts` |

### What went wrong

1. **`reset-test-data.ts` imported from `src/services/storageService`, but the production image never copied `src/`.** The Dockerfile's production stage only copied `dist/`, `prisma/`, `scripts/`, `templates/`, `assets/` (per lesson #11). `bootstrap-users.ts` only needs `@prisma/client`, so it never hit this. `reset-test-data.ts` and `seed-dummy-data.ts` both reach into `src/` (storageService, utils) — this wasn't caught by `tsc`/`jest` (both run against the full local source tree) or by the earlier `.dockerignore` verification (which checked what was *excluded*, not what a *new* script needed *included*). It only surfaced when the script was actually run inside the production container: `MODULE_NOT_FOUND: /app/scripts/../src/services/storageService`.

2. **Rewriting git history left the EC2 server's clone silently stale.** After `git filter-repo` + force-push, the server still had the old, abandoned commit history. `git pull` there didn't loudly fail — it appeared to run, but the frontend/backend never actually changed, which looked like "the deploy didn't work" rather than "the pull didn't update anything." The fix (`git fetch && git reset --hard origin/master`) was already documented in `docs/PRODUCTION_GAPS.md` and project memory, but it still cost a debugging round-trip because the symptom (no visible changes) didn't point directly at the cause (stale/diverged history).

**Rules:**

> - **Any script under `backend/scripts/` that imports from `src/` needs `src/` in the production Dockerfile**, not just the script itself (extends lesson #11's rule, which only covered `scripts/` itself). Check a new script's imports against what the production stage actually copies before considering it deploy-ready — `tsc --noEmit` and `jest` both run against the full source tree locally and will NOT catch this.
> - **After any git history rewrite (`filter-repo`, etc.), every existing clone is stale until manually reconciled** — a plain `git pull` on an old clone can silently no-op or refuse rather than erroring in an obviously diagnosable way. If a deploy "did nothing" right after a history rewrite, check for diverged history before anything else.
> - **Verify infra changes (Docker, permissions, scripts) by actually running them**, not by reading the config — a real `docker build` + running the built artifact catches gaps that reading the Dockerfile does not.

See also: `docs/PRODUCTION_GAPS.md` (H2/H4/H5/H6/H7/H8), `backend/Dockerfile`, `backend/scripts/reset-test-data.ts`.

**Outcome:** after the `src/` fix was deployed, the dry run printed correct, sane counts (8 jobs, 10 clients, 8 properties, 3 tenants, 10 engineers, 29 media files, 15 generated documents), and the real wipe (`RESET_CONFIRM=DELETE_ALL_DATA`) completed successfully in production — 4 users and 1 setting confirmed preserved untouched. The dry-run-first design did exactly its job: it surfaced the `MODULE_NOT_FOUND` bug on a **read-only** run, before any destructive command was ever executed against real data.
