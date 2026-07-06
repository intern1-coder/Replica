# Affinity — Production Deployment Runbook

Target: AWS EC2 t4g.micro (Graviton ARM64, 1GB RAM) · Ubuntu 24.04 · 5–10 users

Provision the instance first: see `docs/AWS_EC2_PROVISIONING.md` (EC2 launch, Security Group, Elastic IP, S3 bucket, IAM keys).

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
SMTP_FROM=noreply@yourdomain.com

# AWS S3 (for file uploads) — bucket + IAM user from AWS_EC2_PROVISIONING.md
STORAGE_REGION=<region>              # e.g. eu-west-2
STORAGE_BUCKET_NAME=<bucket-name>
STORAGE_ACCESS_KEY_ID=<iam-access-key-id>
STORAGE_SECRET_ACCESS_KEY=<iam-secret-access-key>

# Alerts
ALERT_EMAIL=ops@yourdomain.com
EOF
```

Generate a strong JWT secret: `openssl rand -hex 32` · database password: `openssl rand -hex 16`

---

## 4. Build the Frontend

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

---

## 5. Run Database Migrations

```bash
cd /app/backend
docker compose run --rm app npx prisma migrate deploy
```

---

## 6. Start the Backend Stack

```bash
cd /app/backend
docker compose up -d
# Verify backend is up
curl http://localhost:3000/api/health
```

---

## 7. Start Caddy

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

## 8. Verify

```bash
curl https://yourdomain.com/api/health
# Expected: {"status":"ok"}
```

Also open `https://yourdomain.com` in a browser and confirm the frontend loads.

---

## 9. Enable Caddy as a systemd Service (survives reboots)

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

## 10. Firewall: Open Ports 80 and 443 Only

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

## 11. Nightly Database Backups to S3

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
| Reload Caddy config | `sudo caddy reload --config /app/Caddyfile` |
| Run a migration | `cd /app/backend && docker compose run --rm app npx prisma migrate deploy` |
| Bootstrap super + client admin | `cd /app/backend && npm run bootstrap:users` (reads `SUPER_ADMIN_*` and `CLIENT_ADMIN_*` from `.env`) |
| Rebuild frontend | `cd /app/frontend && npm ci && npm run build` |
