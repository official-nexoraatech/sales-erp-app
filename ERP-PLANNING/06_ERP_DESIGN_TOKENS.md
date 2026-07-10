# NEXORAA ERP — Design Tokens

**Status:** Canonical token reference. The Color/Shadow/Z-index/Spacing/Radius/Animation/Typography values below are **not invented** — they are transcribed directly from the live, working `apps/web-frontend/src/styles/tokens.css` (198 lines, confirmed wired to `.dark` mode via `ThemeContext.tsx`). This document adds the token *groups* that don't exist there yet (Breakpoints, Container Width, Grid, Icon sizes, Opacity, Tenant-overridable markers) and defines the High Contrast mode referenced in `05_ERP_THEME_SYSTEM.md`.
**Consumed by:** every component in `04_ERP_COMPONENT_LIBRARY.md`. No component may hardcode a value that has a token equivalent here.
**Source of truth going forward:** per `05_ERP_THEME_SYSTEM.md` §7, these definitions move to a shared `packages/design-tokens` CSS file consumed by both `web-frontend` and `pos-frontend` — this document specifies the values that file must contain.

---

## 1. Color — Brand

| Token | Light | Dark | Tenant-overridable (§4.1 of `05`) |
|---|---|---|---|
| `--brand-primary` | `#4f46e5` | `#6366f1` | ✅ |
| `--brand-primary-hover` | `#4338ca` | `#818cf8` | derived |
| `--brand-primary-active` | `#3730a3` | `#a5b4fc` | derived |
| `--brand-primary-foreground` | `#ffffff` | `#ffffff` | derived |
| `--brand-primary-subtle` | `#eef2ff` | `#1e1b4b` | derived |
| `--brand-primary-subtle-foreground` | `#3730a3` | `#c7d2fe` | derived |
| `--brand-secondary` *(new)* | tenant-set, default `#7c3aed` | tenant-set | ✅ |
| `--brand-accent` *(new)* | tenant-set, default `#f59e0b` | tenant-set | ✅ |

"Derived" means: when a tenant sets `--brand-primary`, hover/active/subtle variants are computed at theme-resolution time (HSL lightness shift), not separately configured — a tenant sets one color, not six.

## 2. Color — Surface

| Token | Light | Dark |
|---|---|---|
| `--surface-page` | `#f8f9fb` | `#0f172a` |
| `--surface-card` | `#ffffff` | `#1e293b` |
| `--surface-raised` | `#f3f4f6` | `#1e293b` |
| `--surface-overlay` | `#ffffff` | `#1e293b` |
| `--surface-subtle` | `#f1f5f9` | `#0f172a` |
| `--surface-sunken` | `#e5e7eb` | `#0d1425` |

## 3. Color — Text

| Token | Light | Dark |
|---|---|---|
| `--text-primary` | `#111827` | `#f1f5f9` |
| `--text-secondary` | `#6b7280` | `#94a3b8` |
| `--text-disabled` | `#9ca3af` | `#475569` |
| `--text-inverse` | `#ffffff` | `#0f172a` |
| `--text-placeholder` | `#9ca3af` | `#475569` |
| `--text-link` | `#4f46e5` | `#818cf8` |
| `--text-link-hover` | `#4338ca` | `#a5b4fc` |

## 4. Color — Border

| Token | Light | Dark |
|---|---|---|
| `--border-default` | `#e5e7eb` | `#334155` |
| `--border-strong` | `#d1d5db` | `#475569` |
| `--border-focus` | `#4f46e5` | `#6366f1` |
| `--border-error` | `#ef4444` | `#f87171` |

## 5. Color — Semantic Status (never tenant-overridable, per `05_ERP_THEME_SYSTEM.md` §4.2)

| Status | Light (`base`/`hover`/`bg`/`border`/`fg`) | Dark |
|---|---|---|
| Success | `#16a34a` / `#15803d` / `#f0fdf4` / `#bbf7d0` / `#14532d` | `#4ade80` / `#86efac` / `#052e16` / `#166534` / `#bbf7d0` |
| Warning | `#d97706` / `#b45309` / `#fffbeb` / `#fde68a` / `#78350f` | `#fbbf24` / `#fcd34d` / `#1c0a00` / `#92400e` / `#fde68a` |
| Danger | `#dc2626` / `#b91c1c` / `#fef2f2` / `#fecaca` / `#7f1d1d` | `#f87171` / `#fca5a5` / `#1c0000` / `#7f1d1d` / `#fecaca` |
| Info | `#2563eb` / `#1d4ed8` / `#eff6ff` / `#bfdbfe` / `#1e3a8a` | `#60a5fa` / `#93c5fd` / `#0c1a3d` / `#1e3a8a` / `#bfdbfe` |

## 6. Color — Sidebar

