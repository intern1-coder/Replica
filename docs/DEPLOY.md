# Affinity — Production Deployment Runbook

Target: AWS EC2 t4g.micro (Graviton ARM64, 1GB RAM) · Ubuntu 24.04 · 5–10 users

Provision the instance first: see `docs/AWS_EC2_PROVISIONING.md` (EC2 launch, Security Group, Elastic IP, S3 bucket, IAM keys).

## Which deploy path do I use?

| Situation | How to deploy |
|-----------|---------------|
| **1GB EC2 (current)** | MobaXterm manual checklist below, **or** GitHub Actions **Deploy** workflow → [`scripts/deploy-single.sh`](../scripts/deploy-single.sh) |
| **≥2GB + zero downtime** | [`scripts/deploy.sh`](../scripts/deploy.sh) + GHCR image + [`backend/docker-compose.prod.yml`](../backend/docker-compose.prod.yml) — see [`docs/ZERO_DOWNTIME.md`](ZERO_DOWNTIME.md) |

**Do not mix** `docker-compose.yml` (single `affinity_app`) and `docker-compose.prod.yml` (blue/green) on the same server.

---

## 1. EC2 Instance Setup

```bash
sudo apt update && sudo apt upgrade -y

# Swap — REQUIRED on the 1GB t4g.micro (Puppeteer PDF generation needs it)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # confirm 2GB swap is active

# Docker
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER   # log out and back in after this

# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# Node.js 22 (needed for the frontend build in §4)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 2. Clone the Repo

```bash
sudo mkdir -p /app && sudo chown $USER:$USER /app
git clone <your-repo-url> /app
```

---

## 3. Create `/app/backend/.env`

```bash
cat > /app/backend/.env <<'EOF'
NODE_ENV=production

# Database — docker-compose.yml builds DATABASE_URL from these (host is the
# `db` service); do NOT set DATABASE_URL yourself.
POSTGRES_USER=affinity
POSTGRES_PASSWORD=<random-32-char-string>
POSTGRES_DB=affinity

JWT_SECRET=<random-64-char-string>
CORS_ORIGIN=https://yourdomain.com

# Public URLs — MUST be https in production (used to build emailed login/reset
# links). The backend refuses to start if these are not https when NODE_ENV=production.
FRONTEND_URL=https://yourdomain.com
APP_URL=https://yourdomain.com

# SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=<smtp-password>
EMAIL_FROM=noreply@yourdomain.com
EMAIL_FROM_NAME=Affinity Workspace

# AWS S3 (for file uploads) — bucket + IAM user from AWS_EC2_PROVISIONING.md
STORAGE_REGION=<region>              # e.g. eu-west-2
STORAGE_BUCKET_NAME=<bucket-name>
STORAGE_ACCESS_KEY_ID=<iam-access-key-id>
STORAGE_SECRET_ACCESS_KEY=<iam-secret-access-key>

# Alerts
ALERT_EMAIL=ops@yourdomain.com

# Admin bootstrap (scripts/bootstrap-users.ts) — server only, never commit real passwords
SUPER_ADMIN_EMAIL=it@vlookup.co.in
SUPER_ADMIN_PASSWORD=<super-admin-password-min-8-chars>
SUPER_ADMIN_NAME=Developer Admin
CLIENT_ADMIN_EMAIL=fahd@affinityproperty.co.uk
CLIENT_ADMIN_PASSWORD=<client-admin-password-min-8-chars>
CLIENT_ADMIN_NAME=Fahd
EOF
```

Generate a strong JWT secret: `openssl rand -hex 32` · database password: `openssl rand -hex 16`

**Admin bootstrap vars:** Used only when running `scripts/bootstrap-users.ts` inside Docker. They are **not** used for day-to-day login — passwords live in the database after bootstrap. See §6 and `docs/LESSONS_LEARNED.md` §11.

---

## 4. Run Database Migrations

```bash
cd /app/backend
docker compose run --rm app npx prisma migrate deploy
```

Expect output like `Applying migration \`20260706100000_add_super_admin_role\`` when a new migration
ships. If you see **fewer migrations than the repo** (e.g. 6 instead of 7) and "No pending migrations",
you have **not pulled the latest code** — `git pull` first, then re-run this step.

---

## 5. Start / Rebuild the Backend Stack

```bash
cd /app/backend
docker compose up -d --build
# Verify backend is up
curl http://localhost:3000/api/health
```

