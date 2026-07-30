# Production Readiness Report

Last updated: 2026-07-30. Supersedes the previous version of this document, which was stale (claimed no CI existed; it does — `.github/workflows/ci.yml`, `deploy.yml`, `build-image.yml` — and listed 3 backend test files where there are now 16).

**Baseline is genuinely strong**: TypeScript `strict` mode on both sides, no `console.log` in backend code, PII redaction enforced in CI (`scripts/check-log-pii.mjs`), optimistic locking on job status transitions, graceful shutdown + uncaught-exception handlers, a real CI pipeline, a documented deploy runbook (`docs/DEPLOY.md`), and no SQL-injection surface (the one raw-SQL query is fully parameterized). The gaps below are specific and fixable, not systemic.

Findings marked **✅ FIXED (2026-07-30)** were addressed in this pass. Everything else is still open.

---

## CRITICAL — blocks production

### C1. Backend port exposed on all interfaces ✅ FIXED (2026-07-30)
`backend/docker-compose.yml` published `3000:3000` (all interfaces) instead of loopback-only, while the `db` service in the same file and `docker-compose.prod.yml` both correctly bind `127.0.0.1`. Combined with `app.set('trust proxy', 1)` (`app.ts:36`), a direct caller to `http://<ip>:3000` controls its own `X-Forwarded-For` header, making every rate limiter — including the 10-attempt login guard — trivially bypassable by rotating the header.
**Fix applied**: `ports: - "127.0.0.1:3000:3000"`.

### C2. Deploy script started new code before running migrations ✅ FIXED (2026-07-30)
`scripts/deploy-single.sh` ran `docker compose up -d --build` (serving traffic immediately) and only *then* `prisma migrate deploy` — a window where new code queries an un-migrated schema. The manual runbook (`docs/DEPLOY.md` §4→§5) and the blue-green `deploy.sh` both had the correct order; only the automated single-container path was wrong.
**Fix applied**: reordered to `docker compose build` → `prisma migrate deploy` → `docker compose up -d`.

### C3. `EMAIL_FROM`/`SMTP_FROM` name mismatch — all outbound email silently broken in production ✅ FIXED (2026-07-30)
`config/index.ts` read `EMAIL_FROM`, but `docker-compose.yml` passed `SMTP_FROM` and `docs/DEPLOY.md` documented `SMTP_FROM`. In production, `config.email.from` fell through to the unroutable default `noreply@affinity.local`, which SMTP providers reject — meaning password resets, new-member invites, and backup-failure alerts were never delivered.
**Fix applied**: `config/index.ts` now falls back `EMAIL_FROM || SMTP_FROM || default`; `docker-compose.yml` passes `EMAIL_FROM=${EMAIL_FROM:-${SMTP_FROM:-}}` (validated with `docker compose config` against both an `EMAIL_FROM`-set and an `SMTP_FROM`-only env file); `docs/DEPLOY.md`'s template renamed to `EMAIL_FROM`.

### C4. `reset-test-data.ts` was an unguarded full data wipe ✅ FIXED (2026-07-30)
The script correctly preserved `User`/`Setting` and deleted everything else in FK-safe order, but had no confirmation of any kind, no dry-run, deleted `AuditLog` rows (append-only per `docs/Rules.md:23`) with no record that it ran, orphaned every S3/local file (removed `jobMedia`/`generatedDocument`/`workLogReceipt` rows without calling `deleteMediaFromStorage`), and ran 17 `deleteMany`s inside a default-5-second Prisma transaction — real data volumes would throw `P2028` and roll back entirely.
**Fix applied**: defaults to a dry run (prints row counts, changes nothing); requires `RESET_CONFIRM=DELETE_ALL_DATA` to actually delete; deletes the corresponding storage objects after the DB transaction commits (best-effort, failures logged and counted); transaction timeout raised to 120s. Verified locally: dry run twice in a row produced identical counts (12 jobs both times) with zero side effects. **Still zero writes to the `users` table** — same guarantee as before.

---

## HIGH — should fix before onboarding real users

### H1. `JWT_SECRET` has no strength validation ✅ FIXED (2026-07-30)
`.env.example` ships the literal placeholder `JWT_SECRET=change-me-to-a-long-random-secret-at-least-64-chars`, and the old validation only checked truthiness — copying the example file as-is produced a forgeable signing key.
**Fix applied**: `config/index.ts` now throws at boot in production if `JWT_SECRET` is under 32 characters or contains `change-me`. (Required updating `rateLimiter.test.ts`, which fakes `NODE_ENV=production` and needed its own production-strength secret to match.)

