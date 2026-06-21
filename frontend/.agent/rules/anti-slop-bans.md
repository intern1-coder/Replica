# Anti-Slop Rules

Always-On

## Banned Patterns (AI Tells)
- Side-stripe borders (>1px colored accent on cards/list items)
- Gradient text (`background-clip: text` + gradient)
- Glassmorphism as default decorative treatment
- Tiny uppercase tracked eyebrow ("ABOUT" "PROCESS") above every section
- Numbered section markers (01 / 02 / 03) as default scaffolding
- Hero-metric template (big number + small label + stats + gradient)
- Identical card grids (same-sized icon + heading + text repeated)
- Text that overflows container on tablet/mobile
- Inter as default sans — prefer Geist
- System font stack as primary
- Lorem ipsum, "Acme Inc", "Jane Doe", "Learn More" / "Get Started" as every CTA
- Stock avatar grids as social proof
- Version labels ("v1.0", "Beta") in nav/footer
- Scroll-down cues (arrows, mouse icons, "scroll down")
- Em-dashes as decorative separators — use middot (·) or thin space
- Decorative dots / dotted backgrounds
- Fake product previews (browser frame + placeholder screenshot)
- Solid `bg-white` / `bg-black` — use tinted off-white / near-black
- `linear-gradient(to right, ...)` decorative accents
- Heavy box-shadows as default surface treatment
- Pill shapes as default shape
- Split-header layout (heading left, description right)

## Required
- Every section MUST have a different layout architecture
- Bento grids: only 4, 5, or 7 cells. Never 3 or 6
- Hero must go beyond heading + paragraph + two buttons
- Zigzag alternation max 2 iterations
- Dual-mode by default (light + dark)
- Content needs room: `padding: clamp(2rem, 5vw, 4rem)` for sections
