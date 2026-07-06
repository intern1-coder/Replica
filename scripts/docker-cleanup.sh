#!/usr/bin/env bash
# Safe post-deploy Docker cleanup for Affinity production (single-container model).
# Removes leftover blue/green/test containers, dangling images, and old pre-deploy dumps.
set -euo pipefail

log() { echo "[docker-cleanup] $(date '+%H:%M:%S') $*"; }

JUNK_CONTAINERS=(
  affinity_app_blue
  affinity_app_green
  affinity_test_db
)

log "Starting Docker cleanup"

# Remove stopped junk containers from blue-green or test stacks
for name in "${JUNK_CONTAINERS[@]}"; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    log "Removing container: $name"
    docker rm -f "$name" >/dev/null 2>&1 || true
  fi
done

# Remove dangling image layers (safe — keeps images used by running containers)
PRUNED=$(docker image prune -f 2>&1 | tail -1)
log "Dangling images: ${PRUNED:-none}"

# Remove unused images older than 72h (keeps current affinity_app image)
UNUSED=$(docker image prune -a -f --filter "until=72h" 2>&1 | tail -1)
log "Unused images (>72h): ${UNUSED:-none}"

# Keep the 3 most recent pre-deploy SQL dumps; delete older ones
shopt -s nullglob
DUMPS=(/tmp/affinity_pre_deploy_*.sql.gz)
if ((${#DUMPS[@]} > 3)); then
  mapfile -t SORTED < <(ls -1t "${DUMPS[@]}")
  for ((i = 3; i < ${#SORTED[@]}; i++)); do
    log "Removing old pre-deploy dump: ${SORTED[$i]}"
    rm -f "${SORTED[$i]}"
  done
fi

log "Running containers:"
docker ps --filter "name=affinity" --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

log "Disk usage:"
docker system df

log "Cleanup complete"
