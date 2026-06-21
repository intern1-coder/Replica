---
name: motion-design
description: Emil Kowalski's animation and motion design engineering skill. Use when crafting UI animations, transitions, micro-interactions, or reviewing motion code. Provides custom easing curves, duration tables, spring physics, and animation decision frameworks.
---

# Motion Design Engineering

Based on Emil Kowalski's design engineering philosophy ([animations.dev](https://animations.dev/)).

## Core Philosophy

- Taste is trained, not innate — study why the best interfaces feel the way they do
- Unseen details compound — invisible correctness creates interfaces people love without knowing why
- Beauty is leverage — good defaults and animations are real differentiators

## The Animation Decision Framework

### 1. Should this animate at all?

| Frequency | Decision |
| --- | --- |
| 100+ times/day (keyboard shortcuts, command palette toggle) | No animation. Ever. |
| Tens of times/day (hover effects, list navigation) | Remove or drastically reduce |
| Occasional (modals, drawers, toasts) | Standard animation |
| Rare/first-time (onboarding, feedback, celebrations) | Can add delight |

**Never animate keyboard-initiated actions.** Never.

### 2. What is the purpose?

Every animation must answer "why does this animate?" Valid purposes: spatial consistency, state indication, explanation, feedback, preventing jarring changes.

### 3. What easing should it use?

| Scenario | Easing |
| --- | --- |
| Entering/exiting | **ease-out** (starts fast, responsive) |
| Moving/morphing on screen | **ease-in-out** |
| Hover/color change | **ease** |
| Constant motion (marquee, progress) | **linear** |
| Default | **ease-out** |

**Never use `ease-in` for UI animations.** Built-in CSS easings are too weak.

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

### 4. How fast?

| Element | Duration |
| --- | --- |
| Button press feedback | 100-160ms |
| Tooltips, small popovers | 125-200ms |
| Dropdowns, selects | 150-250ms |
| Modals, drawers | 200-500ms |
| Marketing/explanatory | Can be longer |

**Rule: UI animations under 300ms.**

## Spring Animations

- Use for: drag interactions with momentum, "alive" elements, interruptible gestures, decorative mouse-tracking
- Apple-style (recommended): `{ type: "spring", duration: 0.5, bounce: 0.2 }`
- Traditional: `{ type: "spring", mass: 1, stiffness: 100, damping: 10 }`
- Keep bounce subtle (0.1-0.3)
- Springs maintain velocity when interrupted — ideal for gestures

## Component Building Principles

- **Buttons must feel responsive**: `transform: scale(0.97)` on `:active`, `transition: transform 160ms ease-out`
- **Never animate from `scale(0)`**: Start from `scale(0.95)` + `opacity: 0`
- **Popovers must be origin-aware**: Use `var(--radix-popover-content-transform-origin)` or `var(--transform-origin)` (Modals are exempt — keep centered)
- **Tooltips: skip delay on subsequent hovers**: First hover has delay + animation; subsequent tooltips open instantly (`transition-duration: 0ms`)
- **Use CSS transitions over keyframes** for interruptible UI (transitions retarget mid-animation; keyframes restart from zero)
- **Use blur to mask imperfect crossfades**: Add subtle `filter: blur(2px)` during transition
- **Animate enter states with `@starting-style`** for entry without JS

## CSS Transform Mastery

- `translate` percentages are relative to the element's own size — prefer over hardcoded px
- `scale()` scales children too (fonts, icons, content)
- 3D transforms: `rotateX/Y` + `transform-style: preserve-3d` for depth effects
- `transform-origin` sets the anchor point — match to where the trigger lives

## clip-path for Animation

- `clip-path: inset(top right bottom left)` — powerful animation tool
- Use for: image reveals on scroll, hold-to-delete patterns, comparison sliders, seamless tab color transitions, overlay reveals

## Gesture and Drag Interactions

- **Momentum dismissal**: Calculate velocity; dismiss if `Math.abs(swipeAmount) / timeTaken > 0.11` regardless of distance
- **Damping at boundaries**: Dragging past boundary applies increasing friction
- **Pointer capture**: Capture all pointer events once dragging starts
- **Multi-touch protection**: Ignore additional touch points after initial drag
- **Friction over hard stops**: Allow over-drag with rising resistance

## Performance Rules

- **Only animate `transform` and `opacity`** — these skip layout/paint, run on GPU
- **CSS variables are NOT inheritable cheaply**: Don't drive child transforms via a CSS variable on the parent (triggers full style recalc). Set `transform` directly.
- **Framer Motion shorthands are NOT hardware-accelerated**: `x`/`y`/`scale` use rAF on main thread. Use `transform: "translateX()"` for hardware acceleration.
- **CSS animations beat JS under load** — they run off the main thread
- **WAAPI** gives JS control with CSS performance: `element.animate([...], { duration, fill, easing })`

## Accessibility

```css
@media (prefers-reduced-motion: reduce) {
  .element { animation: fade 0.2s ease; } /* keep opacity/color, drop movement */
}
@media (hover: hover) and (pointer: fine) {
  .element:hover { transform: scale(1.05); } /* gate hover animations */
}
```

## Stagger Animations

Keep stagger delays short: 30-80ms between items.

## Asymmetric Enter/Exit Timing

- Press: slow and deliberate (e.g., clip-path 2s linear for hold-to-delete)
- Release: fast (e.g., 200ms ease-out)
- Exit should be faster than enter

## Cohesion

Match motion to the component's personality. Playful = bouncier. Professional dashboard = crisp and fast. The easing, duration, design, and name should all be in harmony.