| Token | Light | Dark |
|---|---|---|
| `--sidebar-bg` | `#1e1b4b` | (same — sidebar stays dark in both modes by design, a common enterprise-nav convention that increases perceived chrome/content contrast) |
| `--sidebar-border` | `#312e81` | same |
| `--sidebar-text` | `#c7d2fe` | same |
| `--sidebar-text-muted` | `#818cf8` | same |
| `--sidebar-icon` | `#a5b4fc` | same |
| `--sidebar-item-hover-bg` | `rgba(255,255,255,0.08)` | same |
| `--sidebar-item-active-bg` | `rgba(255,255,255,0.15)` | same |
| `--sidebar-item-active-text` | `#ffffff` | same |

## 7. High Contrast Mode (new — `.hc` class, per `05_ERP_THEME_SYSTEM.md` §3)

High Contrast is not simply "dark mode with more contrast" — it's a distinct set tuned to WCAG AAA (7:1 normal text, 4.5:1 large text/UI components):

| Token | `.hc` value |
|---|---|
| `--surface-page` | `#000000` |
| `--surface-card` | `#0a0a0a` |
| `--text-primary` | `#ffffff` |
| `--text-secondary` | `#e5e5e5` (not `#94a3b8` — HC never uses a mid-gray that dips below 7:1) |
| `--border-default` | `#ffffff` (borders become visible dividers, not subtle hints — HC users often rely on structural lines, not color-proximity, to parse layout) |
| `--brand-primary` | `#818cf8` (lightened for contrast against `#000000`) |
| Focus ring | 3px solid `--brand-primary`, always visible (not just on `:focus-visible` — HC mode assumes higher reliance on visible focus state) |

## 8. Elevation / Shadow

| Token | Light | Dark |
|---|---|---|
| `--shadow-xs` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | `0 1px 2px 0 rgb(0 0 0 / 0.3)` |
| `--shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)` | `0 1px 3px 0 rgb(0 0 0 / 0.4), 0 1px 2px -1px rgb(0 0 0 / 0.4)` |
| `--shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` | `0 4px 6px -1px rgb(0 0 0 / 0.4), 0 2px 4px -2px rgb(0 0 0 / 0.4)` |
| `--shadow-lg` | `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` | `0 10px 15px -3px rgb(0 0 0 / 0.4), 0 4px 6px -4px rgb(0 0 0 / 0.4)` |
| `--shadow-xl` | `0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)` | (same formula, darker) |
| `--shadow-modal` | `0 25px 50px -12px rgb(0 0 0 / 0.25)` | `0 25px 50px -12px rgb(0 0 0 / 0.7)` |

`.hc` mode: all shadows removed (`none`) — elevation in HC mode communicates via the `--border-default: #ffffff` outline instead, since soft shadows are a low-contrast cue by nature.

## 9. Z-index

| Token | Value |
|---|---|
| `--z-base` | `0` |
| `--z-raised` | `10` |
| `--z-dropdown` | `100` |
| `--z-sticky` | `200` |
| `--z-sidebar` | `300` |
| `--z-header` | `400` |
| `--z-overlay` | `500` |
| `--z-modal` | `600` |
| `--z-popover` | `700` |
| `--z-toast` | `900` |

## 10. Spacing Scale

| Token | Value |
|---|---|
| `--space-xs` | `4px` |
| `--space-sm` | `8px` |
| `--space-md` | `12px` |
| `--space-lg` | `16px` |
| `--space-xl` | `20px` |
| `--space-2xl` | `24px` |
| `--space-3xl` | `32px` |
| `--space-4xl` | `40px` |
| `--space-5xl` | `48px` |

Not tenant-configurable (`05_ERP_THEME_SYSTEM.md` §4.2, §6). Density mode (`03_ERP_DESIGN_SYSTEM.md` §3.1) applies a `--density-multiplier` (`1.0` Comfortable / `0.75` Compact) to *component-internal* padding only (e.g. table row height, form field padding) — the spacing scale values themselves never change; components multiply against them.

## 11. Border Radius

| Token | Value |
|---|---|
| `--radius-xs` | `2px` |
| `--radius-sm` | `4px` |
| `--radius-md` | `6px` |
| `--radius-lg` | `8px` |
| `--radius-xl` | `12px` |
| `--radius-2xl` | `16px` |
| `--radius-full` | `9999px` |

**Tenant radius-scale override** (`05_ERP_THEME_SYSTEM.md` §4.1, §6): 3 selectable presets scale every value above by a multiplier — `Sharp` (×0), `Default` (×1, the table above), `Rounded` (×1.5). A tenant picks one preset; individual radius tokens are never independently overridden. **Implemented 2026-07-08**: `--radius-multiplier` custom property + `[data-radius-scale]` blocks in `packages/design-tokens/tokens.css`, applied at runtime by `TenantThemeSync` (both apps), picker in Organization Settings → Branding. Works app-wide with zero component changes because Tailwind v4's `rounded-*` utilities reference `var(--radius-*)` at use time — confirmed via compiled-CSS inspection, not merely assumed.

