# Manual Test Cases — Job Status Counts

**Feature:** Add a count for each job status (To Be Checked, Checked, Quoted, Authorised, etc.) so we can see how many jobs are under each status.

**Endpoint:** `GET /api/jobs/counts` (guard: `jobs:view`)
**UI surfaces:** Jobs page status chips, Jobs page tab pills, Dashboard "Job Pipeline" panel, sidebar "Job Pipeline" badge

---

## Test environment

| Item | Value |
| --- | --- |
| App URL | http://localhost:5173 |
| API | http://localhost:3000/api |
| Super Admin | `it@vlookup.co.in` / `SuperAdmin@123` |
| Client Admin | `fahd@affinityproperty.co.uk` / `ClientAdmin@123` |
| PM (demo) | `pm@affinityproperty.co.uk` / `DemoUser@123` |
| Contractor (demo) | `contractor@affinityproperty.co.uk` / `DemoUser@123` |
| Stalled threshold | 5 days (`stalledDays: 5`) |
| Flow window | 7 days (`flow7d`) |

**Statuses:** `TO_BE_CHECKED`, `CHECKED`, `QUOTED`, `AUTHORISED`, `PENDING_INVOICE`, `COMPLETED`, `CANCELLED`

---

## Section A — API: `GET /api/jobs/counts`

### A1 — Unauthenticated request is rejected
- **Steps:** `GET /api/jobs/counts` with no `Authorization` header (curl/Postman).
- **Expected:** `401 Unauthorized`. No counts body returned.

### A2 — Authenticated user with `jobs:view` gets counts
- **Steps:** Log in as Super Admin → `GET /api/jobs/counts` with Bearer token.
- **Expected:** `200 OK` with JSON body containing `byStatus`, `byTab`, `stalled`, `flow7d`, `stalledDays`.

### A3 — Response shape is complete and zero-filled
- **Steps:** Call endpoint as Super Admin; inspect JSON.
- **Expected:**
  - `byStatus` has a key for **every** status (`TO_BE_CHECKED`, `CHECKED`, `QUOTED`, `AUTHORISED`, `PENDING_INVOICE`, `COMPLETED`, `CANCELLED`), each a number ≥ 0 (statuses with no jobs are `0`, not missing).
  - `byTab` has `active`, `completed`, `cancelled`, `archived` (numbers).
  - `stalled` has a key for every status (numbers ≥ 0).
  - `flow7d` has a key for every status (numbers ≥ 0).
  - `stalledDays` is `5`.

### A4 — `byTab.active` equals sum of non-terminal statuses
- **Steps:** From `byStatus`, sum `TO_BE_CHECKED + CHECKED + QUOTED + AUTHORISED + PENDING_INVOICE`. Compare to `byTab.active`.
- **Expected:** Equal. `COMPLETED` and `CANCELLED` are **not** included in `active`.

### A5 — `byTab.completed` / `byTab.cancelled` match `byStatus`
- **Steps:** Compare `byTab.completed` vs `byStatus.COMPLETED`; `byTab.cancelled` vs `byStatus.CANCELLED`.
- **Expected:** Equal.

### A6 — Archived jobs are excluded from `byStatus` and `byTab.active`
- **Steps:** Ensure at least one job is archived (deleted). Call endpoint. Compare `byStatus` totals vs non-archived job count; check `byTab.archived`.
- **Expected:** Archived jobs do **not** inflate `byStatus` any status or `byTab.active`. They appear only in `byTab.archived`.

### A7 — User without `jobs:delete` sees `archived: 0`
- **Steps:** Call as a user who has `jobs:view` but not `jobs:delete` (if available), or temporarily revoke `jobs:delete`.
- **Expected:** `byTab.archived` is `0` even if archived jobs exist (hides existence).

### A8 — Stalled counts only active statuses with stale `updatedAt`
- **Steps:** Ensure a job sits in an active status (e.g. `CHECKED`) untouched for ≥ 5 days.
- **Expected:** `stalled[CHECKED]` ≥ 1. Jobs updated within the last 5 days are not stalled.

### A9 — Completed / cancelled never counted as stalled
- **Steps:** Ensure `COMPLETED` / `CANCELLED` jobs have `updatedAt` older than 5 days.
- **Expected:** `stalled.COMPLETED` and `stalled.CANCELLED` are `0`.

