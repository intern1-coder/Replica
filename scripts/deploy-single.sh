#!/usr/bin/env bash
# Single-container production deploy for 1GB EC2 (t4g.micro).
# Builds on-server via docker-compose.yml — do NOT use deploy.sh (blue-green) on 1GB.
set -euo pipefail

UPSTREAM_FILE="/app/active-upstream.caddy"

log() { echo "[deploy-single] $(date '+%H:%M:%S') $*"; }

log "Starting single-container deploy"

# Ensure Caddy routes to the single app container on port 3000
echo "reverse_proxy 127.0.0.1:3000" > "$UPSTREAM_FILE"

cd /app/backend
log "Building and starting backend (docker-compose.yml)..."
docker compose up -d --build

log "Running database migrations..."
docker compose run --rm app npx prisma migrate deploy

if [ -x /app/scripts/docker-cleanup.sh ]; then
  log "Running post-deploy Docker cleanup..."
  /app/scripts/docker-cleanup.sh
else
  log "WARNING: /app/scripts/docker-cleanup.sh not found or not executable — skipping cleanup"
fi

log "Building frontend..."
cd /app/frontend
npm ci
npm run build

log "Reloading Caddy..."
sudo caddy reload --config /app/Caddyfile

log "Verifying health..."
curl -sf http://127.0.0.1:3000/api/health > /dev/null
log "Deploy complete. Active: affinity_app on port 3000"
