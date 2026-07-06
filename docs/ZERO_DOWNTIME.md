# Zero-Downtime Deployments

> **Note (AWS, 2026-07):** blue-green is NOT used on the current t4g.micro (1GB RAM) instance — running two backend containers side by side doesn't fit. Production deploys use the single-container flow in `docs/DEPLOY.md` / `scripts/deploy-single.sh`. **This doc and `scripts/deploy.sh` apply only if the instance is resized to ≥2GB.**

> **Deprecated on 1GB:** Do not run `scripts/deploy.sh` or the old blue-green Deploy workflow on the current instance. It creates `affinity_app_blue` / `affinity_app_green` junk containers. Use `scripts/deploy-single.sh` instead.

## How blue-green works

Two containers run on the VM:

| Slot  | Port |
|-------|------|
| app_blue  | 3001 |
| app_green | 3002 |

Caddy reads `/app/active-upstream.caddy` to know which slot is live:

```
reverse_proxy 127.0.0.1:3001   # blue is live
```

Only the active slot is running under normal operation. During a deploy there is a ~10-second window where both containers exist simultaneously before the old one is stopped.

---

## How to deploy

### (a) Manual — SSH to the VM

```bash
ssh user@your-vm
/app/scripts/deploy.sh <sha-or-tag>
# e.g. /app/scripts/deploy.sh sha256abc  or  /app/scripts/deploy.sh latest
```

### (b) GitHub Actions UI

1. Go to **Actions** → **Deploy to Production**
2. Click **Run workflow**
3. Enter the image tag (defaults to `latest`)
4. Click **Run workflow**

The workflow SSHes into the VM and calls `deploy.sh` for you.

---

## How to rollback

**Fast rollback (seconds)** — restores the previously stopped container:

```bash
ssh user@your-vm
/app/scripts/rollback.sh
```

**Re-deploy an older image tag:**

```bash
/app/scripts/deploy.sh <previous-sha>
```

---

## Migration safety — expand/contract rule

Because blue and green briefly overlap during a deploy, database migrations must be backward-compatible with the previous release:

1. **Release N** — add the new column (both old and new app code must tolerate its presence).
2. **Release N+1** — remove the old column once no running container references it.

This two-step pattern means neither the old nor the new container ever encounters a schema it cannot handle during the ~10-second overlap.

---

## Required GitHub secrets

Set these in **Settings → Secrets and variables → Actions → New repository secret** (scope to the `production` environment):

| Secret | Value |
|--------|-------|
| `VM_HOST` | Elastic IP or hostname of the AWS EC2 instance |
| `VM_USER` | SSH username (`ubuntu`) |
| `VM_SSH_KEY` | Contents of the SSH private key (the EC2 key pair `.pem`) |

---

## First-time VM setup

Run once before the first deploy:

```bash
# Create directories
mkdir -p /app/scripts /app/backend

# Initialise the active-slot tracker
echo blue > /app/scripts/.active

# Create initial Caddy upstream file (blue on 3001)
echo "reverse_proxy 127.0.0.1:3001" > /app/active-upstream.caddy

# Reload Caddy so it picks up the file
systemctl reload caddy   # or: caddy reload --config /etc/caddy/Caddyfile
```

Place `deploy.sh` and `rollback.sh` in `/app/scripts/` and make them executable (`chmod +x`).