### A10 — Archived jobs never counted as stalled
- **Steps:** Ensure an archived job has stale `updatedAt`.
- **Expected:** Not in any `stalled[...]` count.

### A11 — `flow7d` counts real status transitions in last 7 days
- **Steps:** Move a job `TO_BE_CHECKED → CHECKED` (valid transition) within 7 days. Call endpoint.
- **Expected:** `flow7d.CHECKED` includes that transition. Non-transition job updates (e.g. edit notes without status change) do not increment `flow7d`.

### A12 — Repeated transitions accumulate
- **Steps:** Move two different jobs into `QUOTED` within 7 days.
- **Expected:** `flow7d.QUOTED` is `2` (one per transition).

### A13 — Permission denied when `jobs:view` revoked
- **Steps:** Revoke all `jobs:*` permissions on a user (view must stay revoked with mutations) → call endpoint.
- **Expected:** `403 Forbidden`. No counts returned.

---

## Section B — Jobs page: status count chips

> Chips shown: **To Be Checked**, **Checked**, **Quoted**, **Authorised** (exactly four).

### B1 — Chips render with counts on Jobs page
- **Steps:** Log in → navigate to **Job Pipeline** (`/jobs`).
- **Expected:** Four chips visible: `To Be Checked`, `Checked`, `Quoted`, `Authorised`. Each shows a numeric count matching `byStatus` for that status.

### B2 — Chip counts match API
- **Steps:** Note chip numbers → compare to `GET /api/jobs/counts` → `byStatus`.
- **Expected:** Exact match for all four chips.

### B3 — Chip with zero count still visible (zero state)
- **Steps:** Find a status among the four with `0` jobs (or clear data for one).
- **Expected:** Chip still renders; count shows `0`; chip has zero/disabled styling (`.zero`). Not hidden.

### B4 — Chip row visible on Active tab
- **Steps:** Ensure Active tab selected (default).
- **Expected:** Chip row present.

### B5 — Chip row visible on Completed / Not Proceeding / Archived tabs
- **Steps:** Click **Completed**, then **Not Proceeding**, then **Archived** (if permitted).
- **Expected:** Chip row remains visible on each tab (not gated to Active only).

### B6 — Clicking a chip filters the list to that status
- **Steps:** Click **Checked** chip.
- **Expected:**
  - Tab switches to **Active**.
  - Chip becomes selected (`aria-pressed="true"`, `.selected` style).
  - Job list shows only `CHECKED` jobs.
  - Page resets to page 1.

### B7 — Clicking selected chip clears the filter (toggle off)
- **Steps:** Click **Checked** (selected) again.
- **Expected:** Chip deselects; status filter clears; full Active list returns; page resets to 1.

### B8 — Clear button appears when a chip filter is active
- **Steps:** Select any chip → look at chip row.
- **Expected:** A **Clear** button appears. Clicking it removes the status filter and deselects the chip.

### B9 — Switching tab while chip selected resets selection state
- **Steps:** Select **Quoted** chip → click **Completed** tab.
- **Expected:** Chip no longer shows as selected (selection only applies on Active tab). List shows completed jobs.

### B10 — Chip counts refresh after a status change (same session)
- **Steps:** Open Jobs page → note counts → open a `TO_BE_CHECKED` job in a second tab/window → advance status to `CHECKED` → return to Jobs list.
- **Expected:** Within ~300ms (debounced), **To Be Checked** count decreases by 1 and **Checked** count increases by 1 without full-page reload.

### B11 — Chip counts refresh on another user's status change (live)
- **Steps:** Log in as User A on Jobs page. Log in as User B (second browser) → change a job status. Watch User A.
- **Expected:** User A's chip counts update live via socket (no manual refresh). No loading spinner / list flash.

### B12 — Chip counts update after archive / restore
- **Steps:** Archive a job in `CHECKED` → observe chips; restore it → observe chips.
- **Expected:** `Checked` count drops on archive (archived excluded from `byStatus`); restores on un-archive. Tab pill counts update too.

---

## Section C — Jobs page: tab pill counts

### C1 — Tab pills show counts
- **Steps:** Open `/jobs`.
- **Expected:** Pills show: **Active**, **Completed**, **Not Proceeding**, and **Archived** (Archived only if user has `jobs:delete`), each with a numeric count.

### C2 — Tab counts match API `byTab`
- **Steps:** Compare pill numbers to `byTab.active`, `byTab.completed`, `byTab.cancelled`, `byTab.archived`.
- **Expected:** Exact match.

