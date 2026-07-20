## Summary

<!-- What changed and why (1–3 bullets) -->

-

## Test plan

- [ ] CI passes (backend + frontend checks on this PR)
- [ ] Tested locally (if UI/backend behaviour changed)

---

## After merge — run on production server

Copy-paste in MobaXterm (SSH to EC2). **Always pull `master` only.**

```bash
cd /app
git checkout master
git pull origin master

cd /app/backend
docker compose up -d --build
docker compose run --rm app npx prisma migrate deploy

/app/scripts/docker-cleanup.sh

cd /app/frontend
npm ci && npm run build

sudo systemctl reload caddy
```

**Verify:**

```bash
curl -sf https://affinity.agentik360.com/api/health
```

Then smoke-test in the browser (login, changed screens).

### Only when this PR includes…

| Change | Extra step |
|--------|------------|
| New Prisma migration | `migrate deploy` (in block above) — required |
| New/edited `backend/scripts/*.ts` | `docker compose up -d --build` — required (rebuild image) |
| Frontend only | Still run `npm ci && npm run build` + Caddy reload |
| New admin accounts / password reset | `docker compose exec app npx tsx scripts/bootstrap-users.ts` |
| Wipe jobs/properties/clients (keep users) | `docker compose exec app npx tsx scripts/reset-test-data.ts` |

Full reference: [`docs/DEPLOY.md`](../docs/DEPLOY.md) — Ongoing deploy checklist.

---

## Housekeeping

- [ ] Base branch is **`master`**
- [ ] Delete this branch on GitHub after merge