### H2. `PATCH /api/jobs/:id` has no optimistic lock — concurrent edits silently overwrite each other
`backend/src/routes/jobs.ts` (job field-edit handler) does not include `version` in the `where` clause or increment it, unlike `PATCH /:id/status` (`services/jobStateMachine.ts`), which correctly does `where: { id, version: currentVersion }` and returns 409 on a mismatch — the exact pattern `docs/Rules.md` mandates for all job mutations. Two PMs editing the same job's `quotedValue`/`materials`/`completionNotes` concurrently — routine in an app that broadcasts live edits over Socket.io — get silent last-write-wins, and the broadcast still reports an unchanged `version`, so no client ever detects the staleness. **Not fixed in this pass** — needs its own `version` param + increment + 409 handling on the general job-edit route.

### H3. No `connection_limit` on the production `DATABASE_URL` ✅ FIXED (2026-07-30)
Prisma defaults to `2 × vCPUs + 1 = 5` connections on the 2-vCPU host — the exact value `docs/PRODUCTION_HARDENING.md` already diagnosed as causing timeouts under normal load. `docker-compose.prod.yml` and `.env.example` already had `connection_limit=15`; only the single-container compose file was missing it.
**Fix applied**: appended `&connection_limit=15` to the `DATABASE_URL` in `docker-compose.yml`.

### H4. Every authenticated user can read all tenant/property/client PII regardless of role
List/detail GET routes across `tenants.ts`, `properties.ts`, `clients.ts`, `jobs.ts`, `workLogs.ts`, `jobMedia.ts`, `settings.ts` carry no `requirePermission`, while their mutating siblings do. This is intentional per `rolePermissions.ts`'s `OPEN_VIEWS` design ("views that were ungated under the old role system"), but the consequence is that a `CONTRACTOR` role can enumerate the entire client book and every tenant's phone/address/access-notes/key-location — exactly the PII fields the log-redaction rules treat as sensitive. `*:view` permission keys already exist in `lib/permissions.ts`; they're defined but unenforced on reads. Related: `jobMedia.ts`'s `GET /:id/url` mints a signed URL for any media id to any authenticated user with no check that they have access to the parent job. **Not fixed in this pass** — needs a decision on the intended read-access model (this matters most before any external/contractor user is onboarded, since `CONTRACTOR` currently sees the same PII as `PM`/`ADMIN`).

### H5. Socket.io auth ignores `tokenVersion` and soft-deletion; job rooms are unauthorized
`lib/socket.ts`'s connection auth verifies the JWT signature but doesn't re-check `tokenVersion` or `deletedAt` the way `middleware/auth.ts`'s `requireAuth` does — so a deactivated or force-logged-out user (password reset/change bumps `tokenVersion`) keeps a live realtime feed until the JWT's natural expiry (up to `JWT_EXPIRES_IN=7d`). Additionally, any socket can `job:join` any `jobId` with no authorization check, and the broadcasts to that room include real content (description, materials, quoted value, tenant snapshot fields, storage keys). **Not fixed in this pass.**

### H6. No `.dockerignore` — build context includes `.env`, `uploads/`, `logs/`, host `node_modules`
`backend/Dockerfile`'s `COPY . .` sweeps the real `.env` file into the builder layer (which is cache-exported to GitHub Actions via `cache-to: type=gha,mode=max`), and — since it runs after `npm ci` — overwrites the freshly-installed `node_modules` with whatever's on the host filesystem, which is a real risk for `sharp`/`bcrypt` native binaries on the on-server build path (`deploy-single.sh` builds on the target host itself). **Not fixed in this pass.**

### H7. Real job PDFs, photos, and two audit-log files are committed in git history
31 files under `backend/uploads/jobs/<uuid>/{documents,media}/` (completion reports, quotes, job sheets, site photos generated from real job/tenant data) plus two `backend/logs/*-audit.json` files are tracked in git, predating the `.gitignore` rules that now cover those paths for new files. Requires a history rewrite (`git filter-repo`), not just `git rm --cached`, and coordination since it changes commit hashes on every clone. **Not fixed in this pass** — flagging for a deliberate, scheduled cleanup rather than doing a history rewrite unprompted.

### H8. Blue-green `deploy.sh` references unset variables under `set -u`
Unlike `deploy-single.sh` (used for the current 1GB single-container setup and now fixed above), `scripts/deploy.sh` (for ≥2GB blue-green deploys) never sources `/app/backend/.env` before referencing `${GHCR_OWNER}` and `${DATABASE_URL}` — under `set -euo pipefail` this aborts before the first real step. Also, `${DATABASE_URL}` at the `pg_dump` line expands in the *host* shell rather than inside the container it execs into. **Not fixed in this pass** — not on the currently-used deploy path, but broken if the app is ever moved to a bigger instance and this script is used as-is.

