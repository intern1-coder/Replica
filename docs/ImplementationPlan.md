# ImplementationPlan.md — Affinity Workspace

Five sequential phases. Each phase pairs its backend work with the frontend that depends on it, so the app is usable end-to-end at the close of every phase rather than all-frontend-at-the-end. This is a 5-user internal tool, not a system that benefits from parallelized half-finished workstreams.

## Phase 1 — Foundation

Goal: a running, securely-authenticated app — login works end-to-end, no business entities yet.

**Backend**
- Express app scaffold in plain JavaScript (no TypeScript anywhere).
- Prisma connection to PostgreSQL, `DATABASE_URL` with an explicit low `connection_limit` (5–10).
- Centralized error-handling middleware — including the Prisma constraint-error translation to `409`/`422` from day one, not bolted on later.
- Structured logging (`winston` + `winston-daily-rotate-file`, `morgan` for request logs).
- Magic Link authentication: `User` model, token generation/hashing, Resend (or Brevo) integration over port 587, JWT session issuance.
- Health check endpoint and graceful shutdown handling.
- Base security middleware: `helmet`, `cors`, `express-rate-limit`.

**Frontend**
- Scaffold the React (plain JSX) app and base project structure.
- Build the Login screen: email entry → "check your email" state.
- Build the magic-link verification landing page (reads token from URL, exchanges for a session).
- Set up routing with auth-guarded routes (unauthenticated users bounce to Login).
- Establish base layout/shell (nav, auth context) and the design tokens from `Design.md` — status color palette, typography, dense-table base styles — so every later screen inherits them rather than re-deriving them.

## Phase 2 — Core Entities & State Machine

Goal: the central data model exists, the job lifecycle is enforced, and it's all visible/editable in the UI.

**Backend**
- `Client`, `Property`, `PropertyTenantHistory` models + CRUD routes, with `express-validator` input validation.
- `Job` model + CRUD routes, including `tenantSnapshotName`/`tenantSnapshotPhone` capture at creation.
- `services/jobStateMachine.js` — the allowed-transitions map (`TO_BE_CHECKED → CHECKED → QUOTED → AUTHORISED → COMPLETED/CANCELLED`), enforced in application code.
- Optimistic locking on `PATCH /api/jobs/:id/status` via the `version` column (`WHERE id = $1 AND version = $2`).
- `fuse.js`-powered fuzzy search/matching for property/client lookup (supports the old spreadsheet's manual matching workflow).

**Frontend**
- Build the Job List screen: dense table, filter/sort by status, status badges using the `Design.md` color mapping.
- Build the Job Detail screen shell, including the status-transition control — only legal next-states (per the state machine) are selectable.
- Handle the `409` optimistic-lock conflict response in the UI: prompt a refresh rather than silently retrying or overwriting.
- Build Client and Property management screens (CRUD forms), wired to the `fuse.js`-backed search/lookup endpoints.

## Phase 3 — Workflows

Goal: the day-to-day operational data — labor, cost, media, communication — flows in through the UI and the numbers add up.

**Backend**
- `WorkLog` model + routes, with `rateApplied` frozen from `User.hourlyRate` at log time.
- Media upload pipeline: `multer` → `sharp` compression → `@aws-sdk/client-s3` upload to OCI Object Storage, storing only the `storageKey` on `JobMedia`.
- Signed URL generation (`@aws-sdk/s3-request-presigner`) for retrieving media without exposing storage credentials.
- P&L raw SQL aggregation query (see `Schema.md`) wired up as an endpoint.
- `CommunicationLog` model + routes — explicit PM-logged communications only, no automated sends.
- Socket.io wiring for live status/update propagation across the 5 concurrent sessions.

**Frontend**
- Build the Work Log entry UI within Job Detail (hours, contractor, rate display).
- Integrate `react-dropzone` for diagnostic/completion photo (and short video) upload, with client-side preview before submit.
- Build the Logistics Grid view (daily schedule, built from `WorkLog` entries).
- Build the P&L view component on Job Detail (revenue / labor cost / material cost / profit).
- Build the Communication Log entry form (channel, direction, outcome) — manual logging only, matching the "no automation" rule.
- Integrate `socket.io-client` so Job List/Detail reflect status and log changes live across the 5 sessions without a manual refresh.

## Phase 4 — Auditing & Documents

Goal: the historical record and client-facing documents are real, immutable, and accessible from the UI.

**Backend**
- `AuditLog` model — write-path only, hooked into the `Job`/`Property`/`Client`/`WorkLog` mutation paths (status changes, cost updates, media added, etc.) via `before`/`after` JSON capture. No update/delete routes built against it, ever.
- `GeneratedDocument` model + Puppeteer-based PDF generation (`puppeteer-core`, ARM64 Chromium via `apt install chromium` + explicit `executablePath`) for `QUOTE`, `JOB_SHEET`, and `COMPLETION_REPORT` types.
- `snapshotData` capture on each generated document — the exact data used to render it, independent of later changes to the underlying `Job`.
- Dashboard/"Daily Task Sheet" aggregation endpoint assembled from `AuditLog` + `CommunicationLog` + `Job`.

**Frontend**
- Build the Dashboard screen consuming the above aggregation endpoint — today's activity, what needs PM attention.
- Build "Generate Document" actions on Job Detail (Quote / Job Sheet / Completion Report buttons) plus a generated-documents list with download links.
- Build a read-only Audit Log timeline view on Job Detail, rendering the `before`/`after` history for that job.

## Phase 5 — Infrastructure

Goal: the system runs reliably on the Oracle VM, serves the production frontend build, and can survive losing the VM.

**Backend / Infra**
- `Dockerfile` for the Node app, `docker-compose.yml` for app + Postgres (and a separate `docker-compose.test.yml` for the disposable Postgres test instance).
- Nginx reverse proxy config + Certbot/Let's Encrypt TLS termination.
- `node-cron` nightly backup job: `pg_dump` → gzip → push to OCI Object Storage under a dated key, with 30-day daily retention and indefinite monthly retention.
- Process supervision via `pm2` or a systemd unit.
- Deployment runbook: explicit, manual `prisma migrate deploy` step (never auto-applied on boot).
- Object Storage usage monitoring/alerting (resolves Open Question #4 from the PRD — at minimum, document the manual-check process even if an in-app alert is deferred).

**Frontend**
- Production frontend build, served as static assets via Nginx alongside the API (same origin or a configured API base URL — confirm once the v2 frontend spec's build tooling is known).
- Environment-based API base URL / Socket.io endpoint config for local dev vs. production.
