#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="/app/backend/docker-compose.prod.yml"
ACTIVE_FILE="/app/scripts/.active"
UPSTREAM_FILE="/app/active-upstream.caddy"

ACTIVE=$(cat "$ACTIVE_FILE" 2>/dev/null || echo "blue")
if [ "$ACTIVE" = "blue" ]; then
  PREV="green"
  PREV_PORT=3002
else
  PREV="blue"
  PREV_PORT=3001
fi

log() { echo "[rollback] $(date '+%H:%M:%S') $*"; }

log "Rolling back: stopping app_${ACTIVE}, restoring app_${PREV} on port ${PREV_PORT}"

docker compose -f "$COMPOSE_FILE" start "app_${PREV}"

# Wait for health
ELAPSED=0
until curl -sf "http://127.0.0.1:${PREV_PORT}/api/health" > /dev/null 2>&1; do
  sleep 1
  ELAPSED=$((ELAPSED + 1))
  if [ "$ELAPSED" -ge 30 ]; then
    log "ERROR: Previous version not healthy after 30s — manual intervention needed"
    exit 1
  fi
done

echo "reverse_proxy 127.0.0.1:${PREV_PORT}" > "$UPSTREAM_FILE"
# Must go through systemd, not a bare `caddy reload` — {$DOMAIN} substitution
# happens in the invoking process's own environment, which a direct call
# doesn't have. `systemctl reload` inherits the unit's
# EnvironmentFile=/etc/caddy/env (see docs/DEPLOY.md §10) and already runs
# with --force per the unit's ExecReload override.
sudo systemctl reload caddy

docker compose -f "$COMPOSE_FILE" stop "app_${ACTIVE}"
echo "$PREV" > "$ACTIVE_FILE"

log "Rollback complete. Active: $PREV. Run 'deploy.sh <tag>' to redeploy when ready."
