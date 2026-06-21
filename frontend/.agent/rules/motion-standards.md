# Motion Standards

Always-On

## Animation Constraints
- UI animations MUST stay under 300ms duration
- Use custom easing curves, NOT CSS defaults: `cubic-bezier(0.23, 1, 0.32, 1)` for ease-out
- NEVER use `ease-in` for UI — it delays the moment users watch most
- ONLY animate `transform` and `opacity` — skip layout/paint
- NEVER animate from `scale(0)` — start at `scale(0.95)` + `opacity: 0`
- BUTTONS must have `transform: scale(0.97)` on `:active` with 160ms ease-out
- POPOVERS must use origin-aware `transform-origin` (modals exempt — keep centered)
- KEYBOARD-INITIATED actions get ZERO animation
- Hover animations gated behind `@media (hover: hover) and (pointer: fine)`
- `prefers-reduced-motion: reduce` handled — keep opacity/color, drop movement
- Use CSS transitions over keyframes for interruptible UI
- Spring config: `{ type: "spring", duration: 0.5, bounce: 0.2 }` (Apple-style)
- Stagger entrances at 30-80ms between items — NEVER block interaction during stagger
