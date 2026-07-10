# NEXORAA ERP — Theme System

**Status:** Target specification. `apps/web-frontend`'s current light/dark token pair (`tokens.css`) is correct as far as it goes (`01_ERP_UI_AUDIT.md` §10) but is the *only* theming dimension implemented today. Everything else in this document — high contrast, tenant branding, accent color, density, RTL — is new surface.
**Consumes:** `06_ERP_DESIGN_TOKENS.md` for the raw token names/values. This document defines the *engine* that resolves and applies those tokens; `06` defines the tokens themselves.

---

## 1. Principle: No Hardcoded Colors, Anywhere

Every visual value — color, spacing, radius, shadow, font — resolves from a CSS custom property. A grep for `#[0-9a-f]{3,6}`, `rgb(`, `rgba(`, `hsl(`, or a raw Tailwind palette class (`blue-600`, `indigo-500`, etc.) inside any component file must return zero matches outside of token-definition files themselves. This is not new (the existing design system already states it); what's new is that it now must hold across **two apps** (web-frontend and pos-frontend), which today independently copy-pasted the same token file (`01_ERP_UI_AUDIT.md` §4.1) — the fix is in §7 below.

---

## 2. Theme Dimensions

The theme engine resolves a **theme** as the combination of independent dimensions, each swappable without touching the others:

| Dimension | Values | Scope |
|---|---|---|
| **Mode** | Light / Dark / High Contrast | User preference, persisted, defaults to OS `prefers-color-scheme` |
| **Brand** | Tenant's brand palette (primary/secondary/accent) | Tenant-level, set by tenant admin |
| **Client override** | A specific client/customer-facing surface (e.g. a portal a customer logs into) may override brand further | Rare — only for customer-facing surfaces, not the internal ERP UI |
| **Density** | Comfortable / Compact | User preference, persisted globally (`03_ERP_DESIGN_SYSTEM.md` §3.1) |
| **Font family** | Default (Inter) / tenant override | Tenant-level |
| **Radius scale** | Default / Sharp (0 radius) / Rounded | Tenant-level, rare — mostly for white-label tenants who want a distinct visual identity |
| **Animation scale** | Full / Reduced / None | User preference, defaults from OS `prefers-reduced-motion` |
| **Direction** | LTR / RTL | Locale-driven, not user-toggled |

Each dimension is an independent CSS custom-property group; changing one never requires recomputing another. Mode and Density are the only two dimensions with dedicated UI toggles today (header theme toggle exists; density toggle is new per `03` §3.1) — Brand/Font/Radius are admin-configured, not end-user-toggled.

---

## 3. Mode: Light / Dark / High Contrast

- **Light/Dark:** already correctly implemented (`ThemeContext.tsx`, `.dark` class toggle on `<html>`, localStorage + `prefers-color-scheme` fallback — `01_ERP_UI_AUDIT.md` §10). Keep this mechanism; extend it to a 3-value enum instead of a boolean.
- **High Contrast:** a third mode, `.hc` class, satisfying WCAG AAA contrast ratios (7:1 for normal text) for users who need it — not just "dark mode but darker," a distinct token set tuned for contrast, with borders added around elements that rely on subtle background-color distinction in normal mode (since high-contrast users often also have reduced color perception).
- Resolution order: explicit user choice (localStorage) → OS `prefers-contrast: more` → OS `prefers-color-scheme` → Light (default).

---

## 4. Tenant & Client Branding

- **Mechanism:** a tenant record carries a `themeConfig` JSON blob (brand primary/secondary/accent HSL values, optional font family, optional radius scale, optional logo URLs for light/dark). On login/tenant-switch, the frontend fetches this config and writes it as inline CSS custom properties on `<html>` (`--brand-primary: <tenant value>`), overriding the token defaults — no rebuild, no CSS-in-JS recompilation, just custom-property override, which is why the "no hardcoded colors" rule in §1 is load-bearing: hardcoded colors cannot be overridden this way, tokens can.
- **Update propagation:** changing a tenant's theme in Settings must reflect across the whole app **instantly**, without a page reload — because the override is a runtime `style.setProperty()` call on the root element, every component re-renders against the new custom-property value on next paint automatically (this is the entire point of using CSS custom properties over compile-time Tailwind color classes).
- **Client branding:** reserved for any future customer-facing surface (e.g. a self-serve customer portal) that needs to look like the *client's* brand, not the tenant's internal ERP brand — same mechanism, one more override layer, out of scope for the current two apps (web-frontend, pos-frontend) since neither is customer-facing today.
- **Scope guard:** tenant branding customizes color/font/radius only — never layout, spacing scale, or component structure. A tenant cannot theme their way into breaking `03_ERP_DESIGN_SYSTEM.md`'s Workspace/Table/Form standards. This is a hard boundary: brand tokens are a small, enumerated set (§ below), not an open style-injection mechanism.

