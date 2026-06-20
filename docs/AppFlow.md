# AppFlow.md — Affinity Workspace

## Who uses this

A 5-person internal team only — roles are `PM`, `ADMIN`, `ACCOUNTS`, `OWNER`. There is **no contractor-facing app** in this MVP. The PM is the single point of data entry for every job: contractors don't log in, don't update statuses, and don't upload their own photos. If a contractor reports something, the PM enters it on their behalf.

## Authentication — Magic Link

1. User lands on the login screen and enters their work email.
2. Backend checks the email against active `User` records, generates a token, stores `magicLinkTokenHash` + `magicLinkExpiresAt` on the user, and sends a one-time login link via Resend/Brevo (port 587 — see TechSpec.md).
3. User clicks the link from their email client.
4. Backend validates the token against the hash and expiry, issues a session (JWT), and clears the magic-link fields.
5. User lands on the Dashboard.

There is no password flow, no signup flow, and no self-service account creation — users are provisioned directly in the database by an admin, consistent with a fixed 5-person team.

## Core Screens

- **Dashboard** — Daily Task Sheet equivalent: a computed view over `AuditLog`, `CommunicationLog`, and `Job` showing what changed recently and what needs PM attention today.
- **Job List** — filterable/sortable table by `JobStatus`, replaces the old MLDB spreadsheet. High density, not card-based (see Design.md).
- **Job Detail** — the hub for a single job: status control, diagnostic/completion notes, assigned contractor, media (diagnostic/completion photos), work logs, communication log, and generated documents (Quote / Job Sheet / Completion Report).
- **Logistics Grid** — daily schedule view built from `WorkLog` entries (date + contractor), replacing the old Daily Schedule sheet.
- **Clients & Properties** — client company records and property records, including tenant history and access notes (key location, current tenant contact).
- **P&L View** — per-job (and rollup) profit view driven by the raw SQL aggregation over `Job` + `WorkLog` (see Schema.md).

## Job State Machine

```
TO_BE_CHECKED → CHECKED → QUOTED → AUTHORISED → COMPLETED
                                                 ↘ CANCELLED
```

- `CANCELLED` is reachable from the active states, not just a terminal step after `COMPLETED`.
- Transitions are enforced in application code (`services/jobStateMachine.js`) — only PM/ADMIN-permitted transitions are accepted.
- Every transition is optimistically locked against the `version` field on `Job`: the update only succeeds if the version the client is editing against still matches the database, preventing two PMs from silently clobbering each other's status change.
- Every status change is written to `AuditLog` (`action: 'status_changed'`, with `before`/`after` snapshots) — this is how the Dashboard's activity feed and the 2-year history requirement are satisfied.

## Data Entry Constraints (deliberate, not gaps)

- **No contractor-facing app.** All job data — diagnostics, completion notes, hours worked, materials — is entered by the PM, even when the source of truth is a contractor's phone call or WhatsApp message.
- **No automated client or tenant communication.** The system never sends an email, WhatsApp message, or notification to a client or tenant on its own. Every outbound communication is a deliberate PM action, and every one of those actions — call, email, or WhatsApp, in either direction — is logged in `CommunicationLog` with an explicit outcome (`CONFIRMED`, `NO_RESPONSE`, `SENT`).
- **Documents are generated, not auto-sent.** Quotes, job sheets, and completion reports are generated as immutable PDF snapshots on explicit PM request; whether and how they're sent to the client remains a manual step, optionally recorded via `sentTo` on the `GeneratedDocument` record.

This "PM as sole gatekeeper" pattern is the throughline for the whole app flow: nothing leaves the system, and no job record changes, without a PM explicitly doing it.
