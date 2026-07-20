#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="/app/backend/docker-compose.prod.yml"
ACTIVE_FILE="/app/scripts/.active"
UPSTREAM_FILE="/app/active-upstream.caddy"
HEALTH_TIMEOUT=30

IMAGE_TAG="${1:-latest}"
export IMAGE_TAG

# Read current active color (default blue on first run)
ACTIVE=$(cat "$ACTIVE_FILE" 2>/dev/null || echo "blue")
if [ "$ACTIVE" = "blue" ]; then
  TARGET="green"
  TARGET_PORT=3002
else
  TARGET="blue"
  TARGET_PORT=3001
fi

log() { echo "[deploy] $(date '+%H:%M:%S') $*"; }

log "Starting deploy: image tag=$IMAGE_TAG, active=$ACTIVE, target=$TARGET"

# ── Step 1: Pull the new image ─────────────────────────────────────────────────
log "Pulling image ghcr.io/${GHCR_OWNER}/affinity-backend:${IMAGE_TAG}..."
docker compose -f "$COMPOSE_FILE" pull "app_${TARGET}"

# ── Step 2: Pre-deploy database backup ────────────────────────────────────────
log "Taking pre-deploy database backup..."
BACKUP_TAG="${IMAGE_TAG}-$(date '+%Y%m%d-%H%M%S')"
BACKUP_FILE="/tmp/affinity_pre_deploy_${BACKUP_TAG}.sql.gz"
# Run pg_dump from inside the active app container (has postgresql-client from Dockerfile)
docker compose -f "$COMPOSE_FILE" exec -T "app_${ACTIVE}" \
  pg_dump "${DATABASE_URL}" | gzip > "$BACKUP_FILE" || {
  log "WARNING: pre-deploy backup failed — aborting deploy"
  exit 1
}
log "Backup saved locally to $BACKUP_FILE"

# ── Step 3: Gated migration ────────────────────────────────────────────────────
log "Running database migrations..."
docker compose -f "$COMPOSE_FILE" run --rm --no-deps "app_${TARGET}" \
  npx prisma migrate deploy || {
  log "ERROR: Migration failed — aborting deploy. DB is intact. Restore from $BACKUP_FILE if needed."
  exit 1
}
log "Migrations applied successfully"

# ── Step 4: Start the target container ────────────────────────────────────────
log "Starting app_${TARGET}..."
docker compose -f "$COMPOSE_FILE" up -d --no-deps "app_${TARGET}"

# ── Step 5: Health-gate ────────────────────────────────────────────────────────
log "Waiting for app_${TARGET} to pass health check on port ${TARGET_PORT}..."
ELAPSED=0
until curl -sf "http://127.0.0.1:${TARGET_PORT}/api/health" > /dev/null 2>&1; do
  sleep 1
  ELAPSED=$((ELAPSED + 1))
  if [ "$ELAPSED" -ge "$HEALTH_TIMEOUT" ]; then
    log "ERROR: Health check timed out after ${HEALTH_TIMEOUT}s — stopping app_${TARGET}, old version still serving"
    docker compose -f "$COMPOSE_FILE" stop "app_${TARGET}"
    exit 1
  fi
done
log "Health check passed in ${ELAPSED}s"

# ── Step 5b: Log-safety config gate ────────────────────────────────────────────
# Verify the target container runs with NODE_ENV=production. This is what keeps
# Prisma query/param debug logging (raw SQL incl. accessNotes, keyLocation, phone,
# email) OFF in production — see docs/PRODUCTION_HARDENING.md (Logging policy).
# If it's wrong, abort BEFORE flipping traffic; the old version keeps serving.
log "Verifying NODE_ENV=production on app_${TARGET}..."
CONTAINER_ENV=$(docker compose -f "$COMPOSE_FILE" exec -T "app_${TARGET}" printenv NODE_ENV 2>/dev/null | tr -d '\r' || echo "")
if [ "$CONTAINER_ENV" != "production" ]; then
  log "ERROR: app_${TARGET} has NODE_ENV='${CONTAINER_ENV}' (expected 'production'). Raw query logging could leak PII. Aborting — stopping app_${TARGET}, old version still serving."
  docker compose -f "$COMPOSE_FILE" stop "app_${TARGET}"
  exit 1
fi
log "NODE_ENV=production confirmed"

# ── Step 6: Flip Caddy traffic ─────────────────────────────────────────────────
log "Flipping traffic to app_${TARGET} (port ${TARGET_PORT})..."
echo "reverse_proxy 127.0.0.1:${TARGET_PORT}" > "$UPSTREAM_FILE"
# Must go through systemd, not a bare `caddy reload` — {$DOMAIN} substitution
# happens in the invoking process's own environment, which a direct call
# doesn't have. `systemctl reload` inherits the unit's
# EnvironmentFile=/etc/caddy/env (see docs/DEPLOY.md §10) and already runs
# with --force per the unit's ExecReload override.
sudo systemctl reload caddy
log "Traffic now routed to app_${TARGET}"

# ── Step 7: Stop the old container ────────────────────────────────────────────
log "Stopping app_${ACTIVE} (kept for rollback)..."
docker compose -f "$COMPOSE_FILE" stop "app_${ACTIVE}"

# ── Step 8: Record active color ────────────────────────────────────────────────
echo "$TARGET" > "$ACTIVE_FILE"

log "Deploy complete. Active: $TARGET (port $TARGET_PORT). Previous: $ACTIVE (stopped, ready for rollback)."