**Always `--build` after pulling backend changes** (Dockerfile, source, or new `scripts/` files).
A plain `docker compose up -d` reuses the old image and will miss new files such as
`scripts/bootstrap-users.ts`.

---

## 6. Bootstrap Super Admin + Client Admin (first deploy or password reset)

Run **inside the app container** (not on the host with `npm run bootstrap:users`):

```bash
cd /app/backend
docker compose exec app npx tsx scripts/bootstrap-users.ts
```

Expected output:

```
✓ Super Admin: it@vlookup.co.in (SUPER_ADMIN)
✓ Client Admin: fahd@affinityproperty.co.uk (ADMIN)
Bootstrap complete.
```

**Requirements:**

| Requirement | Why |
|---|---|
| `SUPER_ADMIN_*` and `CLIENT_ADMIN_*` in `/app/backend/.env` | Script reads env vars; also listed in `docker-compose.yml` so the running container sees them |
| Migration applied first | `SUPER_ADMIN` role must exist in the DB enum before bootstrap |
| Image rebuilt with `scripts/` copied | Dockerfile production stage must `COPY --from=builder /app/scripts ./scripts` |

**Do not re-run** after users have changed passwords unless you intentionally want to reset
those two accounts back to the `.env` values.

### Reset test data (keep admin users)

Use `scripts/reset-test-data.ts` to wipe jobs, properties, clients, engineers, and
related records while **preserving all User and Setting rows**.

```bash
# Optional backup first
docker compose exec db pg_dump -U $POSTGRES_USER $POSTGRES_DB | gzip > /tmp/pre_reset_$(date +%F).sql.gz

# Run reset inside app container
docker compose exec app npx tsx scripts/reset-test-data.ts
```

Local: `cd backend && npm run reset:test-data`

Re-run bootstrap only if you also wiped users (this script does not).

### Session logout after deploy

If users get logged out unexpectedly:

1. Ensure `JWT_SECRET` in `/app/backend/.env` did not change between deploys — changing it invalidates all tokens.
2. Confirm `/api/auth/me` returns **200** while logged in (401 = expired/invalid token; 500 = backend bug).
3. Set `JWT_EXPIRES_IN=7d` in `.env` — passed through `docker-compose.yml` to the app container.
4. Password changes bump `tokenVersion` and force re-login — this is expected.

---

## 7. Build the Frontend

```bash
cd /app/frontend
npm ci
npm run build
# Output lands in /app/frontend/dist — Caddy serves this directly
```

No frontend env vars are needed for the standard single-domain deployment: the
app calls relative `/api` and `/socket.io`, which Caddy proxies to the backend
on the same origin. Only set `VITE_API_URL` (in `/app/frontend/.env`) before
building if the API is hosted on a separate domain — see `frontend/.env.example`.

After rebuilding, reload Caddy if the site still shows old assets (requires
the systemd service from §10 to already be set up — a bare `caddy reload`
never sees `$DOMAIN`, since that substitution happens in the invoking
process's own environment, not the running server's):

```bash
sudo systemctl reload caddy
```

---

## 8. Start Caddy

```bash
# The Caddyfile imports /app/active-upstream.caddy (written by the blue-green
# deploy.sh on larger instances). On the single-container setup, create it
# once, pointing at the backend:
echo "reverse_proxy 127.0.0.1:3000" > /app/active-upstream.caddy

# Set your domain — Caddy will obtain a Let's Encrypt cert automatically
export DOMAIN=yourdomain.com
sudo DOMAIN=$DOMAIN caddy start --config /app/Caddyfile
```

---

## 9. Verify

```bash
curl https://yourdomain.com/api/health
# Expected: {"status":"ok"}
```

Also open `https://yourdomain.com` in a browser and confirm the frontend loads.

---

## 10. Enable Caddy as a systemd Service (survives reboots)

```bash
# Write an environment file so systemd passes DOMAIN to Caddy
echo "DOMAIN=yourdomain.com" | sudo tee /etc/caddy/env

# Override the Caddy unit to use your Caddyfile and env file
sudo mkdir -p /etc/systemd/system/caddy.service.d
sudo tee /etc/systemd/system/caddy.service.d/override.conf <<'EOF'
[Service]
EnvironmentFile=/etc/caddy/env
ExecStart=
ExecStart=/usr/bin/caddy run --environ --config /app/Caddyfile
ExecReload=
ExecReload=/usr/bin/caddy reload --config /app/Caddyfile --force
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now caddy
sudo systemctl status caddy
```

