# Tracker.md — Affinity Workspace Build Checklist

Working task list for the AI coding agent. Grouped by phase per `ImplementationPlan.md`, with Backend and Frontend split within each phase. All items start unchecked — check off `- [ ]` → `- [x]` as each is genuinely complete and verified, not just started.

## Phase 1 — Foundation

**Backend**
- [ ] Scaffold Express app in plain JavaScript (verify zero `.ts`/`.tsx` files exist)
- [ ] Set up Prisma connection to PostgreSQL with `connection_limit` capped at 5–10 in `DATABASE_URL`
- [ ] Build centralized error-handling middleware
- [ ] Add Prisma foreign-key/unique-constraint error translation → `409`/`422` responses
- [ ] Configure structured logging (`winston`, `winston-daily-rotate-file`, `morgan`)
- [ ] Implement `User` model and magic-link token generation/hashing
- [ ] Integrate Resend (or Brevo) over port 587 for magic-link emails
- [ ] Implement magic-link verification + JWT session issuance
- [ ] Add `helmet`, `cors`, `express-rate-limit` middleware
- [ ] Add health check endpoint
- [ ] Add graceful shutdown handling

**Frontend**
- [ ] Scaffold React (plain JSX) app
- [ ] Build Login screen (email entry + "check your email" state)
- [ ] Build magic-link verification landing page (token exchange)
- [ ] Set up routing with auth-guarded routes
- [ ] Build base layout/shell (nav, auth context)
- [ ] Implement design tokens from `Design.md` (status color palette, typography, dense-table base styles)

## Phase 2 — Core Entities & State Machine

**Backend**
- [ ] Implement `Client` model + CRUD routes with validation (`express-validator`)
- [ ] Implement `Property` model + CRUD routes with validation
- [ ] Implement `PropertyTenantHistory` model + routes
- [ ] Implement `Job` model + CRUD routes, including tenant snapshot capture at creation
- [ ] Build `services/jobStateMachine.js` with the full allowed-transitions map
- [ ] Implement `PATCH /api/jobs/:id/status` with optimistic locking (`version` check)
- [ ] Integrate `fuse.js` fuzzy search for property/client lookup
- [ ] Write tests for state machine transition rules (valid + invalid transitions)

**Frontend**
- [ ] Build Job List screen (dense table, filter/sort by status, status badges)
- [ ] Build Job Detail screen shell with status-transition control (only legal next-states selectable)
- [ ] Handle `409` optimistic-lock conflicts in the UI (refresh prompt, not silent overwrite)
- [ ] Build Client management screens (CRUD forms)
- [ ] Build Property management screens (CRUD forms)
- [ ] Wire client/property lookup fields to the fuzzy-search endpoint

## Phase 3 — Workflows

**Backend**
- [ ] Implement `WorkLog` model + routes, freezing `rateApplied` from `User.hourlyRate` at log time
- [ ] Build media upload pipeline: `multer` → `sharp` compression → S3 upload
- [ ] Configure `@aws-sdk/client-s3` against OCI Object Storage endpoint/credentials
- [ ] Implement signed URL generation for media retrieval (`@aws-sdk/s3-request-presigner`)
- [ ] Implement `JobMedia` model + routes (storage key only, no local paths)
- [ ] Write and wire the raw SQL P&L aggregation query
- [ ] Implement `CommunicationLog` model + routes
- [ ] Wire up Socket.io for live updates across sessions
- [ ] Write tests for P&L query correctness (including soft-deleted work logs excluded)

**Frontend**
- [ ] Build Work Log entry UI within Job Detail
- [ ] Integrate `react-dropzone` for diagnostic/completion media upload with client-side preview
- [ ] Build Logistics Grid view (daily schedule from work logs)
- [ ] Build P&L view component on Job Detail
- [ ] Build Communication Log entry form (channel, direction, outcome)
- [ ] Integrate `socket.io-client` for live Job List/Detail updates

## Phase 4 — Auditing & Docs

**Backend**
- [ ] Implement `AuditLog` model (write-only — confirm no update/delete route exists)
- [ ] Hook `AuditLog` writes into Job/Property/Client/WorkLog mutation paths with `before`/`after` capture
- [ ] Implement `GeneratedDocument` model
- [ ] Set up `puppeteer-core` with ARM64 Chromium (`apt install chromium` + explicit `executablePath`)
- [ ] Build PDF generation for `QUOTE` documents
- [ ] Build PDF generation for `JOB_SHEET` documents
- [ ] Build PDF generation for `COMPLETION_REPORT` documents
- [ ] Capture `snapshotData` on every generated document
- [ ] Build Dashboard/"Daily Task Sheet" aggregation endpoint (AuditLog + CommunicationLog + Job)

**Frontend**
- [ ] Build Dashboard screen consuming the aggregation endpoint
- [ ] Build "Generate Document" actions on Job Detail (Quote / Job Sheet / Completion Report)
- [ ] Build generated-documents list with download links on Job Detail
- [ ] Build read-only Audit Log timeline view on Job Detail

## Phase 5 — Infrastructure

**Backend / Infra**
- [ ] Write `Dockerfile` for the Node app
- [ ] Write `docker-compose.yml` for app + Postgres
- [ ] Write `docker-compose.test.yml` for disposable test Postgres
- [ ] Configure Nginx reverse proxy
- [ ] Configure Certbot/Let's Encrypt TLS
- [ ] Build `node-cron` nightly backup job (`pg_dump` → gzip → Object Storage)
- [ ] Implement backup retention policy (30-day daily, indefinite monthly)
- [ ] Set up `pm2` or systemd process supervision
- [ ] Document explicit, manual `prisma migrate deploy` runbook step
- [ ] Verify migrations are NOT triggered on app boot
- [ ] Set up Object Storage usage monitoring/alert

**Frontend**
- [ ] Build production frontend bundle and serve via Nginx
- [ ] Configure environment-based API base URL / Socket.io endpoint (dev vs. prod)
