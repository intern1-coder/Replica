# PRD — Affinity Workspace

**Status:** Living document — last updated 2026-07-01.  
Update this file when scope changes. Source of truth for what the product is and why.

---

## 1. Problem & Goal

Affinity runs job/property/contractor tracking off a spreadsheet ("MLDB") plus a separate "Daily Schedule" sheet. This breaks down under concurrent editing, has no audit trail, and requires manual document creation (quotes, job sheets, completion reports). Affinity Workspace replaces both with a single internal web app that is **faster to scan than the spreadsheet it replaces**, not just "more modern."

---

## 2. Users

**~20 internal users.** Fixed team, roles:

| Role | Capability |
|---|---|
| `PM` | Primary data-entry role — creates/advances jobs, logs work, uploads media, logs comms, generates documents. Sole gatekeeper for all state changes. |
| `ADMIN` | All PM capabilities + user management + settings. |
| `ACCOUNTS` | Read access to P&L and job data for financial reporting. |
| `OWNER` | Read-only overview. |
| `CONTRACTOR` | Schema placeholder only — **no contractor-facing login or UI in this version.** All contractor data is entered by the PM. |

No public signup. Users are provisioned by an admin directly in the system.

---

## 3. Core Principle — "PM as Sole Gatekeeper"

Nothing changes in the system, and no communication leaves it, without an explicit PM action:
- No automated client/tenant emails, WhatsApp, or notifications — every outbound touch is logged manually in `CommunicationLog` with an outcome (`CONFIRMED`, `NO_RESPONSE`, `SENT`).
- Documents (Quote, Job Sheet, Completion Report) are generated as immutable PDFs on explicit request; sending them to the client is a manual, out-of-band step.
- Every job state change, document generation, and communication is permanently recorded in `AuditLog`.

---

## 4. Authentication

- **Magic-link only.** PM enters email → one-time token emailed via Brevo/Resend (port 587) → click exchanges token for a JWT session (7-day expiry).
- **No self-service signup.** Admin provisions users.
- **Change-password flow** available as a supplementary path for internal credential management (`PasswordResetToken`).

---

## 5. Core Entities

| Entity | Purpose | Key design decision |
|---|---|---|
| `User` | Internal team members | `hourlyRate` frozen into `WorkLog.rateApplied` at entry time — rate changes never rewrite history |
| `Client` | Client companies | Soft delete; historical jobs preserved |
| `Property` | Physical addresses | `normalizedAddress` for fuzzy search; `currentClientId` for live state |
| `PropertyTenantHistory` | Tenant history over time | Append-only; decoupled from live `Property` tenant fields |
| `Job` | Central work record | `tenantSnapshot*` frozen at creation; `version` for optimistic lock |
| `JobMedia` | Photos/video per job | `storageKey` only — never a local path |
| `WorkLog` | Labor/materials per job | `rateApplied` frozen at entry; soft delete |
| `CommunicationLog` | Every PM-initiated communication | Direction + outcome; structural proof nothing was automated |
| `AuditLog` | Append-only change history | `before`/`after` JSON; no update/delete routes ever built |
| `GeneratedDocument` | Immutable PDF records | `snapshotData` preserves the exact render payload |
| `Engineer` | Field engineers (separate from internal Users) | Linked to jobs for assignment |
| `JobQuoteLineItem` | Line items on a quote | Structured quote breakdown |
| `FollowUpReminder` | Reminders on jobs | Status-tracked; drives notification center |
| `Setting` | System-wide config | Admin-managed key/value store |
| `PasswordResetToken` | Reset token for password change flow | Short-lived, one-time use |

---

## 6. Job State Machine

```
TO_BE_CHECKED → CHECKED → QUOTED → AUTHORISED → COMPLETED
                                              ↘ CANCELLED
```

- `CANCELLED` reachable from any active state.
- Transitions enforced server-side in `services/jobStateMachine.ts` — invalid transitions rejected with `422`.
- **Optimistic locking** on `Job.version`: status update only succeeds if client version matches DB, preventing silent concurrent clobbers.
- Every transition writes an `AuditLog` entry with `before`/`after` snapshots — backs the Dashboard feed and the 2-year audit-history requirement.

