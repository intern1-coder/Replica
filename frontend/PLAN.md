# Affinity Frontend — Full Design & Motion Overhaul

## Scope
Rewrite every CSS file, refactor all components/pages to move inline styles → CSS classes, add dark mode, proper animations, OKLCH color system, Geist typography, and eliminate all AI tells across `E:\Affinity\frontend\`.

---

## Phase 1 — Design Tokens & CSS Architecture

### 1.A `index.css` — Complete Rewrite
**File:** `src/index.css`

Replace everything with a token-based system:

- **Font**: `Geist` as primary, `Inter` as fallback for system-only
- **Color**: OKLCH throughout. Replace all hex/RGB with OKLCH tokens
- **Easing variables**:
  ```css
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  ```
- **Duration tokens**:
  ```css
  --duration-instant: 100ms;
  --duration-fast: 160ms;
  --duration-normal: 250ms;
  --duration-slow: 400ms;
  ```
- **Semantic z-index scale**:
  ```css
  --z-base: 0;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-modal-backdrop: 300;
  --z-modal: 400;
  --z-toast: 500;
  --z-tooltip: 600;
  ```
- **Spacing tokens** (clamp-based):
  ```css
  --space-xs: clamp(0.25rem, 0.5vw, 0.375rem);
  --space-sm: clamp(0.5rem, 0.75vw, 0.625rem);
  --space-md: clamp(0.75rem, 1vw, 1rem);
  --space-lg: clamp(1.25rem, 2vw, 1.5rem);
  --space-xl: clamp(1.75rem, 3vw, 2.5rem);
  ```
- **Dark mode** via `@media (prefers-color-scheme: dark)` — redefine all color tokens with lighter tones, NOT inverted colors
- **`prefers-reduced-motion`** — remove transform-based motion, keep opacity/color transitions
- **Semantic section padding**: `padding: clamp(2rem, 5vw, 4rem)` for page sections
- **`text-wrap: balance`** on h1-h3
- **`text-wrap: pretty`** on body prose
- **Line length**: `max-width: 75ch` on prose containers
- **Semantic heading sizes**: heading-1 through heading-6 with clamp-based sizing
- **Interactive states** for all elements: `:hover`, `:active` (scale 0.97), `:focus-visible` (2px outline + 2px offset), `:disabled`
- **Remove glassmorphism** (`.glass-panel` class) — replace with solid surface colors
- **Remove `border-radius-full`** (9999px pill shapes — banned by anti-slop)
- **Replace all `transition: all ...`** with specific property transitions using custom easings
- **Remove uppercase tracking** on table headers (eyebrow pattern — banned)

**OKLCH Color Palette (Light):**
- Brand: `oklch(0.55 0.15 265)` (royal blue)
- Brand hover: `oklch(0.48 0.16 265)`
- Brand light: `oklch(0.92 0.04 265)`
- Surface: `oklch(0.99 0 0)` (true off-white)
- Background: `oklch(0.95 0.01 265)` (cool-tinted, NOT warm cream)
- Border: `oklch(0.88 0.02 265)`
- Text primary: `oklch(0.15 0.02 265)` (near-black, NOT pure black)
- Text secondary: `oklch(0.45 0.03 265)`
- Text muted: `oklch(0.65 0.02 265)`
- Status colors (converted to OKLCH from existing hex)

**Dark Mode overrides (lighter tones):**
- Surface: `oklch(0.18 0.02 265)`
- Background: `oklch(0.12 0.02 265)`
- Text primary: `oklch(0.92 0.01 265)`
- Text secondary: `oklch(0.7 0.02 265)`
- Border: `oklch(0.25 0.02 265)`

### 1.B `App.css` — Complete Rewrite
**File:** `src/App.css`

Remove ALL Vite boilerplate (`.hero`, `#center`, `#next-steps`, `#spacer`, `.ticks`, `.counter` classes — unused). Replace with:

