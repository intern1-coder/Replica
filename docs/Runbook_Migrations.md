# Runbook: Deploying Prisma Migrations

## Overview
Affinity Workspace explicitly **disables** automatic Prisma migrations on app boot to ensure database integrity and safety. All schema migrations MUST be run manually by an operator.

## Prerequisites
- SSH access to the production server.
- The `affinity-backend` Docker container must be running (or the Node environment must have `DATABASE_URL` correctly configured).

## Procedure

1. SSH into the production server.
2. Navigate to the backend directory (where `docker-compose.yml` resides).
3. Execute the migration deployment command inside the running app container:

```bash
docker-compose exec app npx prisma migrate deploy
```

4. Verify the output. It should say `No pending migrations to apply` or indicate that migrations were successfully applied.
5. (Optional but recommended) Ensure PM2 restarts the application gracefully to pick up the new generated Prisma client if the container was rebuilt or if it caches any schema. In a containerized environment, restarting the container is safest:

```bash
docker-compose restart app
```

## Rollback
If a migration fails or causes issues, refer to standard PostgreSQL backup restoration procedures using the nightly backups stored in OCI Object Storage.
