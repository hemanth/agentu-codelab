# Design System: agentu codelab

## 1. Visual Theme & Atmosphere

**Atmosphere:** Deep-space cockpit — dense, precise, confident. The interface feels like a command center for AI agents: dark, focused, and engineered. Minimal ornamentation; every pixel serves a purpose. The darkness isn't absence — it's negative space that makes the teal accent glow like instrument lighting.

**Density:** Moderate-to-high. Content fills the viewport comfortably without crowding. Cards sit in a disciplined grid with enough breathing room to read, but tight enough to feel substantial.

**Character:** Industrial-utilitarian with a single thread of warmth from the teal accent. No gradients on surfaces. No decorative borders. Clean edges, measured gaps.

## 2. Color Palette & Roles

| Name | Hex | Role |
|------|-----|------|
| Void Black | `#0a0e1a` | Primary background — the deepest layer |
| Console Surface | `#141824` | Card/panel backgrounds — one step above void |
| Wire Grey | `#1e2536` | Borders, dividers, inactive states |
| Exhaust Grey | `#8892a8` | Body text, descriptions, secondary content |
| Signal White | `#e2e8f0` | Headings, labels, primary text |
| Reactor Teal | `#2dd4bf` | Primary accent — buttons, highlights, active states |
| Reactor Glow | `rgba(45, 212, 191, 0.08)` | Subtle teal wash for badges, hover backgrounds |
| Reactor Bright | `#67e8f9` | Secondary accent — gradient endpoint, links |

**Rule:** Teal is the only chromatic color. Everything else is greyscale. This creates a single focal axis.

## 3. Typography Rules

- **Font Family:** `"Inter", system-ui, sans-serif` — engineered for screen legibility at all sizes
- **Headings:** Weight 800 (extra-bold), tight line-height (1.1). Headings command attention without shouting.
- **Card Titles:** Weight 600-700, small caps energy. Sized `0.85rem` — readable but compact.
- **Body Text:** Weight 400, `0.78rem`, line-height 1.4. Exhaust Grey color. Never larger than the title.
- **Badge/Meta:** Weight 600, `0.7rem`, uppercase with `0.1em` letter-spacing. Used sparingly for labels.
- **Monospace:** `"JetBrains Mono", "Fira Code", monospace` — for code blocks in the editor only.

## 4. Component Stylings

### Buttons
- **Primary CTA:** Pill-shaped (`border-radius: 10px`), filled with a teal-to-cyan gradient (`135deg, #2dd4bf → #67e8f9`). Dark text (`#0a0e1a`). Soft glow shadow (`0 4px 16px rgba(45,212,191,0.25)`). On hover: lifts 1px, shadow intensifies.
- **No secondary buttons on landing.** The CTA is the only action.

### Cards
- **Background:** Console Surface (`#141824`)
- **Border:** 1px solid Wire Grey (`#1e2536`)
- **Corners:** Subtly rounded (`border-radius: 8px`)
- **Shadow:** None at rest. On hover: faint teal glow (`0 4px 16px rgba(45,212,191,0.08)`), border transitions to Reactor Teal.
- **Padding:** `16px 18px` — enough to breathe, not enough to float.
- **Hover:** Lift 2px with `translateY(-2px)`, border goes teal. Transition: 0.2s ease.

### Badges
- **Shape:** Pill (`border-radius: 20px`)
- **Background:** Reactor Glow
- **Border:** 1px solid `rgba(45,212,191,0.2)`
- **Text:** Reactor Teal, uppercase, letter-spaced

## 5. Layout Principles

- **Full-viewport containment:** The landing page fills exactly 100vh/100dvh. No scroll, ever. `overflow: hidden` on every container.
- **Vertical rhythm:** Three zones stacked in a centered flex column:
  1. **Header zone** — badge + title + subtitle. Compact, centered text.
  2. **Grid zone** — 4×4 feature grid. This is the hero of the page. Max-width `960px` to prevent cards from stretching too wide on ultrawide monitors.
  3. **CTA zone** — button + meta text. Compact footer.
- **Spacing:** Use `gap` between zones, not margins. `gap: 2.5vh` between the three zones.
- **Grid gaps:** `10px` between cards — tight enough to feel like a cohesive dashboard, loose enough to distinguish individual cards.
- **Horizontal constraint:** Grid maxes out at `960px` width and centers itself. On screens wider than this, negative space flanks the grid symmetrically.