- `.app-shell` — flex container, 100vh
- `.sidebar` — fixed width, dark surface, flex column
- `.sidebar-header` — branding area with role badge
- `.sidebar-nav` — nav links container
- `.sidebar-nav-link` — nav link with all interactive states
- `.sidebar-nav-link.active` — active route highlighting
- `.sidebar-footer` — logout area
- `.main-content` — flex 1, scrollable, padding with clamp()
- `.page-header` — flex row, space-between, clamp margin
- `.page-error` — error banner styling
- `.page-empty-state` — centered empty state with icon
- `.filter-bar` — horizontal filter row with gap
- `.slide-over-backdrop` — fixed overlay, dark, z-modal-backdrop
- `.slide-over-panel` — fixed right panel, z-modal, custom easing for enter/exit
- `.slide-over-panel.entering` / `.slide-over-panel.exiting` — animation states
- `.segment-control` — pill-style tab group
- `.segment-control button` — tab button with active state
- `.section-card` — surface card with border
- `.section-card-header` — card header with bottom border
- `.detail-grid` — responsive auto-fit grid
- `.stat-grid` — 4-column stat grid
- `.stat-label` — small uppercase label (intentional, for data only, not section headings)
- `.stat-value` — large tabular number
- `.timeline-item` — left-bordered timeline entry
- `.timeline-item.active` — highlighted timeline entry
- `.form-section` — form container
- `.form-row` — flex row for form fields
- `.form-label` — form label
- `.form-actions` — button row at form bottom
- `.dropzone` — dashed border upload area
- `.dropzone.active` — drag-active state
- `.media-grid` — auto-fill image grid
- `.media-item` — individual media thumbnail
- `.empty-state` — centered empty state
- `.search-input-wrapper` — input with icon positioning
- `.search-input` — input with padding for icon

All transitions use custom easing variables, NOT `ease` or `ease-in-out`.

### 1.C `index.html` — Font Update
**File:** `index.html`

- Add `Geist:wght@100..900` to Google Fonts import
- Keep Inter as fallback

---

## Phase 2 — Component Refactoring (CSS Class Migration)

### 2.A `AppShell.tsx`
- Replace ALL inline styles with CSS classes from App.css
- Use `className` instead of `style={{...}}`
- Remove `onMouseEnter`/`onMouseLeave` event handlers — use CSS `:hover`
- Add active route detection with `useLocation()` for `.active` class
- Fix logout button to use proper CSS classes

### 2.B `Login.tsx`
- Replace ALL inline styles with CSS classes
- Add `scale(0.97)` on button `:active`
- Use proper easing on form card entrance
- Fix input sizing

### 2.C `Dashboard.tsx`
- Replace inline styles with classes
- Add proper welcome layout using `.page-header` and `.section-card`

### 2.D `JobList.tsx`
- Replace inline styles with CSS classes
- Use `.page-header`, `.filter-bar`, `.search-input-wrapper`, `.search-input`
- Use table from index.css (already styled)
- Fix pagination to use button classes properly

### 2.E `JobDetail.tsx`
- Replace inline styles with CSS classes
- Use `.page-header`, `.section-card`, `.detail-grid`
- Status transition buttons use `.button` classes
- Conflict banner uses `.page-error` patterns

### 2.F `PropertyList.tsx`
- Replace inline styles with CSS classes
- Use `.page-header`, `.search-input-wrapper`, `.section-card`
- Form in `.form-section` with `.form-row`

### 2.G `ClientList.tsx`
- Same pattern as PropertyList — mirror fixes

### 2.H `UsersList.tsx`
- Replace inline styles with CSS classes
- Use `.section-card` wrapper
- Fix table styling

### 2.I `JobCreate.tsx`
- Replace inline styles with CSS classes
- Use `.form-section`, `.form-row`, `.form-label`, `.form-actions`

### 2.J `LogisticsGrid.tsx`
- Replace inline styles with CSS classes
- Replace `glass-panel` with `.slide-over-panel` + `.slide-over-backdrop`
- Remove inline `onMouseEnter`/`onMouseLeave` — use CSS
- Fix transition to use custom easing
- Fix z-index to use semantic variables

### 2.K `JobCommunications.tsx`
- Replace inline styles with CSS classes
- Use `.segment-control` for form toggle
- Use `.timeline-item` for log entries

### 2.L `JobWorkLogs.tsx`
- Replace inline styles with CSS classes
- Use `.form-row` patterns

### 2.M `JobMedia.tsx`
- Replace inline styles with CSS classes
- Use `.dropzone`, `.media-grid`, `.media-item`

### 2.N `JobDocuments.tsx`
- Replace inline styles with CSS classes
- Fix modal to use `.slide-over-backdrop` pattern

### 2.O `JobPnL.tsx`
- Replace inline styles with CSS classes
- Use `.stat-grid`, `.stat-label`, `.stat-value`

### 2.P `JobAuditLogs.tsx`
- Replace inline styles with CSS classes
- Use `.timeline-item` for audit entries

### 2.Q `SearchableAutocomplete.tsx`
- Replace inline styles with CSS classes
- Use `.search-input-wrapper` pattern
- Fix dropdown with proper z-index

