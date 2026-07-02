# Affinity — Production Deployment Runbook

Target: Oracle Cloud Free Tier VM · Ubuntu 22.04 ARM (Ampere A1) · ~20 users

---

## 1. Oracle VM Setup

```bash
sudo apt update && sudo apt upgrade -y

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
DATABASE_URL="postgresql://user:password@host:5432/affinity?connection_limit=15"
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

# OCI Object Storage (for file uploads)
OCI_NAMESPACE=<oci-namespace>
OCI_BUCKET=<bucket-name>
OCI_REGION=<region>           # e.g. ap-mumbai-1
OCI_ACCESS_KEY=<access-key>
OCI_SECRET_KEY=<secret-key>

# Alerts
ALERT_EMAIL=ops@yourdomain.com
EOF
```

Generate a strong JWT secret: `openssl rand -hex 32`

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

**OCI Security List** (in the OCI console):

- Ingress rule: TCP · Source `0.0.0.0/0` · Destination port `80`
- Ingress rule: TCP · Source `0.0.0.0/0` · Destination port `443`
- Remove or restrict any rule exposing port `3000` to the internet

**ufw on the VM:**

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

---

## Quick Reference — Common Operations

| Task | Command |
|------|---------|
| View backend logs | `cd /app/backend && docker compose logs -f app` |
| Restart backend | `cd /app/backend && docker compose restart app` |
| Reload Caddy config | `sudo caddy reload --config /app/Caddyfile` |
| Run a migration | `cd /app/backend && docker compose run --rm app npx prisma migrate deploy` |
| Rebuild frontend | `cd /app/frontend && npm ci && npm run build` |
