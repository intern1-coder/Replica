# TechSpec.md — Affinity Workspace

## Backend

- **Runtime/Framework:** Node.js + Express (`express ^4.19.2`).
- **Language:** Plain JavaScript only. No TypeScript, no `.ts`/`.tsx` files anywhere in the backend. Frontend is React/JSX, also plain JS — no TS compiler in the toolchain.
- **Process supervision:** `pm2` or a systemd unit on the VM (not Kubernetes/OKE — orchestration overhead is unjustified at 5 users).
- **Realtime:** `socket.io` for live updates (e.g. job status changes reflected across PM sessions without polling).

## Frontend

The PRD confirms frontend dependencies are carried over unchanged from an earlier (v2) revision rather than re-specified in v3 — v3 is scoped to the database/hosting decision. What's confirmed directly:

- **Library:** React, written in plain JSX — no TypeScript, consistent with the backend's plain-JS constraint.
- **File uploads:** `react-dropzone` for the diagnostic/completion photo upload UI (pairs with the `multer` → `sharp` → S3 pipeline on the backend).
- **Realtime:** `socket.io-client`, paired with the backend's `socket.io` server for live job/status updates across the 5 concurrent sessions.

**Not yet confirmed** (not stated in the v3 PRD; flagged here rather than guessed at): build tooling (Vite vs. CRA vs. other), routing library, state-management approach (React Context vs. a library), and the exact frontend dependency versions. If the original v2 PRD is available, these should be pulled from there rather than assumed.

## Database

- **Engine:** PostgreSQL, self-hosted as a Docker container on the same VM as the app (not Oracle's Autonomous Database — that's Oracle's own proprietary engine, not Postgres-compatible, and using it would throw away the relational reasoning that justified moving off MongoDB).
- **ORM/Migrations:** Prisma (`@prisma/client ^5.17.0`, `prisma ^5.17.0` as a dev dependency). The schema file is Prisma's own DSL, not TypeScript, so it's compatible with the plain-JS constraint.
- **Connection pooling:** Capped explicitly via `connection_limit` in `DATABASE_URL`. At 5 concurrent users sharing the VM with the app process, the pool should be capped low — **5 to 10 connections** — rather than left at Prisma's default, since Postgres and the Node process are competing for the same small box.
- **Migrations policy:** `prisma migrate deploy` is run as an explicit, manual deploy step. Migrations are **never auto-applied on app boot** — this prevents a bad migration from silently running against production data on a routine restart.
- **Testing:** Integration tests run against a real disposable Postgres container (`docker compose -f docker-compose.test.yml up`), not an in-memory substitute, since the goal is to verify real constraint and transaction behavior.

## Hosting & Storage — Oracle Cloud Always Free Tier

Sized for a 5-person internal team; compute is not the binding constraint at this scale.

| Resource | Always Free allotment | Role here |
|---|---|---|
| Compute | Up to 4 Ampere A1 (ARM64) OCPUs + 24 GB RAM | Runs Nginx, Node API + Socket.io, and Dockerized Postgres on a single instance |
| Block storage | 200 GB | Postgres data volume + OS — not a near-term bottleneck |
| Object storage | ~10–20 GB (varies by account; confirm in console) | Media (compressed photos/video) and nightly backup dumps |
| Outbound transfer | 10 TB/month | Not a constraint at this scale |
| Load balancer | 1 Flexible LB (10 Mbps) | **Not used** — TLS terminates directly on Nginx via Certbot |

- **Object Storage access:** S3-compatible API. The media pipeline uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` exactly as it would against AWS — only the endpoint and credentials point at Oracle instead.
- **Storage math (sanity check):** ~5 compressed photos (~300 KB post-`sharp`) plus an occasional short video (~5–10 MB) per job ≈ 8–12 MB/job. At ~30 jobs/month, that's roughly 3–4 GB/year — comfortably inside the free tier for several years, but worth a usage alert rather than an assumption of headroom.

## Deployment Architecture

Single Ampere A1 VM running three layers, with Docker Compose managing Postgres + the Node app:

```
Nginx (TLS via Let's Encrypt/Certbot)
  → Node API + Socket.io (Express, plain JS)
      → PostgreSQL (Docker container)

nightly cron → pg_dump → gzip → OCI Object Storage
```

- No Kubernetes/OKE — Docker Compose plus `pm2`/systemd is the right amount of process complexity at this scale.
- No load balancer — Nginx + Certbot handles TLS directly; the free LB is available but unnecessary.
- Single point of failure (one VM) is an accepted tradeoff at 5 internal users, made acceptable specifically by the nightly backup job below — not by assuming the VM won't fail.

## Known Gotchas

### 1. ARM64 Puppeteer
`puppeteer`'s bundled-Chromium download does not reliably target ARM64/aarch64 the way it does x86_64. The fix:
- Use `puppeteer-core` (does **not** auto-download a Chromium binary), not `puppeteer`.
- Install Chromium via the OS package manager on the VM: `apt install chromium`.
- Point Puppeteer at it explicitly via `executablePath`.
- `sharp` ships working ARM64 binaries via its underlying `libvips` builds and is generally fine — but confirm with a real `npm install` on the actual VM rather than assuming parity with an x86 dev machine.

### 2. Outbound email on port 587
Cloud providers, including Oracle, commonly block outbound SMTP on port 25 by default to prevent spam abuse. The magic-link login email — the only email this system sends, per the no-automation decision — goes through a transactional email API over **port 587** (Resend or Brevo's free tier), not raw SMTP, sidestepping the block entirely.

### 3. Nightly `pg_dump` backup is mandatory
Self-hosted Postgres on a compute VM gets **zero backup by default**, unlike a managed DB tier. Given the 2-year historical-accuracy requirement, a `node-cron` job runs nightly:
1. `pg_dump` the database, gzip it.
2. Push the compressed dump to Object Storage under a dated key (e.g. `backups/2026-06-20.sql.gz`).
3. Retention: daily dumps kept 30 days, monthly dumps kept indefinitely.

This is treated as a non-optional system requirement, not an enhancement — without it, the system cannot survive losing the VM with bounded data loss, which is an explicit non-functional requirement (≤24 hours of loss on total VM failure).

## Error Handling (Postgres-specific)

- Foreign-key and unique-constraint violations from Prisma are caught explicitly and translated into clean `409`/`422` responses — never leaked as raw stack traces.
- Optimistic locking on `Job` uses a `version` integer column; the status-update path issues a `WHERE id = $1 AND version = $2` style update that Postgres enforces atomically.