---

## 7. Core Screens

| Screen | Purpose |
|---|---|
| Dashboard | "What needs PM attention today" — computed over `AuditLog` + `CommunicationLog` + `Job` |
| Job Pipeline | Dense, filterable/searchable table by status, date, job#, address, client |
| Job Detail | Hub for one job: status control, notes, contractor/engineer, media, work logs, comms log, P&L, documents, audit timeline |
| Logistics Grid | Daily schedule from `WorkLog` — replaces the Daily Schedule spreadsheet |
| Clients | Client company CRUD |
| Properties | Property CRUD, tenant history, access/key notes |
| P&L View | Per-job and rollup profit via raw SQL over `Job` + `WorkLog` |
| Engineers | Field engineer management (admin) |
| Users | Internal user management (admin) |
| Settings | System-wide configuration (admin) |
| Notifications | In-app follow-up reminder center |

---

## 8. Design Constraints

- **Tables over cards** everywhere a list is shown. Compact row height. Tabular figures for all numeric columns.
- **Status color is the primary visual signal** — reserved for job status only, never reused decoratively:

| Status | Color |
|---|---|
| `TO_BE_CHECKED` | Neutral grey |
| `CHECKED` | Blue |
| `QUOTED` | Amber / orange |
| `AUTHORISED` | Green |
| `COMPLETED` | Muted teal |
| `CANCELLED` | Muted red |

- Status always shown as color **and** text label — never color alone.
- Optimized for daily-user scan speed, not first-time delight.
- Desktop-first (back-office tool); mobile/tablet must remain usable.

---

## 9. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Concurrent users | ~20 (internal team) |
| Audit retention | 2 years minimum |
| Max data loss on VM failure | 24 hours (nightly backup) |
| API request timeout | 30 seconds → 503 |
| PDF concurrency | Max 2 simultaneous Chromium renders |
| Rate limiting — global | 100 req / 15 min / IP |
| Rate limiting — search endpoints | 300 req / 15 min / IP (separate budget) |
| Rate limiting — auth endpoints | 10 req / 15 min / IP |
| DB connection pool | 15 connections |
| Search debounce (frontend) | 300ms |
| Graceful shutdown | 30-second drain before force-exit |

---

## 10. Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20 + Express 4 + TypeScript |
| ORM | Prisma 5 + PostgreSQL 15 |
| Realtime | Socket.io (live job/status updates across sessions) |
| PDF | Puppeteer-core + ARM Chromium (`apt install chromium`) |
| File storage | OCI Object Storage via `@aws-sdk/client-s3` (S3-compatible) |
| Email | Nodemailer via Brevo/Resend SMTP (port 587) |
| Search | Fuse.js fuzzy search (clients, properties, tenants) |
| Logging | Winston + Morgan (structured, daily-rotate; no PII in logs) |
| Frontend | React 19 + TypeScript + Vite + React Router 7 |
| Animations | Motion (Framer Motion successor) |
| Auth | JWT + magic-link + password-reset-token |
| Permissions | Role-based (`lib/permissions.ts`, `lib/rolePermissions.ts`) |

---

## 11. Infrastructure & Deployment

**Hosting:** Oracle Cloud Free Tier — Ampere A1 ARM VM (2 OCPU / 12 GB RAM for this app; another 2 OCPU / 12 GB reserved for a future second app).

**Stack on VM:**
```
Internet
  → Caddy (TLS via Let's Encrypt, auto-HTTPS)
      → /api/* and /socket.io/* → active-upstream.caddy (blue or green)
          → app_blue  (127.0.0.1:3001)  ─┐  one active at a time
          → app_green (127.0.0.1:3002) ─┘
              → PostgreSQL (Docker, named volume — never touched on app deploy)
      → /* → /app/frontend/dist (SPA, try_files fallback)
```