### 4.1 What a Tenant CAN Override
`--brand-primary`, `--brand-secondary`, `--brand-accent`, `--font-sans` (from an allowed font list, not arbitrary web fonts — licensing/perf reasons), `--radius-scale` (choosing between 3 predefined scales, not arbitrary px values), logo assets.

### 4.2 What a Tenant CANNOT Override
Semantic status colors (`--color-success/warning/danger/info` stay fixed — a tenant cannot make "danger" green, that's a safety/comprehension issue, not a branding one), spacing scale, breakpoints, animation durations, z-index scale.

---

## 5. Accent Color

A single `--brand-accent` token, used sparingly for one-off emphasis (e.g. a "New" badge on a nav item, a highlighted KPI) — distinct from `--brand-primary` (used for primary actions/active states). Tenant-overridable per §4.1.

---

## 6. Density, Radius, Elevation, Spacing Scale, Animation Scale

| Dimension | Mechanism |
|---|---|
| **Density** | Two named presets (Comfortable/Compact) that scale `--space-*` table/form row heights via a `--density-multiplier` custom property (1.0 / 0.75) applied to component padding — not a full duplicate token set. |
| **Radius** | 3 tenant-selectable scales (Sharp/Default/Rounded) mapping to different `--radius-*` value sets — see `06_ERP_DESIGN_TOKENS.md` for exact values. |
| **Elevation** | Fixed shadow scale (`--shadow-sm/md/lg/xl`), not tenant-configurable — elevation communicates z-order/interactivity, not brand identity. |
| **Spacing scale** | Fixed (`--space-1` through `--space-16`), not tenant-configurable — this is a layout-integrity guarantee, not a brand knob (§4.2). |
| **Animation scale** | Full/Reduced/None, resolved from `prefers-reduced-motion` by default, user-overridable in accessibility settings. "None" sets all `--duration-*` tokens to `0ms` globally — every component that reads its transition timing from tokens (mandatory, `02_ERP_NAVIGATION_ARCHITECTURE.md` §19) gets this for free with zero component-level conditional logic. |

---

## 7. Cross-App Token Sharing (closes `01_ERP_UI_AUDIT.md` §4.1)

Today `apps/pos-frontend/src/styles/tokens.css` is a hand-copied fork of `apps/web-frontend`'s file, and the two apps run independent `ThemeContext` implementations. Target state:

1. Extract the token *definitions* (the `:root`/`.dark`/`.hc` CSS custom-property blocks) into a shared package, `packages/design-tokens` (CSS output, consumed via a plain `@import` — no build-step JS-in-CSS complexity needed since these are static custom properties).
2. Each app keeps its own `ThemeContext`-equivalent (the *mechanism* for applying mode/tenant overrides can stay app-local — POS's simpler single-screen context doesn't need web-frontend's full mode/density/tenant-branding surface), but both read from the same token source, so a color value only ever gets defined once.
3. This closes the drift risk flagged in the audit without forcing POS to adopt web-frontend's full theming complexity (tenant branding, density, high-contrast) — POS gets Light/Dark only, from the shared token file, which is all it needs.

---

## 8. RTL Readiness

No tenant requires RTL today, but the token/layout system must not preclude it later:
- Use logical CSS properties (`margin-inline-start`, not `margin-left`) in any *new* shared component built per `04_ERP_COMPONENT_LIBRARY.md` — this is a near-zero-cost discipline to adopt now versus a full audit-and-fix later.
- Do not retrofit existing pages for RTL as part of this initiative — that's explicitly out of scope (no tenant need today); the requirement here is "don't make it harder," not "ship it."
- `dir="rtl"` on `<html>`, driven by tenant locale config, is the activation switch whenever RTL is actually needed — the theme engine's job is to make that a one-line change, not a rewrite.

---

## 9. Dynamic Update Guarantee

Restating §4's core guarantee as the test this whole document must pass: **changing a tenant's brand color in Settings updates every open tab of that tenant's ERP session live, with no reload.** Mechanism: tenant theme config is cached in the same store the tenant-switcher (`02_ERP_NAVIGATION_ARCHITECTURE.md` §14) reads from; a settings save invalidates that cache and re-applies `style.setProperty()` calls on `<html>`, and (for multi-tab consistency) broadcasts via `BroadcastChannel` so other open tabs of the same tenant pick up the change without their own reload.