## 12. Animation & Transition

| Token | Value |
|---|---|
| `--duration-fast` | `100ms` |
| `--duration-normal` | `150ms` |
| `--duration-slow` | `300ms` |
| `--ease-default` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` |

`prefers-reduced-motion` / Animation-scale "None" (`05_ERP_THEME_SYSTEM.md` §6): all three duration tokens resolve to `0ms` at the CSS custom-property level (a single override block), so components using `transition: <property> var(--duration-normal)` get instant transitions automatically with zero component-level conditional logic.

Specific timings referenced elsewhere in this document set (all must resolve to the tokens above, not new hardcoded values):
- Sidebar expand/collapse: `--duration-normal` (`02_ERP_NAVIGATION_ARCHITECTURE.md` §19 said 200ms — correct to `--duration-normal`/150ms here to match the actual token; use the token, not the previously-stated raw number).
- Hover-expand delay: `--duration-normal` before expand.
- Command palette open/close: `--duration-fast` scale+fade.
- Dropdown/tooltip: `--duration-fast`.

## 13. Typography

| Token | Value |
|---|---|
| `--font-sans` | `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| `--font-mono` | `'JetBrains Mono', 'Fira Code', ui-monospace, 'Cascadia Code', monospace` |

Font family is tenant-overridable (`--font-sans` only, from an approved list — `05` §4.1) — `--font-mono` is never tenant-configurable (used only for codes/IDs/monospaced data, not a branding surface).

**Type scale** (new — not in current `tokens.css`, defined here to close the gap):

| Token | Size | Line-height | Weight | Usage |
|---|---|---|---|---|
| `--text-xs` | `12px` | `16px` | 400/500 | Table cell secondary text, badges |
| `--text-sm` | `14px` | `20px` | 400/500 | Body default, table cell primary text, form labels |
| `--text-base` | `16px` | `24px` | 400 | Form input text, dense body copy |
| `--text-lg` | `18px` | `28px` | 500/600 | Section headers, card titles |
| `--text-xl` | `20px` | `28px` | 600 | Page titles |
| `--text-2xl` | `24px` | `32px` | 600/700 | Dashboard KPI values |

## 14. Icons

- **Library:** `lucide-react`, exclusively, via the existing `src/lib/icons.ts` barrel (`01_ERP_UI_AUDIT.md` §10 — already the standard, no emoji icons remain).
- **Sizes** (new token group): `--icon-xs: 14px` (inline-with-text), `--icon-sm: 16px` (buttons, inputs), `--icon-md: 20px` (nav items, headers), `--icon-lg: 24px` (empty states, page-level icons).
- Icon `stroke-width` fixed at `2` app-wide (Lucide default) — never mixed stroke weights within one view.

## 15. Breakpoints (new — Tailwind v4 defaults, confirmed uncustomized in `01_ERP_UI_AUDIT.md` Part C.8)

| Token | Value | Named in `02_ERP_NAVIGATION_ARCHITECTURE.md` §18 as |
|---|---|---|
| `sm` | `640px` | — |
| `md` | `768px` | Tablet threshold |
| `lg` | `1024px` | Laptop/Desktop threshold |
| `xl` | `1280px` | — |
| `2xl` | `1536px` | Desktop |
| `--breakpoint-ultrawide` *(new, not a Tailwind default — custom media query)* | `2560px` | Ultra-wide threshold |

## 16. Container Width & Grid

| Token | Value |
|---|---|
| `--container-form-max` *(new)* | `1440px` — single-column Workspace content cap (`02_ERP_NAVIGATION_ARCHITECTURE.md` §7) |
| `--container-content` *(new)* | `none` (full available width) — default for tables/dashboards/multi-column forms |
| `--grid-gutter` *(new)* | `--space-lg` (16px) default, `--space-2xl` (24px) between major page regions |

Grid columns follow Tailwind's 12-column default (`grid-cols-12` for full-bleed layouts like `PurchaseOrderFormPage` already does) — no custom grid-column token needed beyond what Tailwind ships.

## 17. Opacity

| Token | Value | Usage |
|---|---|---|
| `--opacity-disabled` *(new)* | `0.5` | Disabled interactive elements |
| `--opacity-overlay-scrim` *(new)* | `0.5` | Modal/drawer backdrop |
| `--opacity-skeleton` *(new)* | `0.6` (pulsing between 0.4–0.8) | Loading skeletons |
| `--opacity-hover-overlay` *(new)* | `0.08` | Matches `--sidebar-item-hover-bg`'s existing `rgba(255,255,255,0.08)` — generalized as a token for hover overlays on any dark surface |
