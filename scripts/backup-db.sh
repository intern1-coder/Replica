#!/usr/bin/env bash
# Nightly Postgres backup to S3.
# Install (on the EC2 instance):
#   sudo apt install -y awscli
#   chmod +x /app/scripts/backup-db.sh
#   crontab -e   ->   0 2 * * * /app/scripts/backup-db.sh >> /var/log/affinity-backup.log 2>&1
#
# Restore:
#   aws s3 cp s3://<bucket>/backups/<file> - | gunzip | \
#     docker compose -f /app/backend/docker-compose.yml exec -T db psql -U <user> <db>
set -euo pipefail

ENV_FILE=/app/backend/.env
COMPOSE="docker compose -f /app/backend/docker-compose.yml"
RETENTION_DAYS=30

# Pull credentials from the backend .env (single source of truth)
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
PGUSER=$(get POSTGRES_USER)
PGDB=$(get POSTGRES_DB)
BUCKET=$(get STORAGE_BUCKET_NAME)
export AWS_ACCESS_KEY_ID=$(get STORAGE_ACCESS_KEY_ID)
export AWS_SECRET_ACCESS_KEY=$(get STORAGE_SECRET_ACCESS_KEY)
export AWS_DEFAULT_REGION=$(get STORAGE_REGION)

STAMP=$(date -u +%Y%m%d_%H%M%S)
FILE="affinity_${STAMP}.sql.gz"
TMP="/tmp/${FILE}"

$COMPOSE exec -T db pg_dump -U "$PGUSER" "$PGDB" | gzip > "$TMP"
aws s3 cp "$TMP" "s3://${BUCKET}/backups/${FILE}" --only-show-errors
rm -f "$TMP"

# Prune S3 backups older than RETENTION_DAYS (IAM policy allows DeleteObject)
CUTOFF=$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%d)
aws s3 ls "s3://${BUCKET}/backups/" | awk '{print $4}' | while read -r key; do
  [ -z "$key" ] && continue
  fdate=$(echo "$key" | sed -n 's/^affinity_\([0-9]\{8\}\)_.*/\1/p')
  if [ -n "$fdate" ] && [ "$fdate" -lt "$CUTOFF" ]; then
    aws s3 rm "s3://${BUCKET}/backups/${key}" --only-show-errors
  fi
done

echo "$(date -u '+%F %T') backup OK: ${FILE}"
