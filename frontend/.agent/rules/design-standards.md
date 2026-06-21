# Design Standards

Always-On

## Color
- Body text MUST hit ≥4.5:1 contrast ratio against background
- Use OKLCH color space. NO cream/sand/beige backgrounds — that's the AI default
- Gray text on colored background is banned — use darker shade of bg's own hue
- Dark mode: lighter tones, not inverted. Preserve hierarchy

## Typography
- Geist over Inter as default sans-serif. SF Pro Display for Apple projects
- Cap body line length at 65-75ch
- Hero heading clamp max ≤6rem (~96px)
- `text-wrap: balance` on h1-h3; `text-wrap: pretty` on prose

## Layout
- Cards are lazy — use only when best affordance. Nested cards always wrong
- Responsive grids: `repeat(auto-fit, minmax(280px, 1fr))`
- Semantic z-index scale — never `999` or `9999`
- Vary spacing for rhythm — no two sections with identical padding

## Interaction
- Every interactive element must define: default → hover → active/tap → focus-visible → disabled → loading
- Focus-visible: 2px outline + 2px offset. NEVER remove `:focus` without replacement
- Disabled: opacity 0.4-0.5, `cursor: not-allowed`
