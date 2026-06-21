---
name: design-vocabulary
description: Impeccable design vocabulary for production-grade frontend UI. Use when designing, critiquing, auditing, polishing, colorizing, typesetting, or refining interfaces. Provides commands: /audit, /polish, /critique, /colorize, /typeset, /layout, /animate, /harden, /bolder, /quieter, /distill.
---

# Design Vocabulary

Designs and iterates production-grade frontend interfaces. Real working code, committed design choices, exceptional craft.

## Setup

Before designing, familiarize with existing design system, conventions, and components in the codebase. Read at least one CSS/token/component file.

## Design Guidance

### Color

- **Verify contrast.** Body text ≥4.5:1 against background; large text (≥18px or bold ≥14px) ≥3:1. Placeholder text needs 4.5:1 too. Light gray body text on tinted near-white is the #1 AI readability failure.
- Gray text on colored bg looks washed out — use a darker shade of the bg's own hue.
- Use OKLCH color space. Do NOT default to warm-tinted (cream/sand/beige) backgrounds — that's the 2026 AI default. Pick a strategy:
  - **Restrained**: tinted neutrals + one accent ≤10%
  - **Committed**: one saturated color carries 30-60% of surface
  - **Full palette**: 3-4 named roles
  - **Drenched**: surface IS the color
- Before choosing dark vs light, write one sentence: who uses this, where, under what light, in what mood.

### Typography

- Cap body line length at 65-75ch
- Don't pair similar fonts (two geometric sans-serifs). Pair on contrast: serif + sans, geometric + humanist
- Hero heading clamp max ≤6rem (~96px)
- Display heading letter-spacing ≥ -0.04em
- Use `text-wrap: balance` on h1-h3; `text-wrap: pretty` on long prose

### Layout

- Vary spacing for rhythm
- Cards are the lazy answer. Use only when they're the best affordance. Nested cards are always wrong
- Flexbox for 1D, Grid for 2D
- Responsive grids without breakpoints: `repeat(auto-fit, minmax(280px, 1fr))`
- Semantic z-index scale. Never arbitrary values like 999

### Motion

- Intentional, not an afterthought
- Don't animate CSS layout properties
- Ease out with exponential curves (ease-out-quart/quint/expo). No bounce, no elastic
- Use libraries for advanced motion (motion, GSAP, anime.js, Lenis)
- `prefers-reduced-motion: reduce` is not optional
- Reveal animations must enhance an already-visible default — don't gate content visibility
- Staggering is legitimate. The tell is uniform reflex (same entrance for every section), not motion itself

### Interaction

- Dropdowns in `overflow: hidden` containers get clipped — use `<dialog>`/popover API, `position: fixed`, or portal

### Hard Bans (AI Slop Test)

- **Side-stripe borders.** `border-left`/`border-right` >1px as accent on cards — never intentional
- **Gradient text.** `background-clip: text` with gradient — decorative, never meaningful
- **Glassmorphism as default.** Rare and purposeful or nothing
- **Hero-metric template.** Big number + small label + supporting stats + gradient accent
- **Identical card grids.** Same-sized cards with icon + heading + text repeated
- **Tiny uppercase tracked eyebrow above every section.** The `"ABOUT" "PROCESS" "PRICING"` scaffold. One named kicker as a deliberate brand system is voice; an eyebrow on every section is AI grammar
- **Numbered section markers (01 / 02 / 03) as default scaffolding.** Only use when the section IS a real sequence
- **Text that overflows its container.** Test heading copy at every breakpoint

### The AI Slop Test

If someone could look at this interface and say "AI made that" without doubt, it's failed.

**Category-reflex check:**
- First-order: if someone could guess the theme + palette from the category alone, it's the training-data reflex
- Second-order: if someone could guess the aesthetic family from category-plus-anti-references, it's the deeper trap

## Commands

- `/audit <target>` — Technical quality checks (a11y, perf, responsive)
- `/polish <target>` — Final quality pass before shipping
- `/critique <target>` — UX design review with heuristic scoring
- `/colorize <target>` — Add strategic color to monochromatic UIs
- `/typeset <target>` — Improve typography hierarchy and fonts
- `/layout <target>` — Fix spacing, rhythm, and visual hierarchy
- `/animate <target>` — Add purposeful animations and motion
- `/harden <target>` — Production-ready: errors, i18n, edge cases
- `/bolder <target>` — Amplify safe or bland designs
- `/quieter <target>` — Tone down overstimulating designs
- `/distill <target>` — Strip to essence, remove complexity
- `/craft <feature>` — Shape then build a feature end-to-end
- `/shape <feature>` — Plan UX/UI before writing code
- `/clarify <target>` — Improve UX copy, labels, error messages
- `/adapt <target>` — Adapt for different devices and screen sizes
- `/optimize <target>` — Diagnose and fix UI performance
- `/delight <target>` — Add personality and memorable touches
- `/overdrive <target>` — Push past conventional limits
- `/onboard <target>` — Design first-run flows, empty states
- `/init` — Set up project context (brand, design tokens)
