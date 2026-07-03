# Production Hardening — Branch `feature/pdf-cleanups-engineers`

**Date:** 2026-07-01

## What changed and why

Before deploying to Oracle Cloud Free Tier (Ampere A1, 2 OCPU / 12 GB RAM, ~20 users) a full production-readiness sweep was done. Everything below was either a crash risk, a silent failure, or a security gap.

---

## Bug fixes

| File | Change | Risk it removes |
|---|---|---|
| `middleware/rateLimiter.ts` | `max: 1000` → `max: 100` per 15 min | Code said 100, did 1000 — DoS window |
| `services/pdfService.ts` | `console.error` → `logger.error`; concurrency guard (max 2 Chromium) | PDF errors were invisible; burst of PDFs could OOM the VM |
| `app.ts` | 30-second request timeout middleware, returns 503 | Hung requests (slow PDF/DB) never released connection slots |
| `routes/dashboard.ts` | `take: 50` on TO_BE_CHECKED jobs query | Unbounded fetch — could load hundreds of rows |
| `routes/reminders.ts` | `take: 100` on reminders list | Same — no limit when jobId not provided |
| `routes/jobMedia.ts` | `take: 100` on media per job | Same — job with 500 photos returned all at once |
| `routes/engineers.ts`, `routes/users.ts` | `take: 200` on list endpoints | Same pattern |
| `server.ts` | Graceful shutdown timeout 15 s → 30 s | Slow VM might not flush in-flight requests in time |
| `.env.example` | `connection_limit=5` → `15` | 5 connections for 20 concurrent users causes timeouts |
| `services/backupService.ts` | Email alert on backup failure via `ALERT_EMAIL` | Silent nightly failures — nobody would notice |
| `components/JobDocuments.tsx` | Removed dead `agent-log` fetch (port 7743) | Dead code from codegen; flags security audits |
| `services/storageService.ts` | Shared `usesLocalStorage()` for upload, signed URL, delete | Delete hit S3 while upload used disk → 500 |
| `components/JobMedia.tsx` | `prependById`, skip socket self-update, relative `/uploads` URLs | Duplicate thumbnails; broken previews (CORP) |
| `lib/rolePermissions.ts` | `media:delete` for PM | PM could upload but not delete own media |
| `server.ts` | Fail startup if placeholder OCI creds in production | Local disk storage must not run in prod |
| `app.ts` | `Cross-Origin-Resource-Policy: cross-origin` on `/uploads` | Dev previews blocked by Helmet |
| `Caddyfile` | Proxy `/uploads/*` to backend | Production static media 404 behind Caddy |

---

## Infrastructure added

### CI Pipeline — `.github/workflows/ci.yml`
Runs on every push and PR to `master`. Two parallel jobs:
- **backend** — `npm ci` → `prisma generate` → `tsc build` → `prisma migrate deploy` → `npm test` (against a real Postgres 15 service)
- **frontend** — `npm ci` → `vite build` (includes tsc check)

Enable branch protection on `master` (GitHub → Settings → Branches) to block merges on red CI. See `docs/CI.md`.

### Reverse Proxy — `Caddyfile`
- `/api/*` and `/socket.io/*` → `localhost:3000`
- Everything else → `/app/frontend/dist` with SPA fallback
- Auto-HTTPS via Let's Encrypt (Caddy default)
- Security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`
- Set `DOMAIN=yourdomain.com` before starting Caddy

### New tests — `backend/src/__tests__/`
| File | What it covers |
|---|---|
| `health.test.ts` | 200 OK when DB up; 503 when DB down |
| `rateLimiter.test.ts` | 101st request returns 429 |
| `backup.test.ts` | pg_dump command, OCI upload key, 30-day cleanup, failure email |

---

## Logging policy (PII protection)

Server logs (`backend/logs/combined-*.log`, `error-*.log`) must never contain
personal data. Three layers enforce this:

1. **Don't log PII at the call site.** Log identifiers (`userId`, `jobId`) or a
   masked value via `maskEmail()` from `lib/logger.ts`. Never pass raw `email`,
   `phone`, `address`, `accessNotes`, or `keyLocation` into a `logger.*()` call.
   Use the key `maskedEmail`/`maskedTo` for masked values (the raw `email`/`to`
   keys are auto-redacted — see layer 2).
2. **Redaction safety net.** `lib/logger.ts` runs a Winston format that replaces
   any log metadata whose key is in the sensitive-key deny-list with
   `[REDACTED]`, at any nesting depth. Catches mistakes the reviewer missed.
   (Prisma query `params` are not in the list; dev query debugging is unaffected.)
3. **CI guard.** `npm run check:log-pii` (`scripts/check-log-pii.mjs`, wired into
   `.github/workflows/ci.yml`) fails the build if a `logger.*()` call passes a
   raw PII key directly.

Other controls:
- **Prisma query logging** (raw SQL + bound params, which include `accessNotes`
  etc.) only attaches when `NODE_ENV !== 'production'` (`lib/prisma.ts`) — it is
  never active in production.
- **HTTP access logs** use a custom morgan format that logs `req.path` only,
  **dropping the query string**, so search terms like `/api/clients?q=<name>`
  never reach the logs (`app.ts`).
- `backend/logs/` is gitignored and not web-served. If logs are shipped off-box,
  send them only to an access-controlled destination.

### Debugging a production issue

Each request gets a correlation id (`middleware/requestId.ts`), returned in the
`X-Request-Id` response header and included in every HTTP log line. To trace an
issue: grab the request id, `grep` it across the logs, and read the intentional
`logger.*()` lines for that request — **do not** re-enable raw query/param
logging in production to chase a bug.

---

## Database backups (already implemented, verified)

`services/backupService.ts` runs every night at 2 AM:
- `pg_dump | gzip` → S3 object storage `backups/daily/YYYY-MM-DD.sql.gz`
- Monthly copy on the 1st of each month (`backups/monthly/`)
- 30-day retention on daily backups
- Weekly storage usage report
- **Failure now sends an email** to `ALERT_EMAIL`

Restore procedure: `docs/RESTORE.md`

---

## Deployment

Full step-by-step server setup (AWS EC2): `docs/DEPLOY.md`

**Required env vars for production `.env`:**
```
DATABASE_URL        (connection_limit=15)
JWT_SECRET          (64+ chars)
CORS_ORIGIN         (https://yourdomain.com)
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
EMAIL_FROM / EMAIL_FROM_NAME
STORAGE_REGION / STORAGE_BUCKET_NAME / STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY
ALERT_EMAIL         (backup failure notifications)
NODE_ENV=production
```

---

## Pre-launch checklist

- [ ] Push branch → PR → CI green
- [ ] Enable branch protection on `master`
- [ ] Generate real `JWT_SECRET` (64+ chars)
- [ ] Set production `.env` on VM (never commit it)
- [ ] Run restore drill: download latest backup, restore to scratch DB, verify row counts
- [ ] Hit `/api/health` after deploy — must return `{"status":"ok"}`
- [ ] Reboot VM and confirm stack auto-starts
- [ ] Confirm first nightly backup runs and email alert is received (or not, which means it worked)
