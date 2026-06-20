# Tracker.md — Affinity Workspace Build Checklist

Working task list for the AI coding agent. Grouped by phase per `ImplementationPlan.md`, with Backend and Frontend split within each phase. All items start unchecked — check off `- [ ]` → `- [x]` as each is genuinely complete and verified, not just started.

## Phase 1 — Foundation

**Backend**
- [x] Scaffold Express app in plain JavaScript (verify zero `.ts`/`.tsx` files exist)
- [x] Set up Prisma connection to PostgreSQL with `connection_limit` capped at 5–10 in `DATABASE_URL`
- [x] Build centralized error-handling middleware
- [x] Add Prisma foreign-key/unique-constraint error translation → `409`/`422` responses
- [x] Configure structured logging (`winston`, `winston-daily-rotate-file`, `morgan`)
- [x] Implement `User` model and magic-link token generation/hashing
- [x] Integrate Resend (or Brevo) over port 587 for magic-link emails
- [x] Implement magic-link verification + JWT session issuance
- [x] Add `helmet`, `cors`, `express-rate-limit` middleware
- [x] Add health check endpoint
- [x] Add graceful shutdown handling

**Frontend**
- [x] Scaffold React (plain JSX) app -> Upgraded to React TS per Rules.md
- [x] Build Login screen (email entry + "check your email" state)
- [x] Build magic-link verification landing page (token exchange)
- [x] Set up routing with auth-guarded routes
- [x] Build base layout/shell (nav, auth context)
- [x] Implement design tokens from `Design.md` (status color palette, typography, dense-table base styles)

## Phase 2 — Core Entities & State Machine

**Backend**
- [x] Implement `Client` model + CRUD routes with validation (`express-validator`)
- [x] Implement `Property` model + CRUD routes with validation
- [x] Implement `PropertyTenantHistory` model + routes
- [x] Implement `Job` model + CRUD routes, including tenant snapshot capture at creation
- [x] Build `services/jobStateMachine.js` with the full allowed-transitions map
- [x] Implement `PATCH /api/jobs/:id/status` with optimistic locking (`version` check)
- [x] Integrate `fuse.js` fuzzy search for property/client lookup
- [x] Write tests for state machine transition rules (valid + invalid transitions)

**Frontend**
- [x] Build Job List screen (dense table, filter/sort by status, status badges)
- [x] Build Job Detail screen shell with status-transition control (only legal next-states selectable)
- [x] Handle `409` optimistic-lock conflicts in the UI (refresh prompt, not silent overwrite)
- [x] Build Client management screens (CRUD forms)
- [x] Build Property management screens (CRUD forms)
- [x] Wire client/property lookup fields to the fuzzy-search endpoint

## Phase 3 — Workflows

**Backend**
- [x] Implement `WorkLog` model + routes, freezing `rateApplied` from `User.hourlyRate` at log time
- [x] Build media upload pipeline: `multer` → `sharp` compression → S3 upload
- [x] Configure `@aws-sdk/client-s3` against OCI Object Storage endpoint/credentials
- [x] Implement signed URL generation for media retrieval (`@aws-sdk/s3-request-presigner`)
- [x] Implement `JobMedia` model + routes (storage key only, no local paths)
- [x] Write and wire the raw SQL P&L aggregation query
- [x] Implement `CommunicationLog` model + routes
- [x] Wire up Socket.io for live updates across sessions
- [x] Write tests for P&L query correctness (including soft-deleted work logs excluded)

**Frontend**
- [x] Build Work Log entry UI within Job Detail
- [x] Integrate `react-dropzone` for diagnostic/completion media upload with client-side preview
- [x] Build Logistics Grid view (daily schedule from work logs)
- [x] Build P&L view component on Job Detail
- [x] Build Communication Log entry form (channel, direction, outcome)
- [x] Integrate `socket.io-client` for live Job List/Detail updates

## Phase 4 — Auditing & Docs

**Backend**
- [x] Implement `AuditLog` model (write-only — confirm no update/delete route exists)
- [x] Hook `AuditLog` writes into Job/Property/Client/WorkLog mutation paths with `before`/`after` capture
- [x] Implement `GeneratedDocument` model
- [x] Set up `puppeteer-core` with ARM64 Chromium (`apt install chromium` + explicit `executablePath`)
- [x] Build PDF generation for `QUOTE` documents
- [x] Build PDF generation for `JOB_SHEET` documents
- [x] Build PDF generation for `COMPLETION_REPORT` documents
- [x] Capture `snapshotData` on every generated document
- [x] Build Dashboard/"Daily Task Sheet" aggregation endpoint (AuditLog + CommunicationLog + Job)

**Frontend**
- [ ] Build Dashboard screen consuming the aggregation endpoint
- [ ] Build "Generate Document" actions on Job Detail (Quote / Job Sheet / Completion Report)
- [ ] Build generated-documents list with download links on Job Detail
- [ ] Build read-only Audit Log timeline view on Job Detail

## Phase 5 — Infrastructure

**Backend / Infra**
- [x] Write `Dockerfile` for the Node app
- [x] Write `docker-compose.yml` for app + Postgres
- [x] Write `docker-compose.test.yml` for disposable test Postgres
- [x] Configure Nginx reverse proxy
- [x] Configure Certbot/Let's Encrypt TLS
- [x] Build `node-cron` nightly backup job (`pg_dump` → gzip → Object Storage)
- [x] Implement backup retention policy (30-day daily, indefinite monthly)
- [x] Set up `pm2` or systemd process supervision
- [x] Document explicit, manual `prisma migrate deploy` runbook step
- [x] Verify migrations are NOT triggered on app boot
- [x] Set up Object Storage usage monitoring/alert

**Frontend**
- [ ] Build production frontend bundle and serve via Nginx
- [ ] Configure environment-based API base URL / Socket.io endpoint (dev vs. prod)