**Zero-downtime blue-green deploys:**
1. CI builds ARM64 image → pushes to GHCR on every merge to `master`
2. `scripts/deploy.sh <tag>` on the VM: pull → pg_dump backup → gated `prisma migrate deploy` → start standby → health-gate (30s) → **NODE_ENV=production gate** (aborts if not set, keeping raw query logging off) → flip Caddy → stop old container
3. `scripts/rollback.sh` restores the stopped previous container in seconds
4. Manual trigger via GitHub Actions UI (`workflow_dispatch`) or direct SSH

**CI pipeline (`.github/workflows/ci.yml`):**
- Runs on every push and PR to `master`
- Backend: `tsc` build + `check:log-pii` guard + `prisma migrate` + `jest` (against real Postgres 15)
- Frontend: `tsc` + `vite build`
- Deploy workflow runs a preflight job (build + `check:log-pii`) that gates the SSH deploy
- Branch protection on `master`: CI must pass before merge

**Database backups (`services/backupService.ts`):**
- Nightly `pg_dump | gzip` → OCI `backups/daily/` (30-day retention)
- Monthly copy on the 1st → `backups/monthly/` (indefinite)
- Pre-deploy backup before every migration → `backups/pre-deploy/`
- Email alert on failure → `ALERT_EMAIL`

**Migrations policy:** `prisma migrate deploy` is an explicit, manual deploy step — **never auto-applied on app boot.**

---

## 12. Security

- Helmet (HTTP security headers)
- CORS restricted to `CORS_ORIGIN` env var
- JWT auth on all routes except `/api/health` and `/api/auth`
- Role-based permissions (`lib/permissions.ts`) enforced per route
- Rate limiting — global, per-search, and per-auth (3 separate limiters)
- No PII in server logs (Winston redaction layer + CI lint guard `check:log-pii`)
- Prisma query logging (includes bound params) **only in non-production** (`lib/prisma.ts`)
- Morgan logs `req.path` only — query string dropped, so search terms never reach logs
- HTTPS enforced for emailed links — backend refuses to start in production unless `FRONTEND_URL`/`APP_URL` are `https://` (`config/index.ts`), so one-time login/reset tokens never travel over plaintext
- Socket.io auth via handshake `auth` (not URL query) — token never appears in logs
- Frontend is origin-agnostic — relative `/api` + `/socket.io` (same-origin behind Caddy); no API host baked into the bundle
- Secrets in VM `.env` only — never committed to git
- Firewall: ports 80/443 only exposed publicly (OCI security list + ufw)

---

## 13. Current Build Status

| Area | Status |
|---|---|
| Auth (magic-link + JWT + password reset) | ✅ Complete |
| Job state machine + optimistic locking | ✅ Complete |
| All CRUD routes (clients, properties, jobs, work logs, media, comms, engineers) | ✅ Complete |
| PDF generation (Quote, Job Sheet, Completion Report) | ✅ Complete |
| P&L aggregation | ✅ Complete |
| Audit log + AuditLog timeline UI | ✅ Complete |
| Socket.io realtime | ✅ Complete |
| Notification center + follow-up reminders | ✅ Complete |
| CI pipeline (GitHub Actions) | ✅ Complete |
| Production hardening (rate limits, timeouts, unbounded query caps, Puppeteer guard) | ✅ Complete |
| Zero-downtime blue-green deploy scripts | ✅ Complete |
| Nightly DB backup + pre-deploy backup + failure alerts | ✅ Complete |
| Dashboard screen (frontend) | ✅ Complete |
| Document generation UI (frontend) | ✅ Complete |
| Production frontend bundle + env-based API config | ✅ Complete |

---

## 14. Explicit Non-Goals

- No contractor-facing login or self-service portal
- No automated outbound communication to clients or tenants
- No staging environment (mitigated by CI gate + manual deploy trigger)
- Not mobile-first (desktop back-office tool; mobile must remain usable)
- No Kubernetes, no managed DB, no external load balancer — single-VM footprint is intentional at this scale