### 2.R `DocumentEditModal.tsx`
- Replace inline styles with CSS classes
- Use `.slide-over-backdrop` pattern
- Fix z-index to use semantic variable

---

## Phase 3 — Animation & Motion Enhancements

### 3.A Button Animations
All `<button>` and `.button` elements get:
```css
transition: transform var(--duration-fast) var(--ease-out);
```
```css
button:active, .button:active {
  transform: scale(0.97);
}
```

### 3.B Page Transitions
Add fade-in on page mount via CSS:
```css
.page-enter {
  animation: pageIn var(--duration-normal) var(--ease-out);
}
@keyframes pageIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### 3.C Slide-Over Panel
- Enter: `translateX(100%) → translateX(0)` with `--ease-out` at 250ms
- Exit: `translateX(0) → translateX(100%)` with `--ease-out` at 200ms
- Backdrop fades at 200ms

### 3.D Table Row Hover
```css
tbody tr {
  transition: background-color var(--duration-fast) var(--ease-default);
}
```

### 3.E Card Lift on Hover
```css
.card-hover:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
```

### 3.F Staggered List Entrance
For timeline items and log entries, stagger using `nth-child` with 50ms delays.

---

## Phase 4 — Dark Mode

### 4.A Token Variables
Dark mode overrides in `@media (prefers-color-scheme: dark)` inside `index.css`

### 4.B Smooth Theme Switch
```css
*, *::before, *::after {
  transition: background-color var(--duration-fast) var(--ease-default),
              color var(--duration-fast) var(--ease-default),
              border-color var(--duration-fast) var(--ease-default);
}
```

### 4.C Status Badges in Dark Mode
Rebase status badge colors to lighter, more saturated hues for dark backgrounds.

---

## Phase 5 — Sizing & Spacing Audit

### 5.A Section Spacing
- Page sections use `padding: clamp(2rem, 5vw, 4rem)`
- Card padding uses `var(--space-md)` → `var(--space-lg)`
- Between sections: `margin-bottom: var(--space-xl)`

### 5.B Table Padding
- th/td: `padding: 0.75rem 1rem` → `padding: var(--space-sm) var(--space-md)`

### 5.C Button Sizing
- Default: `padding: 0.5rem 1rem` → `padding: 0.5rem clamp(0.75rem, 1.5vw, 1rem)`
- Small variant: `padding: 0.25rem 0.5rem`

### 5.D Input Sizing
- Input height: `padding: 0.5rem 0.75rem` → `padding: 0.6rem 0.875rem`
- Font size: `0.9rem` → `clamp(0.875rem, 1vw, 0.9375rem)`

---

## Phase 6 — AI Tell Elimination

### 6.A Remove
- `--border-radius-full: 9999px` (pill shapes)
- `.glass-panel` (glassmorphism)
- `text-transform: uppercase; letter-spacing: 0.05em` on table headers (eyebrow pattern)
- Numbered section markers (01/02/03)
- Side-stripe borders on cards
- Em-dashes as separators
- System font stack as primary

### 6.B Replace
- Inter → Geist as primary font
- All hex colors → OKLCH
- `transition: all` → specific properties
- `ease-in-out` → custom `--ease-out` or `--ease-in-out`
- `rgba(...)` transparent overlays → OKLCH with alpha
- Inline mouse event handlers → CSS `:hover`/`:active`

---

## Phase 7 — Accessibility

### 7.A Focus Visible
Every interactive element: `:focus-visible` with `2px solid` outline + `2px` offset.

### 7.B Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 7.C Contrast
- Body text: ≥4.5:1 against background
- Status badges: ≥3:1 for large text
- Placeholder text: ≥4.5:1 (NOT default muted gray)

### 7.D Labels
All form inputs have associated `<label>` elements with `htmlFor`.

---

## Execution Order
1. `index.css` — complete rewrite
2. `App.css` — complete rewrite
3. `AppShell.tsx` — CSS class migration
4. Pages: `Login.tsx` → `Dashboard.tsx` → `JobList.tsx` → `PropertyList.tsx` → `ClientList.tsx` → `UsersList.tsx` → `JobDetail.tsx` → `JobCreate.tsx` → `LogisticsGrid.tsx`
5. Components: `JobCommunications.tsx` → `JobWorkLogs.tsx` → `JobMedia.tsx` → `JobDocuments.tsx` → `JobPnL.tsx` → `JobAuditLogs.tsx` → `SearchableAutocomplete.tsx` → `DocumentEditModal.tsx`
6. Verify with `npm run build`
