---
name: anti-slop
description: Anti-slop frontend framework and design taste system. Use to prevent generic AI-generated UI patterns. Enforces premium aesthetics, bans AI tells, provides design dials (DESIGN_VARIANCE, MOTION_INTENSITY, VISUAL_DENSITY). Covers brutalist, minimalist, soft, and redesign workflows.
---

# Anti-Slop Frontend Framework

## Configuration Dials

| Dial | Range | Default | Description |
| --- | --- | --- | --- |
| DESIGN_VARIANCE | 1-10 | 8 | How much section layouts, hero paradigms, and composition structures vary across the page. 1 = identical grid cells, 10 = every section has a unique layout architecture |
| MOTION_INTENSITY | 1-10 | 6 | Strength of motion design. 1 = static, 6 = scroll reveals + staggered entrances, 10 = GSAP sticky-stack + liquid glass + magnetic micro-physics |
| VISUAL_DENSITY | 1-10 | 4 | Information density. 1 = maximal whitespace (editorial), 4 = balanced breathing room, 10 = dense dashboard |

## Default Architecture

- React/Next.js + Tailwind v4 + Motion (motion/react, replaces Framer Motion)
- State management: React context / URL state / server actions before Zustand
- Icons: Phosphor icons → HugeIcons → Radix Icons → Tabler (in priority order)
- No emojis as icons. No unicode ornaments
- Responsive: mobile-first. Container queries where appropriate

## Design Engineering Directives

### Typography
- Geist over Inter. SF Pro Display for Apple-ecosystem projects. No system font stacks as primary
- Serif for editorial hero headings (Lyon, Newsreader, Literata, Source Serif)
- Headings: `font-weight: 500` (medium) as default cap. 600+ reserved for emphasis
- Body: `font-weight: 350` or `400` at `font-size: clamp(0.9375rem, 1vw + 0.5rem, 1.0625rem)`
- Line-height: prose 1.6-1.7, headings 1.05-1.1

### Color Calibration
- Avoid lila/mauve/lavender/purple as default accent — overused AI default
- No "premium-consumer" palette (teal + navy + warm gray + gold accent)
- Color consistency lock: hero section sets the hue anchor; every subsequent section's palette is derived from it
- Dark mode: use lighter tones, not inverted colors. Preserve hierarchy

### Layout Diversification
- Anti-center bias: hero content doesn't always need to be centered. Try left-aligned, split, full-screen media
- Hero discipline: never use a hero that's just a heading + paragraph + two buttons
- Alternation cap: zigzag (image-left / image-right alternation) max 2 iterations
- Eyebrow restraint: section kickers (small uppercase labels) are banned by default. If you must use one, only for the first section
- Bento cell count: bento grids with 4, 5, or 7 cells only. Never 3 or 6
- Section-layout-repetition ban: no two sections may share the same layout architecture
- Split-header ban: avoid "heading on left, description on right" split headers

### Materiality
- Default surfaces: layered transparency over subtle noise/grain, not solid cards
- Use `backdrop-filter: blur()` for depth, not box-shadows as a crutch
- Banned: heavy `box-shadow`, thick borders, pill shapes as default, gradient overlays, semi-transparent white overlays on images

### Interactive UI States
- Every interactive element must define: default → hover → active/tap → focus-visible → disabled → loading
- Button press: `scale(0.97)` with spring or 160ms ease-out
- Focus-visible: 2px outline + 2px offset, NOT removing `:focus` without replacement
- Disabled: opacity 0.4-0.5, `cursor: not-allowed`, no hover effects

### Content Density
- Clamp spacing values proportionally. Never fixed `px` spacing on container-level elements
- Content needs room to breathe — `padding: clamp(2rem, 5vw, 4rem)` for sections

## AI Tells — Forbidden Patterns

### Visual & CSS
- `rgba(0,0,0,0.05)` or `rgba(255,255,255,0.05)` as default surface colors — use OKLCH
- Tailwind `bg-white` / `bg-black` — use tinted off-white / near-black surface tokens
- `linear-gradient(to right, ...)` decorative accents — banned
- Pre-built glassmorphism (frosted glass with no content need)
- SVG icons inside cards that add no information

### Typography
- Inter as default sans-serif — prefer Geist
- System font stack (`-apple-system, BlinkMacSystemFont, ...`) as primary — banned
- Identical font stack for everything — vary at least the heading face
- Default Tailwind typography prose scale — customize

### Layout & Spacing
- Every section using `py-24` or identical padding — vary section spacing rhythm
- Flex-center for everything — use grid for 2D layouts
- The "center everything and stack vertically" pattern for every section
- Fixed container `max-w` that clips on wide screens

### Content & Data
- "Jane Doe", "John Smith", "user@example.com" in any demo data
- Lorem ipsum in production UI
- "Acme Inc" as company name
- "Learn More" / "Get Started" as every CTA
- Generic testimonials ("This product changed my life")
- Stock avatar grids as social proof

### Production-Test Tells
- Version labels ("v1.0", "Beta") in nav or footer
- Section numbering (01, 02, 03) as decorative eyebrows
- Em-dashes (—) used as decorative separators — **banned**. Use middot (·) or thin space
- Scroll-down cues (arrows, mouse icons, "scroll down" text)
- Decorative dots (three dots pattern, dotted backgrounds)
- Fake product previews (browser frame with screenshot placeholder, macbook frame with generic screen)

## Performance & Accessibility

- Hardware-accelerate animations (`transform`/`opacity` only)
- `prefers-reduced-motion: reduce` handled
- `prefers-color-scheme: dark` as first-class — dual-mode by default
- Core Web Vitals: CLS < 0.1, LCP < 2.5s (lazy-load below-fold media)
- DOM cost: no section > 200 nodes, no page > 2000 nodes
- Z-index: semantic scale, never raw numbers

## Reference Vocabulary (Pattern Names)

| Category | Patterns |
| --- | --- |
| Hero paradigms | Split, Full-bleed, Asymmetric, Terminal, Editorial, Deck, Showcase, Immersive-media, Liquid, Architectural |
| Navigation | Centered, Left-aligned, Sidebar, Dock, Island, Collapsed-condensing |
| Layouts | Bento, Zigzag, Full-width, Grid, Mosaic, Single-column, Magazine, Dashboard, Terminal |
| Cards | Platform, Media, Stat, Profile, Feature, Pricing, Testimonial, Code, Terminal, Tweet |
| Scroll animations | Sticky-stack, Horizontal-pan, Parallax, Reveal-stagger, Image-reveal, Perspective |
| Typography effects | Kinetic, Split-flap, Scramble, Typewriter, Reveal, Stagger |
| Micro-interactions | Magnetic, Hover-tilt, Ripple, Scale-press, Border-draw, Shimmer |