### C3 — Active pill = sum of all non-terminal statuses
- **Steps:** Verify Active count vs sum of all active statuses (including Pending Invoice, not just the four chips).
- **Expected:** Equal.

### C4 — Archived tab hidden without `jobs:delete`
- **Steps:** Use a user without `jobs:delete`.
- **Expected:** Archived pill not shown. `byTab.archived` is 0 in API.

### C5 — Switching tabs filters list correctly and keeps count visible
- **Steps:** Click **Completed** → list shows completed jobs; count pill still visible.
- **Expected:** List matches tab; pill count remains accurate.

### C6 — Tab count updates after status move
- **Steps:** Move a job `AUTHORISED → PENDING_INVOICE` (or complete a job) → watch tab pills.
- **Expected:** Active/Completed counts adjust within ~300ms without reload.

---

## Section D — Dashboard: Job Pipeline panel

### D1 — Pipeline panel renders with one row per status
- **Steps:** Open **Dashboard**.
- **Expected:** "Job Pipeline" panel shows a row for each pipeline status (To Be Checked, Checked, Quoted, Authorised, Pending Invoice, Completed, Cancelled) with label + count.

### D2 — Counts match API `byStatus`
- **Steps:** Compare each row's count to `GET /api/jobs/counts` → `byStatus`.
- **Expected:** Exact match for every row.

### D3 — Bar width scales relative to the maximum count
- **Steps:** Note the status with the highest count.
- **Expected:** That row's bar is ~100% of track width; other bars are proportionally shorter (`count / max`). Zero-count rows show empty/zero-width bar but count `0` still visible.

### D4 — Status colors applied to bars (not neutral)
- **Steps:** Inspect each pipeline bar.
- **Expected:** Each bar uses its status color (e.g. Checked ≠ Quoted ≠ Authorised). Not all bars the same neutral color.

### D5 — Flow delta shows "↑N this week" when transitions occurred in 7 days
- **Steps:** Ensure ≥1 transition into a status within 7 days → view panel.
- **Expected:** Row shows `↑N this week` matching `flow7d[status]`. Plural/singular not required; format is `↑N this week`.

### D6 — No delta text when zero flow
- **Steps:** Find a status with `flow7d = 0`.
- **Expected:** Empty delta span — no `↑0 this week`.

### D7 — Stalled callout appears when stalled total > 0
- **Steps:** Ensure ≥1 active job untouched ≥5 days → view Dashboard.
- **Expected:** Note reads: `N job(s) have been untouched for 5+ days.` with **Review stalled jobs** link. Grammar: `1 job has…` vs `2 jobs have…`.

### D8 — Stalled callout hidden when zero stalled
- **Steps:** Ensure no stalled jobs → view Dashboard.
- **Expected:** No stalled note rendered.

### D9 — Stalled link navigates to Jobs page
- **Steps:** Click **Review stalled jobs**.
- **Expected:** Navigates to `/jobs`.

### D10 — "View all jobs" navigates to Jobs
- **Steps:** Click **View all jobs** in pipeline panel header.
- **Expected:** Navigates to `/jobs`.

### D11 — Pipeline counts refresh live on status change
- **Steps:** Leave Dashboard open; change a job status from another tab/user.
- **Expected:** Bar counts (and delta if applicable) update within ~300ms without full page reload or loading swap.

---

## Section E — Sidebar badge

### E1 — Badge shows active job count when logged in
- **Steps:** Log in → look at sidebar **Job Pipeline** nav item.
- **Expected:** Badge displays `byTab.active` count (number ≥ 0, or hidden if null/0 per design — if shown, matches Active tab pill).

### E2 — Badge matches Active tab count
- **Steps:** Compare sidebar badge number to Jobs page **Active** pill.
- **Expected:** Equal.

### E3 — Badge hidden / absent when logged out
- **Steps:** Log out.
- **Expected:** No job count badge on nav (or nav not shown). No error/console noise.

### E4 — Badge refreshes on status change
- **Steps:** Leave app open; change a job from Active → Completed (active count decreases).
- **Expected:** Badge number updates within ~300ms without reload.

### E5 — Badge survives navigation between pages
- **Steps:** Navigate Dashboard → Clients → Properties → back to Jobs.
- **Expected:** Badge remains correct (not cleared/stale on route change).

