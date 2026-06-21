You are building frontend UI for this project. You MUST follow these constraints:

## Active Skills (loaded in `.agent/skills/`)
- **motion-design** — Emil Kowalski's animation rules: custom easing curves, sub-300ms durations, spring physics, GPU-only transforms, origin-aware popovers, no `scale(0)`, stagger discipline
- **design-vocabulary** — Production-grade design: contrast verification, OKLCH color, typography hierarchy, layout rhythm, interaction states, 20+ design commands (`/audit`, `/polish`, `/typeset`, etc.)
- **anti-slop** — Anti-slop framework: 3 config dials (DESIGN_VARIANCE=8, MOTION_INTENSITY=6, VISUAL_DENSITY=4), banned AI tells, layout diversification, premium materiality

## Hard Rules
1. **No AI tells** — no gradient text, side-stripe borders, glassmorphism defaults, numbered eyebrows, identical card grids, system font stacks, em-dash separators, scroll cues, stock avatars, "Learn More" CTAs
2. **Motion discipline** — UI <300ms, custom cubic-bezier easing, `transform`/`opacity` only, never `ease-in`, never `scale(0)`, keyboard actions get zero animation, `prefers-reduced-motion` required
3. **Design standards** — 4.5:1 contrast ratio, OKLCH color, Geist over Inter, 65-75ch line length, semantic z-index, no nested cards, every section gets a unique layout
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
