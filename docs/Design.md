# Design.md — Affinity Workspace

## Design Philosophy

This is an internal back-office tool for 5 trusted users doing data entry all day, not a consumer product trying to win anyone over. The design language optimizes for **information density and scan speed**, deliberately at the expense of consumer-SaaS polish — large hero sections, generous card padding, soft illustration, and marketing-style whitespace are all explicitly out of scope.

Guiding principle: a PM should be able to scan the Job List and tell the state of 20 jobs at a glance, the same way they could scan the old MLDB spreadsheet — the new system needs to feel like an *upgrade* on that scanning speed, not a downgrade in the name of looking modern.

## Layout & Density

- **Tables over cards.** Job List, Logistics Grid, Client/Property lists, and Work Log entries are dense tabular layouts, not card grids — more rows visible per screen, less scrolling.
- **Compact row height.** Favor tight vertical rhythm in tables over generous line-height; this is a tool used for hours a day, not a landing page.
- **Tabular figures** for all numeric columns (hours, rates, costs, quoted values) so columns of numbers align visually — this matters directly for the P&L view.
- **Inline editing where possible** over modal-heavy workflows, to keep the PM in the table/grid rather than navigating away and back.

## Color Palette — Mapped to Job Status

Status color is the single most important visual signal in the app, since the whole workflow is organized around the `JobStatus` state machine. Each status gets one consistent, unambiguous color used everywhere that status appears (table rows, badges, Job Detail header, Logistics Grid).

| Status | Color | Rationale |
|---|---|---|
| `TO_BE_CHECKED` | Neutral grey | Nothing has happened yet — lowest visual weight |
| `CHECKED` | Blue | Acknowledged/in-progress, informational, no urgency |
| `QUOTED` | Amber/orange | Awaiting a decision — deliberately the "needs attention" color since quotes sitting unanswered are a real business risk |
| `AUTHORISED` | Green | Approved and active — the "good to proceed" signal |
| `COMPLETED` | Muted teal/dark green | Done, but visually calmer than `AUTHORISED` so completed jobs don't compete for attention with active ones |
| `CANCELLED` | Muted red/grey-red | Closed negatively — present but deliberately low-saturation so it doesn't read as an urgent alert in a list full of active jobs |

Design rules that follow from this:
- Status colors are **never reused** for anything else in the UI (no decorative use of amber/green/red elsewhere) — if a color appears, it means a specific job status, full stop.
- Status is conveyed by color **and** text label together, never color alone (accessibility, and because PMs may be scanning quickly under bad lighting on a job site).
- The base UI chrome (nav, backgrounds, table borders) stays neutral/desaturated specifically so the status colors stand out against it rather than competing with it.

## Typography

- A system font stack or a single workhorse sans-serif (no display/decorative fonts) — legibility at small sizes in dense tables matters more than personality.
- Numeric data (hours, rates, £ values) uses tabular/monospaced figures.
- Clear weight hierarchy between primary identifiers (job number, client name) and secondary metadata (timestamps, who performed an action), so the eye can skip straight to the identifying info in a dense list.

## What this explicitly is not

- Not a dashboard-as-marketing-page aesthetic (no oversized KPI hero tiles, no gradient backgrounds, no illustration).
- Not optimized for first-time-user delight — optimized for daily-user efficiency, since the same 5 people will use it for years.
- Not mobile-first — this is a desktop, back-office tool; mobile/tablet just needs to remain usable, not be the primary design target.
