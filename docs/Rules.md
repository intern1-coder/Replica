# Rules.md — Affinity Workspace AI Agent Guardrails

These rules are non-negotiable constraints for any AI agent (or human) writing code in this project. They exist because the PRD made specific, deliberate tradeoffs — violating these rules silently reverses those decisions.

## Language

- Write exclusively in **TypeScript / TSX**. Use `.ts` for backend files and `.tsx` for frontend React components. A `tsconfig.json` is required. Enable `strict` mode — the type system is a feature, not a formality.
- The Prisma schema file (`schema.prisma`) is its own DSL, not TypeScript, and is therefore fine as-is.

## Database Access

- Use **Prisma** (`prisma.model.method(...)`) for all standard CRUD and query operations.
- Use **raw SQL only** for the P&L aggregation query (the `jobs`/`work_logs` join-and-sum documented in `Schema.md`). Do not introduce additional raw SQL for things Prisma's query builder already handles cleanly — raw SQL is the deliberate exception, not the default.
- **Never auto-apply migrations on application boot.** Migrations run only via an explicit, manual `prisma migrate deploy` step in the deployment process. Do not add migration logic to server startup code, health checks, or any code path that runs automatically.

## Error Handling

- Catch Prisma foreign-key violation and unique-constraint errors explicitly (`P2002`, `P2003`, etc.) and translate them into clean `409` (conflict) or `422` (unprocessable entity) API responses — never let a raw Prisma/Postgres stack trace reach the client.
- Optimistic-locking failures on `Job.version` updates should return a clear `409`, distinguishable from a generic validation error, so the frontend can prompt a refresh rather than silently retry-overwriting someone else's change.

## Immutability

- **Never build update or delete routes against `AuditLog`.** It is append-only by design — this is a hard constraint, not a default that can be relaxed later for convenience. If a feature seems to need editing an audit entry, that's a sign the feature needs a new audit entry instead.
- Do not regenerate or overwrite an existing `GeneratedDocument` row's `storageKey` or `snapshotData` in place. A new version of a quote/report is a new row.
- Do not let frozen fields (`Job.tenantSnapshotName`/`tenantSnapshotPhone`, `WorkLog.rateApplied`) be silently recomputed from live data on update — they are captured once, at creation/log time, by design.

## Infrastructure & Architecture

- Account for **ARM64** architecture explicitly when touching `sharp` or `puppeteer-core`. For `puppeteer-core`, never assume a bundled-Chromium download will work — Chromium must be installed via `apt` and referenced via an explicit `executablePath`. Don't reintroduce plain `puppeteer` (which auto-downloads Chromium) as a dependency.
- Outbound email goes through the transactional API (Resend/Brevo) over **port 587**, never raw SMTP on port 25.
- Do not introduce Kubernetes, OKE, or a load balancer into the deployment — the architecture is deliberately a single VM with Docker Compose + Nginx + Certbot.

## Workflow & Automation Boundaries

- Do not build any code path that sends a communication (email, WhatsApp, SMS) to a client or tenant without an explicit, synchronous PM action triggering it in that request. No background jobs, no triggers-on-status-change, no "send automatically when X happens" logic for client/tenant-facing communication.
- Do not build a contractor-facing login, app, or self-service interface. The PM remains the sole point of data entry for job, work log, and media data in this MVP.
- Every state transition on `Job` must go through `services/jobStateMachine.js` — do not write ad-hoc status updates elsewhere that bypass the transition map or the optimistic-locking check.

## When in Doubt

If a request would require violating any rule above to implement as asked, stop and flag the conflict rather than silently picking a workaround — these constraints were chosen deliberately in the PRD's Gap Register process, and a workaround that technically satisfies the feature request while violating a rule here is the wrong outcome.