---

## Section F — Permissions & roles

### F1 — Super Admin sees all surfaces
- **Steps:** Log in as Super Admin → Jobs, Dashboard, sidebar.
- **Expected:** Chips, tab pills (incl. Archived), pipeline panel, badge all render with correct counts.

### F2 — Client Admin sees counts (if granted `jobs:view`)
- **Steps:** Log in as Client Admin → `/jobs`.
- **Expected:** Chips and tab pills render if user has `jobs:view`; counts correct. Archived pill only if `jobs:delete`.

### F3 — User without `jobs:view` cannot load counts
- **Steps:** Revoke `jobs:view` → open Jobs page / call API.
- **Expected:** API `403`. Chips do not populate (graceful — list may still error per page permission). No crash.

### F4 — Revoking `jobs:delete` hides archived count/pill
- **Steps:** User has `jobs:view` but not `jobs:delete`.
- **Expected:** Archived tab pill hidden; API `byTab.archived = 0`.

---

## Section G — Edge cases & non-functional

### G1 — Empty database / no jobs
- **Steps:** Call endpoint with zero jobs (or filter to empty state).
- **Expected:** All `byStatus` / `stalled` / `flow7d` values `0`; `byTab` zeros; UI chips show `0`; no `NaN`, `undefined`, or crash.

### G2 — Large counts render correctly
- **Steps:** Seed/create jobs so a status has ≥100 (or 1000) jobs.
- **Expected:** Chip/tab/badge/pipeline numbers format cleanly; bar width clamps at 100%; no layout overflow.

### G3 — Concurrent status changes (burst)
- **Steps:** Change several job statuses in quick succession (or multiple users).
- **Expected:** Counts settle to correct final value; debounced refetch (~300ms) — no request storm visible in network tab beyond debounced calls; UI does not flicker with loading states.

### G4 — Background refresh does not block UI
- **Steps:** While counts refresh (status change), interact with search/date filters on Jobs page.
- **Expected:** No `Loading jobs...` full-swap on background count refresh; filters remain interactive; no form reset.

### G5 — Invalid/blocked status transition does not change counts
- **Steps:** Attempt an illegal transition (e.g. `TO_BE_CHECKED → QUOTED` skipping Checked) via UI/API.
- **Expected:** Transition rejected; counts unchanged.

### G6 — Dark mode readability
- **Steps:** Toggle dark mode → Jobs chips, tab pills, Dashboard pipeline, sidebar badge.
- **Expected:** Counts and labels meet contrast; status colors remain distinguishable; no invisible text.

### G7 — Mobile / narrow viewport
- **Steps:** Resize to mobile width → Jobs chip row and Dashboard pipeline.
- **Expected:** Chips wrap/scroll without clipping counts; pipeline rows remain readable (stacked layout if defined); no horizontal overflow of numbers.

### G8 — Console clean on load
- **Steps:** Open Jobs + Dashboard with DevTools console open.
- **Expected:** No uncaught errors/warnings from counts rendering (e.g. missing `counts` before load handled).

---

## Section H — Regression (surrounding features still work)

### H1 — Job list still loads if counts endpoint fails
- **Steps:** Block `/api/jobs/counts` (DevTools network block) → open Jobs.
- **Expected:** Job list still loads (counts are progressive enhancement). Chips may show `0` or be absent — no hard failure of the page.

### H2 — Status badge colors in table unchanged
- **Steps:** View job list status column / detail status badge.
- **Expected:** Existing `.status-badge` colors unchanged (feature kept neutral chips only; table badges still status-colored).

### H3 — Status change still emits socket and updates detail page
- **Steps:** Change status on Job Detail → observe audit trail / list.
- **Expected:** Status persists; `job:statusChanged` still fires; existing detail-page behavior unchanged.

---

## Execution sign-off

| Section | Cases | Pass | Fail | N/A | Tester | Date |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| A — API | 13 | | | | | |
| B — Status chips | 12 | | | | | |
| C — Tab pills | 6 | | | | | |
| D — Dashboard pipeline | 11 | | | | | |
| E — Sidebar badge | 5 | | | | | |
| F — Permissions | 4 | | | | | |
| G — Edge / NFR | 8 | | | | | |
| H — Regression | 3 | | | | | |
| **Total** | **62** | | | | | |

**Notes / defects:**
- _(fill during execution)_
