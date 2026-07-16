# 08 — Design System

Goal: a **premium, minimal, native‑feeling** UI with tasteful glassmorphism, dark/light parity,
and smooth motion. Built on Tailwind v4 (CSS‑variable tokens) + shadcn/ui (`base-nova` style).

## 0. Single source of truth (non‑negotiable rule)

There is exactly **one place** that defines what the UI looks like. Nothing downstream is allowed
to invent its own colors, borders, or radii.

```
components.json                 ← shadcn config: points at the ONE css file, the ONE base color
        │  ("tailwind.css": "src/styles/globals.css", "baseColor": "neutral")
        ▼
src/styles/globals.css          ← the ONE file with every CSS variable (color/radius/spacing/shadow)
        │  (@theme inline maps variables → Tailwind utility classes, e.g. --color-border, --radius-*)
        ▼
components/ui/*  (shadcn primitives, generated via `shadcn add`)
        │  consume ONLY semantic utility classes: bg-card, border-border, rounded-lg, ring-ring …
        ▼
feature components (HostTree, TerminalPane, DialogX, …)
        consume ONLY the shadcn primitives above — never redefine border/radius/color inline
```

**Rules that follow from this**:

1. **`components.json` is canonical and must not drift.** `tailwind.css` always points at the one
   real tokens file (`src/styles/globals.css` after the Vite migration, doc 03 ADR‑002); `baseColor`
   stays `neutral`; `cssVariables: true` stays on (never switch to hard‑coded Tailwind color
   classes — that would create a second, competing source of truth).
2. **Changing a value once changes it everywhere.** Want a different accent, a smaller radius, a
   thinner border? Edit the variable in `globals.css` — never patch an individual component's
   className with a one‑off `border-2` or `rounded-2xl` override. If a component needs to look
   different, that's a signal a new *semantic* token or a shadcn `variant` is missing — add the
   token/variant centrally, don't hardcode the exception locally.
3. **Never hand‑edit generated files under `components/ui/`.** They come from `shadcn add
   <component>`. If a primitive needs a behavior change, either use its documented `variant`/`size`
   props, wrap it in a feature‑level component, or (rarely, deliberately) eject and document the
   change — but don't silently diverge from upstream shadcn so future `shadcn diff`/updates stay clean.
4. **No inline styles, no ad‑hoc hex/oklch colors, no magic pixel borders in feature code.** Every
   border, radius, color, shadow, and spacing value a component uses must resolve to a token defined
   in §2. This is enforced in review, not just convention (see doc 24 — a lint rule flags raw color
   literals and arbitrary Tailwind values like `border-[3px]` outside `globals.css`).

## 1. Design principles

1. **Content first** — chrome recedes; the terminal/files/data are the hero.
2. **Depth, not decoration** — glass and shadow convey layering, never ornament.
3. **Motion with meaning** — transitions explain state change; nothing bounces for fun.
4. **Keyboard‑first** — everything reachable without a mouse; visible focus.
5. **Density is a choice** — comfortable / compact modes (ops users want compact).
6. **Native etiquette** — respect OS conventions (traffic lights, window controls, menus, accent color).
7. **Follow shadcn/ui, don't fight it** — use its default component anatomy, `cva`‑based variants,
   and composition patterns (`asChild`, `cn()` class merging) as documented upstream. SSHBool's
   visual identity comes from **tokens** (color/radius/spacing/motion), not from reinventing how
   shadcn primitives are structured or styled internally.

## 2. Design tokens (CSS variables)

Tokens live in `src/styles/globals.css` (migrated from `app/globals.css`). shadcn consumes them.
Semantic tokens (not raw colors) are used in components.

```css
:root {
  /* radius / spacing / typography scale */
  --radius: 0.625rem;
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Code", ui-monospace, monospace;

  /* semantic surfaces (light) */
  --background: oklch(0.99 0 0);
  --foreground: oklch(0.16 0.01 260);
  --card: oklch(1 0 0 / 0.72);          /* glass base (translucent) */
  --card-border: oklch(0.2 0.01 260 / 0.08);
  --popover: oklch(1 0 0 / 0.85);
  --muted: oklch(0.96 0.005 260);
  --muted-foreground: oklch(0.5 0.02 260);
  --primary: oklch(0.62 0.19 265);       /* brand accent */
  --primary-foreground: oklch(0.98 0 0);
  --accent: oklch(0.95 0.03 265);
  --destructive: oklch(0.58 0.22 27);
  --success: oklch(0.6 0.15 150);
  --warning: oklch(0.75 0.15 80);
  --ring: oklch(0.62 0.19 265 / 0.5);

  /* glass */
  --glass-blur: 18px;
  --glass-saturate: 140%;
  --glass-bg: oklch(1 0 0 / 0.55);
  --glass-border: oklch(1 0 0 / 0.18);

  /* elevation shadows */
  --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.06);
  --shadow-md: 0 4px 16px oklch(0 0 0 / 0.10);
  --shadow-lg: 0 12px 40px oklch(0 0 0 / 0.18);
}

.dark {
  --background: oklch(0.16 0.01 260);
  --foreground: oklch(0.96 0.005 260);
  --card: oklch(0.21 0.012 260 / 0.6);
  --card-border: oklch(1 0 0 / 0.06);
  --popover: oklch(0.19 0.012 260 / 0.9);
  --muted: oklch(0.24 0.012 260);
  --muted-foreground: oklch(0.68 0.02 260);
  --primary: oklch(0.68 0.18 265);
  --glass-bg: oklch(0.2 0.01 260 / 0.55);
  --glass-border: oklch(1 0 0 / 0.08);
}
```

