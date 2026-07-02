# Oracle Free Tier — End-to-End Deployment Guide

The complete path from an empty Oracle account to both projects running in production. Written so someone new can execute it without prior context.

Related docs (read in this order):
1. **This file** — the overall sequence and decisions.
2. `docs/ORACLE_VM_PROVISIONING.md` — creating the Always Free VM (incl. the capacity-retry script).
3. `docs/DEPLOY.md` — detailed server runbook (Docker/Caddy install, .env, migrations, systemd).
4. `docs/ZERO_DOWNTIME.md`, `docs/CI.md`, `docs/RESTORE.md`, `docs/PRODUCTION_HARDENING.md` — blue-green, CI, backups, hardening details.

## Architecture at a glance

One Always Free VM (Ampere A1, 4 OCPU / 24 GB, Ubuntu 24.04 aarch64) hosts **two projects** behind a single Caddy:

```
Internet ──► Caddy (:80/:443, auto-HTTPS via Let's Encrypt)
              ├─ affinity.<domain>  ──► /app       backend blue 127.0.0.1:3001 / green :3002 + Postgres
              └─ project2.<domain>  ──► /app2      backend      127.0.0.1:4001            + own Postgres
```

Sizing: ~20–30 total users across both apps — this VM is heavily over-provisioned for the load; no tuning needed.

Isolation rules (gives most of the benefit of separate servers):
- Separate directories: `/app` (Affinity), `/app2` (project 2).
- Separate compose project names (`docker compose -p project2 ...`), so networks/volumes never merge.
- Separate Postgres containers, volumes, and `.env` secrets. Never share `JWT_SECRET` or DB credentials between apps.
- Non-overlapping loopback ports: Affinity owns 3001/3002 (blue/green); project 2 uses 4001+.
- Only Caddy listens on public ports 80/443. All app ports bind to `127.0.0.1`.

## Phase 0 — Code prerequisites (before touching Oracle)

1. All work merged to `master`. CI (`.github/workflows/ci.yml`) and the image build (`build-image.yml`) **only run on master**.
2. CI green: build, `check:log-pii` (PII log guard), `prisma migrate deploy`, tests.
3. `build-image.yml` published `ghcr.io/<owner>/affinity-backend:<tag>` — built for **linux/arm64** (mandatory: the VM is Ampere/Arm; x86-only images will not run).
4. No debug/telemetry artifacts: `grep -r "127.0.0.1:7743" --include="*.ts" --include="*.tsx"` must return nothing in source (docs mentions are fine). See `docs/LESSONS_LEARNED.md` for why.

## Phase 1 — Oracle provisioning (console)

Follow `docs/ORACLE_VM_PROVISIONING.md`. Summary:
1. Free Tier account (never upgrade to Pay As You Go — that is the only way charges become possible).
2. VCN via **Start VCN Wizard** → "VCN with Internet Connectivity"; open ingress TCP 80 + 443 in the security list.
3. Instance `affinity-prod`: Ubuntu 24.04, VM.Standard.A1.Flex 4 OCPU / 24 GB, public IPv4, 100 GB boot volume. Use the Cloud Shell retry script when "Out of host capacity" strikes.
4. Object Storage: create a bucket; Identity → My Profile → **Customer Secret Keys** → generate S3-compatible access key/secret for the backend's `OCI_*` env vars.
5. DNS: A records for both subdomains → the VM public IP (required for Caddy auto-HTTPS):
   - `affinity.<domain>` and `project2.<domain>`.

## Phase 2 — Server bootstrap (SSH as ubuntu@VM)

