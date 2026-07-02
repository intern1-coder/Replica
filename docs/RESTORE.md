# Database Restore Runbook

Short reference for restoring the Affinity database from an OCI Object Storage backup.

---

## 1. Find the backup

Backups live in the OCI bucket under two prefixes:

- `backups/daily/` — one per day, retained for 30 days
- `backups/monthly/` — created on the 1st of each month, kept indefinitely

List available backups (requires OCI CLI configured):

```bash
oci os object list --bucket-name <BUCKET_NAME> --prefix backups/daily/
oci os object list --bucket-name <BUCKET_NAME> --prefix backups/monthly/
```

Or browse in the OCI Console: **Storage → Object Storage → \<bucket\> → Objects**.

---

## 2. Download the backup

Via OCI CLI:

```bash
oci os object get \
  --bucket-name <BUCKET_NAME> \
  --name backups/daily/affinity_db_YYYY-MM-DD.sql.gz \
  --file affinity_db_YYYY-MM-DD.sql.gz
```

Or download through the OCI Console (select the object → **Download**).

---

## 3. Restore

```bash
# Decompress and pipe straight into Postgres
gunzip -c affinity_db_YYYY-MM-DD.sql.gz | psql "$DATABASE_URL"
```

- `DATABASE_URL` must point to the **target** database (not production unless intentional).
- The target database should be empty or it should be safe to overwrite existing data.
- If the target DB already has objects, drop and recreate it first:
  ```bash
  psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  ```

---

## 4. Verify

After the restore, run a quick sanity check:

```bash
psql "$DATABASE_URL" <<'SQL'
SELECT 'jobs'    AS tbl, COUNT(*) FROM jobs
UNION ALL
SELECT 'clients',        COUNT(*) FROM clients
UNION ALL
SELECT 'users',          COUNT(*) FROM users
UNION ALL
SELECT 'properties',     COUNT(*) FROM properties;
SQL
```

- Row counts should be non-zero and roughly match the expected production numbers.
- Log in to the app and verify a recent job loads correctly.

---

## 5. Monthly restore drill

Run a restore drill once a month to confirm backups are valid and the runbook is current:

1. Download the latest monthly backup to a scratch environment.
2. Restore using step 3 above.
3. Run the verification queries in step 4.
4. Record the drill date and any issues in the team ops log.