### 2.1 Borders & radius (keep them quiet)

Borders and radii are the fastest way to make an app look cheap when overdone. Rule: **borders are
a whisper, not a frame**.

- **Border width is always `1px`.** No `border-2`/`border-4` anywhere in the product, ever — thick
  borders read as "prototype," not "premium." Separation between surfaces comes primarily from
  **background contrast + shadow** (`--shadow-sm`/`--shadow-md`), with a 1px border only to crisp
  the edge, not to draw a box around everything.
- **Border color is always low‑contrast.** Use `--border`/`--card-border`/`--glass-border` (all
  low‑alpha, doc §2), never the foreground color or a saturated accent, so borders recede instead
  of competing with content for attention.
- **Radius uses the shared scale only, derived from one base variable.** `globals.css` already
  defines `--radius: 0.625rem` and derives every step from it in `@theme inline`
  (`--radius-sm: calc(var(--radius) * 0.6)`, `-md: * 0.8`, `-lg: var(--radius)`, `-xl: * 1.4`, …).
  Do not introduce one‑off radii per component (`rounded-[14px]`, `rounded-3xl` on a random card) —
  always use one of the derived utility classes (`rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`).
  Reference guide:

  | Element | Radius class |
  |---|---|
  | Buttons, inputs, badges, small controls | `rounded-md` |
  | Cards, list rows, menus, popovers, tooltips | `rounded-lg` (maps 1:1 to base `--radius`) |
  | Dialogs, sheets | `rounded-xl` |
  | Small chips/dots/avatars | `rounded-sm` or `rounded-full` |

  `--radius: 0.625rem` (10px) is deliberately modest — softly rounded, never bubbly. If the whole
  app's roundedness ever needs adjusting, change **only** this one variable in `globals.css`; every
  derived step and every component follows automatically.
- **No border on dense/data surfaces.** Data tables, file lists, process lists, log/terminal
  panes separate rows via subtle background alternation or a 1px `--border`‑colored divider
  between rows — never a bordered "card" wrapped around every row.
- **Focus rings, not borders, indicate interactivity/selection.** Use the `ring` utilities
  (`--ring` token) for focus/selected state instead of swapping to a heavier border — keeps the
  resting state calm and reserves visual weight for states that actually need attention.

### 2.2 Glassmorphism utility

```css
.glass {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
```
Applied to: sidebars, command palette, dialogs/sheets, status bar, floating toolbars.
**Never** applied behind dense data grids or the terminal (readability + perf).

## 3. Typography scale

| Token | Size / line | Use |
|---|---|---|
| display | 28 / 34 | onboarding titles |
| h1 | 22 / 28 | screen titles |
| h2 | 18 / 24 | section headers |
| body | 14 / 20 | default |
| small | 12 / 16 | metadata, captions |
| mono | 13 / 18 | terminal, code, paths |

## 4. Spacing & layout

- 4px base grid; spacing tokens `1..12`.
- Activity bar 48px; primary sidebar 260px (resizable 200–420); status bar 26px; title bar 36px.
- Tab height 34px; comfortable row 32px / compact row 26px.

## 5. Motion

- Durations: micro 120ms, standard 200ms, large 320ms; easing `cubic-bezier(0.2, 0, 0, 1)`.
- Only animate `transform` / `opacity`. Dialogs: scale 0.98→1 + fade. Sheets: slide + fade.
- Panel resize, tab reorder: spring via framer‑motion; disabled under `prefers-reduced-motion`.
- Loading: skeletons over spinners for structured content.

## 6. Iconography

- **lucide-react** (present). 16px in dense UI, 18–20px in toolbars. 1.5px stroke.
- Host/OS icons: a curated set (Ubuntu/Debian/Arch/Alpine/RHEL/Windows) for host tree.

## 7. Terminal theming

- Ships with schemes: **SSHBool Dark**, **SSHBool Light**, One Dark, Solarized (L/D), Dracula, Nord, Gruvbox.
- Terminal is its own theming domain (`themes.kind = 'terminal'`), independent from app theme.
- Font ligatures optional (JetBrains Mono / Cascadia Code); WebGL renderer for perf.

## 8. Component states (must be designed for every component)

Default, hover, active/pressed, focus‑visible, disabled, loading, error, empty, selected, dragging.
Storybook stories cover each state (doc 24).

## 9. Empty & error states

- Every list/panel has a bespoke empty state (icon + one‑line + primary action).
- Errors render from the `AppError` union → friendly copy + recovery action (retry, unlock, trust key).

## 10. Density & accessibility

- Density toggle (comfortable/compact) affects row heights & paddings via a `data-density` attribute.
- WCAG AA contrast in both themes; focus ring always visible on keyboard nav; `aria-*` on custom widgets.
- Respect OS accent color where available (Tauri window theme APIs).

## 11. Brand

- Accent indigo/violet (`--primary`), neutral base (shadcn `neutral`). Logo mark used in title bar,
  about dialog, and installer. Final brand palette confirmed before GA (doc 25).
