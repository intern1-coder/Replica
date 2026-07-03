# AWS — End-to-End Deployment Guide

The complete path from an empty AWS account to Affinity running in production. Written so someone new can execute it without prior context. Client machine: Windows with **MobaXterm** for SSH.

Related docs (read in this order):
1. **This file** — the overall sequence and decisions.
2. `docs/AWS_EC2_PROVISIONING.md` — EC2 launch, Security Group, Elastic IP, S3 bucket + IAM keys, billing alarm.
3. `docs/DEPLOY.md` — detailed server runbook (swap, Docker/Caddy install, .env, migrations, systemd).
4. `docs/CI.md`, `docs/RESTORE.md`, `docs/PRODUCTION_HARDENING.md` — CI, backups, hardening details.

## Architecture at a glance

**One project per EC2 instance.** Affinity runs alone on a t4g.micro (Graviton ARM64, 2 vCPU / 1GB RAM + 2GB swap, Ubuntu 24.04):

```
Internet ──► Caddy (:80/:443, auto-HTTPS via Let's Encrypt)
              └─ yourdomain.com ──► /app   backend 127.0.0.1:3000 (Docker) + Postgres (Docker)
Uploads ──► AWS S3 (signed URLs, private bucket)
```

Sizing: 5–10 users — a t4g.micro with swap handles this comfortably; total cost ~$8–9/mo. If Puppeteer PDF generation OOMs, resize to t4g.small (2-minute console operation, see provisioning doc).

**Deploy model:** single app container via `backend/docker-compose.yml`. Blue-green (`docker-compose.prod.yml`, `scripts/deploy.sh`) is NOT used on 1GB — it briefly runs two backends side by side. A ~30-second restart gap per deploy is acceptable at this scale. If you later resize to ≥2GB, blue-green remains available (see `docs/ZERO_DOWNTIME.md`).

## Phase 0 — Code prerequisites (before touching AWS)

1. All work merged to `master`. CI (`.github/workflows/ci.yml`) and the image build (`build-image.yml`) **only run on master**.
2. CI green: build, `check:log-pii` (PII log guard), `prisma migrate deploy`, tests.
3. Images stay **linux/arm64** — Graviton (t4g) is ARM, same as the old Oracle Ampere VM. No CI changes needed. (If you ever switch to a t3/x86 instance, `build-image.yml` must add `linux/amd64`.)
4. No debug/telemetry artifacts: `grep -r "127.0.0.1:7743" --include="*.ts" --include="*.tsx"` must return nothing in source (docs mentions are fine). See `docs/LESSONS_LEARNED.md` for why.

## Phase 1 — AWS provisioning (console)

Follow `docs/AWS_EC2_PROVISIONING.md`. Summary:
1. Billing alarm at $10/mo (first thing).
2. Key pair `affinity-key` (.pem — works directly in MobaXterm).
3. EC2 `affinity-prod`: Ubuntu 24.04 **Arm** AMI, t4g.micro, 20GB gp3, Security Group with 22 (your IP) / 80 / 443.
4. Elastic IP allocated and associated; DNS **A record** `yourdomain.com` → Elastic IP (required for Caddy auto-HTTPS).
5. Private S3 bucket + IAM user `affinity-app` with bucket-scoped policy; access keys go into `backend/.env` as `STORAGE_*` vars.

## Phase 2 — Server bootstrap (MobaXterm SSH as ubuntu@Elastic-IP)

MobaXterm: Session → SSH → host = Elastic IP, user `ubuntu`, Advanced → Use private key → `affinity-key.pem`.

Follow `docs/DEPLOY.md` sections 1–10. Order of operations:
1. §1: apt upgrade, **2GB swap file (mandatory on 1GB RAM)**, Docker + compose plugin, Caddy.
2. §2–3: `git clone <repo> /app`; write `/app/backend/.env`. Non-negotiables: `NODE_ENV=production`, https URLs (backend refuses to start otherwise), `openssl rand -hex 32` for JWT_SECRET, real `STORAGE_*` values (placeholders are refused in production).
3. §5–6: migrations then `docker compose up -d` (single container, builds on the instance):
   ```bash
   cd /app/backend
   docker compose up -d db
   docker compose run --rm app npx prisma migrate deploy
   docker compose up -d
   curl http://localhost:3000/api/health
   ```
4. §4, §7–9: frontend build into `/app/frontend/dist`, Caddy start + systemd with `DOMAIN=yourdomain.com`.
5. §10: ufw (Security Group already restricts everything at the AWS level).

No keepalive cron — AWS does not reclaim idle instances (that was an Oracle Free Tier quirk).

## Phase 3 — Verify end-to-end

1. `curl https://yourdomain.com/api/health` → `{"status":"ok"}`.
2. Log in via the browser.
3. Upload a document → proves S3 credentials (check the object appears in the S3 console).
4. Generate a completion-report PDF → proves Puppeteer fits in memory (watch `free -h` during generation).
5. Trigger a password reset → proves SMTP.
6. Run one backup and confirm the dump exists (see `docs/RESTORE.md`); copy backups off-instance (S3) on a schedule.

## Phase 4 — Ongoing deploys

Two options:

**A. Manual via SSH (or `/aws-deploy` skill):**
```bash
ssh ubuntu@<AWS_VM_IP> "cd /app && git pull origin master"
ssh ubuntu@<AWS_VM_IP> "cd /app/backend && docker compose exec app npx prisma migrate deploy"   # if schema changed
ssh ubuntu@<AWS_VM_IP> "cd /app/backend && docker compose up -d --build"
```

**B. GitHub Actions:** repo secrets `VM_HOST` (Elastic IP), `VM_USER` (`ubuntu`), `VM_SSH_KEY` (the .pem contents), then run the **Deploy** workflow. Note: `deploy.yml` currently calls the blue-green `scripts/deploy.sh`, which is not suitable on 1GB — prefer option A until/unless the instance is resized.

Never deploy with failing CI, and never let the container run with `NODE_ENV` ≠ `production` (Prisma would log raw SQL incl. PII — see `docs/PRODUCTION_HARDENING.md`).

## Cost safety checklist (repeat after any infra change)

- [ ] Budget alarm at $10/mo is active (Billing → Budgets).
- [ ] Exactly one running instance, type t4g.micro (or t4g.small if resized).
- [ ] EBS volume 20GB gp3; no orphaned volumes or snapshots piling up.
- [ ] Elastic IP is attached (unattached EIPs are billed hourly).
- [ ] S3 bucket only holds app media + recent backups (prune old backups).
- [ ] No load balancers, NAT gateways, RDS, or other paid services created — everything runs on the one instance.