Follow `docs/DEPLOY.md` sections 1–10 for Affinity. Order of operations:
1. OS firewall: allow 80/443 (iptables or ufw — see runbook §10; Oracle Ubuntu images ship restrictive iptables).
2. Install Docker + compose plugin, Caddy (runbook §1).
3. `git clone <repo> /app`; write `/app/backend/.env` (runbook §3). Non-negotiables: `NODE_ENV=production`, https URLs (backend refuses to start otherwise), `openssl rand -hex 32` for JWT_SECRET.
4. `docker login ghcr.io` with a GitHub PAT (`read:packages`) to pull the backend image.
5. Blue-green bootstrap (this supersedes the generic §5–6 of the runbook when using `docker-compose.prod.yml`):
   ```bash
   cd /app/backend
   echo "reverse_proxy 127.0.0.1:3001" | sudo tee /app/active-upstream.caddy
   docker compose -f docker-compose.prod.yml up -d db
   docker compose -f docker-compose.prod.yml run --rm app_blue npx prisma migrate deploy
   docker compose -f docker-compose.prod.yml up -d app_blue
   ```
6. Frontend build into `/app/frontend/dist` (runbook §4), Caddy start + systemd (runbook §7–9) with `DOMAIN=affinity.<domain>`.
7. Keepalive cron (prevents Oracle idle-reclaim of the free VM):
   ```bash
   (crontab -l 2>/dev/null; echo "*/10 * * * * curl -s https://affinity.<domain>/api/health > /dev/null") | crontab -
   ```

## Phase 3 — Verify Affinity end-to-end

1. `curl https://affinity.<domain>/api/health` → `{"status":"ok"}`.
2. Log in via the browser.
3. Upload a document → proves Object Storage credentials.
4. Trigger a password reset → proves SMTP.
5. Run one backup and confirm the dump exists (see `docs/RESTORE.md`); copy backups off-VM (Object Storage) on a schedule.

## Phase 4 — Second project

Prerequisite: audit the second repo the same way (arm64 image or build-on-VM, no hardcoded secrets/localhost, health endpoint).

1. `sudo mkdir -p /app2 && sudo chown $USER:$USER /app2 && git clone <repo2> /app2`.
2. Its compose file must bind to `127.0.0.1:4001` (host) and get its own Postgres + volume. Run with an explicit project name:
   ```bash
   cd /app2 && docker compose -p project2 -f docker-compose.prod.yml up -d
   ```
   If the repo has no CI-built arm64 image, build on the VM: `docker compose -p project2 build` (arm64 automatically).
3. Own `.env`: separate JWT secret, DB password, URLs = `https://project2.<domain>`.
4. Add a site block to `/app/Caddyfile`:
   ```
   project2.<domain> {
       encode gzip
       reverse_proxy /api/* 127.0.0.1:4001
       root * /app2/frontend/dist
       try_files {path} /index.html
       file_server
   }
   ```
   Then `sudo systemctl reload caddy`.
5. Verify `https://project2.<domain>` the same way as Phase 3.

## Phase 5 — Ongoing deploys (Affinity)

1. GitHub repo secrets: `VM_HOST` (public IP), `VM_USER` (`ubuntu`), `VM_SSH_KEY` (the private key).
2. Merge to master → CI green → image published.
3. Run the **Deploy** workflow (`deploy.yml`, manual dispatch). It preflights (build + `check:log-pii`) then SSHes and runs `/app/scripts/deploy.sh` — blue-green switch with health check. Rollback: `/app/scripts/rollback.sh` (see `docs/ZERO_DOWNTIME.md`).
4. Never deploy with failing CI, and never let the container run with `NODE_ENV` ≠ `production` (Prisma would log raw SQL incl. PII — see `docs/PRODUCTION_HARDENING.md`).

## Cost safety checklist (repeat after any infra change)

- [ ] Account still Free Tier (not PAYG) — check Billing → Upgrade page says you're on Free Tier.
- [ ] Exactly one A1 instance, ≤ 4 OCPU / 24 GB total.
- [ ] Boot + block volumes ≤ 200 GB total; volume performance = Balanced.
- [ ] Object Storage < 20 GB (prune old backups).
- [ ] No load balancers, reserved IPs beyond the 1 free, or other paid resources created.
