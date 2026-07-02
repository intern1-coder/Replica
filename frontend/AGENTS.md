You are building frontend UI for this project. You MUST follow these constraints:

## Active Skills (loaded in `.agent/skills/`)
- **motion-design** — Emil Kowalski's animation rules: custom easing curves, sub-300ms durations, spring physics, GPU-only transforms, origin-aware popovers, no `scale(0)`, stagger discipline
- **design-vocabulary** — Production-grade design: contrast verification, OKLCH color, typography hierarchy, layout rhythm, interaction states, 20+ design commands (`/audit`, `/polish`, `/typeset`, etc.)
- **anti-slop** — Anti-slop framework: 3 config dials (DESIGN_VARIANCE=8, MOTION_INTENSITY=6, VISUAL_DENSITY=4), banned AI tells, layout diversification, premium materiality

## Hard Rules
1. **No AI tells** — no gradient text, side-stripe borders, glassmorphism defaults, numbered eyebrows, identical card grids, system font stacks, em-dash separators, scroll cues, stock avatars, "Learn More" CTAs
2. **Motion discipline** — UI <300ms, custom cubic-bezier easing, `transform`/`opacity` only, never `ease-in`, never `scale(0)`, keyboard actions get zero animation, `prefers-reduced-motion` required
3. **Design standards** — 4.5:1 contrast ratio, OKLCH color, Plus Jakarta Sans typography, 65-75ch line length, semantic z-index, no nested cards, every section gets a unique layout
4. **Interactive states** — All elements get: default → hover → active/scale(0.97) → focus-visible → disabled
5. **Dual-mode** — Light + dark by default. Dark uses lighter tones, not inverted colors
6. **No placeholders** — No lorem ipsum, "Jane Doe", "Acme Inc", "Learn More", or TODO comments

## Tech Stack (Affinity)
- **React 19** + TypeScript + Vite
- **React Router v7** for routing
- **Plain CSS** (index.css / App.css) — no Tailwind currently
- **lucide-react** for icons
- **react-dropzone** + **react-select** for forms
- **socket.io-client** for real-time
- **Mobile-first responsive** design
- Consider adding **motion** (motion/react) for animations

## Realtime / Socket.io updates

Live sync must feel invisible — only the changed value or row updates. Reference implementations: `src/pages/JobDetail.tsx`, `src/pages/JobList.tsx`, `src/utils/refetch.ts`, and payload comments in `backend/src/lib/socket.ts`.

**Do not**
- Call `setIsLoading(true)` or early-return `if (isLoading) return <Loading…>` on socket-driven refetches — this unmounts forms and feels like a page refresh
- Replace entire arrays with `setState(fetchedData)` when only one row changed
- Show "Updating…" labels, opacity dimming, or full-section loading swaps for background sync
- Refetch the whole job/list after a patch when the socket payload already includes the changed fields (e.g. `job:statusChanged` with `status` + `version`)
- Clear `error` / `conflictError` on silent background fetches
- Reset edit forms on every `job.updatedAt` bump — compare fields first
- Use `window.location` for in-app navigation — use React Router `navigate`

**Do**
- Use `background: true` fetches via `src/utils/refetch.ts`: `mergeById`, `prependById`, `mergeJobPatch`, `shallowEqual`
- Apply enriched socket payloads first (`workLog`, `log`, `job` patch, `lineItem`, `media`); HTTP refetch only as fallback
- Debounce burst events (~300ms) per resource slice (audit, comms, list)
- Skip self-triggered updates when `payload.actorId === user.id`
- Keep lists/tables mounted; patch rows in place; run Motion stagger only on first load (`initial={false}` after first paint)
- Refetch `/auth/me` when receiving `user:permissionsChanged` (delivered to `user:{userId}` room only)
- Redirect off permission-gated pages when `*:view` is revoked; clear cached data on 403 during background sync

## Permission-gated pages (Team Access and similar)

Sidebar visibility is not enough. See [`.claude/AGENTS.md`](../.claude/AGENTS.md) for the full post-mortem.

**Do not**
- Render a permission-gated page without checking `can('resource:view')` — hide nav links only is insufficient
- Keep showing cached rows after view access is revoked
- Show edit/create/delete controls when the user lacks `resource:view` even if they have the action key
- Toggle `edit` / `create` / `delete` in the matrix without enforcing `view` for that resource

**Do**
- Gate the route component: `if (sessionReady && !can('users:view')) return <Navigate to="/" replace />`
- Require `canView && can('users:edit')` (etc.) for action buttons
- Use `applyPermissionToggle` when editing the permission matrix — unchecking view clears sibling actions; checking an action auto-checks view
- On background refetch 403: clear local state and rely on redirect / empty UI, not silent stale data

Reference: `src/pages/UsersList.tsx`, `src/utils/permissions.ts`, `src/contexts/AuthContext.tsx`

## Account / AppShell

Account actions (Change password, Logout) must be discoverable from the sidebar profile card — not header-only. See [`.claude/AGENTS.md`](../.claude/AGENTS.md) for full rules.

**Do not**
- Show `ChevronDown` on a static profile card with no menu
- Copy-paste menu markup in sidebar and header — use a shared panel component
- Leave `#region agent log` debug fetch calls in shipped code

**Do**
- Sidebar profile card opens account dropdown (Change password + Logout)
- Header avatar menu stays for collapsed sidebar
- Shared handlers for all entry points (card menu, header menu, footer shortcuts)
- Only one account dropdown open at a time