Also ensure Docker starts on boot (enabled by default after install — confirm with):

```bash
sudo systemctl enable docker
```

---

## 11. Firewall: Open Ports 80 and 443 Only

**AWS Security Group** (set at instance launch — see `AWS_EC2_PROVISIONING.md`):

- Inbound: TCP `80` and `443` from `0.0.0.0/0`; TCP `22` from your IP only
- Do NOT add a rule exposing port `3000` to the internet

**ufw on the VM:**

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## 12. Nightly Database Backups to S3

```bash
# AWS CLI v2 (the `awscli` apt package does not exist on Ubuntu 24.04)
cd /tmp
curl -s "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o awscliv2.zip
sudo apt install -y unzip && unzip -q awscliv2.zip && sudo ./aws/install
rm -rf /tmp/aws /tmp/awscliv2.zip

chmod +x /app/scripts/backup-db.sh
/app/scripts/backup-db.sh   # test run — should print "backup OK"
crontab -e                  # add:  0 2 * * * /app/scripts/backup-db.sh >> /var/log/affinity-backup.log 2>&1
sudo touch /var/log/affinity-backup.log && sudo chown $USER /var/log/affinity-backup.log
```

Backups land in `s3://<bucket>/backups/`, credentials come from `/app/backend/.env`, retention 30 days (pruned by the script). Restore command is documented at the top of `scripts/backup-db.sh`.

---

## Quick Reference — Common Operations

| Task | Command |
|------|---------|
| View backend logs | `cd /app/backend && docker compose logs -f app` |
| Restart backend | `cd /app/backend && docker compose restart app` |
| Reload Caddy config | `sudo systemctl reload caddy` |
| Run a migration | `cd /app/backend && docker compose run --rm app npx prisma migrate deploy` |
| Bootstrap super + client admin | `cd /app/backend && docker compose exec app npx tsx scripts/bootstrap-users.ts` |
| Reset test data (keep users) | `cd /app/backend && docker compose exec app npx tsx scripts/reset-test-data.ts` |
| Clean up junk Docker artifacts | `chmod +x /app/scripts/docker-cleanup.sh && /app/scripts/docker-cleanup.sh` |

---

## Docker cleanup (one-time + after each deploy)

Production on the 1GB instance should only run **`affinity_app`** and **`affinity_db`**. Leftover blue/green or test containers waste disk and RAM.

**One-time audit in MobaXterm** (run before first cleanup):

```bash
docker ps -a --filter "name=affinity"
docker images | grep -E 'affinity|ghcr'
cat /app/active-upstream.caddy   # expect: reverse_proxy 127.0.0.1:3000
```

**Remove junk** (only after confirming `affinity_app` and `affinity_db` are healthy):

```bash
chmod +x /app/scripts/docker-cleanup.sh
/app/scripts/docker-cleanup.sh
```

The script removes stopped `affinity_app_blue`, `affinity_app_green`, and `affinity_test_db` containers, prunes dangling/unused images, and keeps the 3 newest pre-deploy SQL dumps in `/tmp`.

**Never remove:** `affinity_db`, the `pgdata` volume, `/app/backend/.env`, or the Caddy systemd service.

---

## Ongoing deploy checklist (code + schema changes)

**When:** After every PR is merged to `master`. Merging on GitHub does **not** update the server — you must SSH and run this.

The same block appears automatically in every new pull request (`.github/pull_request_template.md`).

Use this order every time you ship backend or auth changes:

```bash
cd /app
git pull origin master            # 1. get latest code + migrations (always master)

cd /app/backend
docker compose up -d --build      # 2. rebuild image (required for new scripts/source)
docker compose run --rm app npx prisma migrate deploy   # 3. apply migrations
docker compose exec app npx tsx scripts/bootstrap-users.ts   # 4. only if admin accounts new/reset

/app/scripts/docker-cleanup.sh    # 5. remove junk containers/images and old pre-deploy dumps

cd /app/frontend
npm ci && npm run build           # 6. rebuild frontend
sudo systemctl reload caddy       # 7. if UI looks stale
```

Verify: `curl https://yourdomain.com/api/health` and log in as SUPER_ADMIN and client ADMIN.