---

## MEDIUM — fix soon

- **M1** — Multer file-size/type rejections (`services/mediaService.ts`) surface as bare `500`s (no `MulterError`/custom-error handling in `errorHandler.ts`), instead of `413`/`415`.
- **M2** — Rate limiting uses `express-rate-limit`'s in-memory store; counters reset on every deploy or crash-restart, and blue-green's two containers keep independent counters. Combined with C1 (now fixed) this is less severe, but still not durable.
- **M3** — The in-app nightly backup cron (`services/backupService.ts`, unconditional in `server.ts`) and the separate host-crontab `scripts/backup-db.sh` both back up to overlapping S3 paths with incompatible retention-cleanup filename patterns — pick one. Also: `runBackup` shells out `pg_dump "${DATABASE_URL}" | gzip` via `exec()` (a password containing `$` or a backtick breaks or injects) and loads the entire dump into memory before upload on a memory-capped container — should stream.
- **M4** — Backend container runs as root (no non-root user in `Dockerfile`); no `HEALTHCHECK` directive despite a working `/api/health`; devDependencies (`jest`, `ts-jest`, `supertest`, full `prisma` CLI) ship into the production image.
- **M5** — `backend/tsconfig.json` has `sourceMap: true` with no production override — `.js.map` files ship in the image.
- **M6** — Caddy sets several security headers but no `Strict-Transport-Security` or `Content-Security-Policy`; the SPA shell served by Caddy's `file_server` never passes through Express, so it gets neither Caddy's nor Helmet's headers. A dead `nginx/conf.d/default.conf` with a placeholder cert path should be deleted before someone deploys it by mistake.
- **M7** — `/uploads` is served statically with no auth. Currently unreachable only because the Dockerfile doesn't copy `uploads/` into the runtime image and production is hard-failed onto S3 at boot (`server.ts`) — but the unauthenticated mount is a standing risk if that boot check or the storage heuristic (`storageService.ts`'s `usesLocalStorage()` string-sniffing) is ever wrong.
- **M8** — Audit-log writes happen as a separate `await` after the mutation they describe, not inside the same transaction — a crash between the two leaves a mutation with no audit trail, which conflicts with treating `AuditLog` as a hard guarantee.
- **M9** — `docker-compose.yml` enumerates env vars individually instead of using `env_file:` — anything not explicitly listed (e.g. `STORAGE_REGION`, which defaults to `ap-south-1` instead of the actual `eu-west-2` deployment region) silently falls back to a default instead of failing loudly. This is the same class of bug as C3; worth an `env_file:` pass to close off the whole category at once.

---

## LOW / INFO

- CORS origin defaults to `localhost` if `CORS_ORIGIN` is unset in production (unlike `FRONTEND_URL`/`APP_URL`, which are https-validated at boot).
- Frontend CI runs `npm ci` + `npm run build` only — no lint step (one exists, `npm run lint`, just not wired in) and no frontend test framework at all.
- `deploy.yml` is `workflow_dispatch`-only with no enforced check that CI passed on the target commit, despite a comment claiming it's required.
- ~11 `console.error` calls remain in frontend components — not a leak, but invisible to ops without an error-tracking service.
- `backend/ecosystem.config.js` (PM2 cluster config) is stale and unreferenced — Docker runs `node dist/server.js` directly. Cluster mode would run N copies of the backup cron and N independent rate-limit stores; delete it or it will eventually get used by accident.
- Three orphaned seed scripts (`seed-100-days.ts`, `seed-jobs-proper.ts`, `seed-logs.ts`) sit at `backend/` root, unreferenced by `package.json`; `backend/scripts/seed-dummy-data.ts` is the maintained one.
- `.env.example` includes real internal email addresses as example admin accounts — low severity, but worth swapping for `admin@example.com`-style placeholders.
- No error-tracking (Sentry/equivalent) or uptime monitoring beyond the (now-working, post-C3-fix) backup-failure email alert.

---

## Suggested order for remaining work
1. **H2** — optimistic lock on `PATCH /jobs/:id` (small, well-understood pattern already used elsewhere in this codebase).
2. **H4** — decide and enforce the intended read-permission model, especially before onboarding any `CONTRACTOR`-role external user.
3. **H5** — socket auth parity with `requireAuth` (tokenVersion + soft-delete check) and job-room authorization.
4. **H6** — add `.dockerignore`.
5. **H7** — scheduled, deliberate git-history cleanup for the committed uploads/logs (coordinate — this changes commit hashes for everyone).
6. **H8** — fix `deploy.sh` before ever moving off the current 1GB single-container setup.
7. MEDIUM items, roughly in the listed order.
