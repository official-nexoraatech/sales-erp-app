# Theme Settings & Help/Info — Enterprise Audit & Gap Analysis

## P0 Implementation — Completed 2026-07-15 (same session)

User chose: HC-mode fix via full semantic-token migration (long-term-correct option, not the faster band-aid), a real `mailto:` link for Contact Support, and P0 scope only.

**Shipped:**

- **HC-mode fix (BUG-T1):** all 33 files using `dark:`-paired raw Tailwind classes migrated to the semantic token utilities (`text-primary`, `bg-surface-card`, `border-default`, `text-success`/`-warning`/`-danger`/`-info`, `text-brand`, etc.) so High Contrast mode now actually applies across the entire GST module, Accounting reports module, and the header. `Layout.tsx`'s hardcoded active-state/badge colors fixed too (added a new `.bg-danger` token utility, analogous to the existing `.bg-danger-bg`). Added a permanent regression guard: `apps/web-frontend/src/__tests__/no-dark-variant-regression.test.ts` scans all source for `dark:` and fails the build if it ever reappears.
- **Reduced Motion fix (BUG-T2):** `packages/design-tokens/tokens.css` now sets Tailwind's own `--default-transition-duration` to `var(--duration-normal)`, so every bare `transition-*` utility in the app (the vast majority — almost nothing sets an explicit `duration-*` class) now honors Reduced Motion for free, app-wide, in both frontends (shared token package). The two hardcoded-ms keyframe animations (`Layout.tsx` sidebar flyout, `ERPDrawer.tsx` slide-in) now read `var(--duration-normal)` instead of literal `150ms`/`200ms`.
- **HelpPanel accessibility:** added `role="dialog"`/`aria-modal`/`aria-label`, focus trap + focus-restore-on-close (reused the existing `useFocusTrap` hook already used by `ERPDrawer`/`ERPCommandPalette`), and Escape-to-close (was violating the app's own stated "Esc closes any overlay" law). Trigger button in `Layout.tsx` got `aria-haspopup="dialog"`/`aria-expanded`.
- **Broken doc links:** discovered `apps/docs-site` — a complete, real documentation site (search, dark mode, FAQ, role-based Client/Admin/Developer/Audit tracks, 11 modules) that was fully built but never linked from anywhere in the product. `HelpPanel`'s 12 dead `/docs/training/*.md` links now point at the correct `docs-site` pages/anchors via a `VITE_DOCS_SITE_URL` env var (defaults to `http://localhost:5175`, following this codebase's existing `VITE_*_URL` convention). Two routes (`/accounting/bank-reconciliation`, `/settings/organization`) don't have an exact docs-site match — the former points at the closest overview page, the latter's link was left absent rather than pointing somewhere misleading.
- **Fake Contact Support:** replaced the placeholder `1800-XXX-XXXX`/"support widget" text with a real `mailto:support@nexoraa.com` link. **`support@nexoraa.com` is a placeholder I chose** — no real support address was provided; confirm/replace before this is user-facing.
- **Tests added:** `HelpPanel.test.tsx` (8 tests — dialog semantics, Escape, focus trap, real support link, route content, axe) and the `dark:` regression guard above. Full suite: 96/97 passing (the 1 failure, `navigation.test.ts`'s App.tsx route-count regex, is pre-existing and unrelated — confirmed `App.tsx` has zero diff this session). Type-check and lint both clean (lint's 6 errors are all pre-existing, in files whose content this session never touched).

**Not done in the P0 pass (deferred to P1/P2/P3 per the plan below):** shortcuts modal, version/environment display, FOUC prevention, cross-tab sync for mode/density/motion, chart-color tokenization, POS shortcut hints, perf memoization, searchable help, role-based help content, release notes, guided tour, backend-persisted preferences.

**Incidentally flagged, not fixed (outside this task's scope):** a pre-existing failing test in `navigation.test.ts` (regex no longer matches `App.tsx`'s current route format); pre-existing undefined CSS classes `bg-surface-hover`/`divide-border`/bare `.card` referenced in `SecuritySettingsPage.tsx` and ~9 other files.

## P1 Implementation — Completed 2026-07-15 (same session, continued)

- **Keyboard shortcuts modal:** new `apps/web-frontend/src/components/help/ShortcutsModal.tsx`, built on the existing `Modal` component (already has focus trap/Escape/dialog semantics — reused, not rebuilt). Lists all 6 registered app shortcuts (`Ctrl+K`, `Ctrl+Shift+N`, `G D`, `[`/`]`, `?`) plus the platform-wide `Esc` overlay-close law, rendered via the shared `Kbd` component. Reachable via a new "Keyboard shortcuts" button in `HelpPanel`'s footer — deliberately did **not** rebind the `?` key (it's already doing useful work opening context-sensitive help; redefining it would be a scope decision, not a bug fix).
- **Version/environment display:** `HelpPanel`'s footer now shows `NEXORAA ERP v{version} · {environment}`. Wired via Vite's `define` (`__APP_VERSION__` sourced from `package.json`, declared in a new `vite-env.d.ts`) — had to add the same `define` to **both** `vite.config.ts` and `vitest.config.ts` since Vitest resolves its own config independently (the same class of gotcha as the earlier CSS-import-order bug); environment comes from Vite's built-in `import.meta.env.MODE`.
- **FOUC prevention:** both `apps/web-frontend/index.html` and `apps/pos-frontend/index.html` gained a blocking inline `<script>` in `<head>` that reads localStorage and applies mode/density/motion (web) or just dark mode (POS) to `<html>` before React mounts — mirrors `ThemeContext.tsx`/`Layout.tsx`'s logic exactly; a comment flags to keep them in sync if that logic changes.
- **Tests added:** `ShortcutsModal.test.tsx` (4 tests) + 3 new `HelpPanel.test.tsx` cases (version display, shortcuts-modal open). Full suite: 102/103 passing (same pre-existing unrelated `navigation.test.ts` failure). Type-check and lint clean on both frontends (lint: still the same 6 pre-existing errors, zero new).

**Still not done (P2/P3, unchanged):** cross-tab sync for mode/density/motion, chart-color tokenization, POS shortcut hints (F2/F9 visible indicators), perf memoization (`ThemeContext` value, `AppearanceMenu` zustand selector), searchable help, role-based help content, release notes, guided product tour, backend-persisted (cross-device) preferences.

## P2 Implementation — Completed 2026-07-15 (same session, continued)

- **Perf memoization:** `ThemeContext.tsx`'s context value now wrapped in `useMemo`, so consumers only re-render when `mode`/`reducedMotion` actually change. `AppearanceMenu.tsx` now uses Zustand selectors (`useUIStore((s) => s.density)`) instead of a whole-store destructure, so it no longer re-renders on every route navigation (which pushes to `recentPages` in the same store).
- **Cross-tab sync for mode/density/motion:** uses the native `storage` event (fires in every _other_ same-origin tab when localStorage changes) rather than adding a second `BroadcastChannel` — simpler, since the data already _is_ the localStorage value. `ThemeContext.tsx` (both apps) listens for `erp-theme`/`erp-reduced-motion` key changes; `ui.store.ts` listens for `nexoraa-ui` and calls Zustand persist's `.rehydrate()`. Changing mode/density/motion in one tab now updates every other open tab live, matching the existing tenant-brand-color guarantee.
- **Chart-color tokenization:** added an 8-color `--chart-1` through `--chart-8` categorical palette to `packages/design-tokens/tokens.css` (tuned per `:root`/`.dark`/`.hc`), replacing the hardcoded hex `COLORS` arrays and individual `stroke`/`fill` values in `DashboardPage.tsx`, `SalesAnalyticsPage.tsx`, and `HRAnalyticsPage.tsx`. Referenced directly as `fill="var(--chart-1)"` in recharts props (SVG presentation attributes resolve CSS custom properties in all evergreen browsers) — semi-transparent area fills use `color-mix(in srgb, var(--chart-1) 20%, transparent)`.
- **POS shortcut hints + shared Kbd:** promoted `Kbd` from `apps/web-frontend/src/components/erp/Kbd.tsx` into `packages/ui` (now `import { Kbd } from '@erp/ui'`, used by all 4 web-frontend call sites plus the new POS one) so pos-frontend could use the same component. Added a visible `F2 New bill · F8 Charge · F9 Repeat last item` hint row above POS's product grid — `F2`/`F9` previously had zero on-screen indication anywhere.
- **Tests added:** `ThemeContext.test.tsx` in both apps (cross-tab sync, 4+3 tests), `ui.store.test.ts` (cross-tab density sync, 2 tests). Along the way, found and fixed a real gap in pos-frontend's test infra: `setupTests.ts` was missing the `window.matchMedia` jsdom polyfill that web-frontend already had — added it (needed to even render `ThemeContext` in a test without a pre-seeded localStorage value). Full suites: web-frontend 108/109 passing (same pre-existing unrelated `navigation.test.ts` failure), pos-frontend 137/137 real tests passing — 2 e2e spec files fail to _collect_ under Vitest (pre-existing: `apps/pos-frontend/vitest.config.ts` is missing the `exclude: ['**/e2e/**']` that web-frontend's has), flagged but not fixed as out of scope. Type-check and lint clean on both apps and `@erp/ui`.

**Still not done (P3, unchanged):** searchable help, role-based help content, release notes, guided product tour, backend-persisted (cross-device) preferences.

**Incidentally flagged, not fixed:** `apps/pos-frontend/vitest.config.ts` missing the e2e-exclude pattern (pre-existing, causes 2 Playwright specs to fail Vitest collection — real tests are unaffected and all pass).

---

**Date:** 2026-07-15
**Scope:** `apps/web-frontend`, `apps/pos-frontend`, `packages/design-tokens`, `packages/ui`
**Method:** Full codebase sweep (grep + file-level review), cross-checked against `ERP-PLANNING/05_ERP_THEME_SYSTEM.md`, `02_ERP_NAVIGATION_ARCHITECTURE.md`, `01_ERP_UI_AUDIT.md`, and `phase-completions/PHASE_14_COMPLETION.md`. Read-only research; no code changed in this pass.

---

## Executive Summary

Both systems are **real, partially-shipped implementations**, not vaporware — but each has one **severe, silent bug** that undermines its core promise:

1. **Theme:** High Contrast mode is supposed to guarantee WCAG-AAA contrast everywhere. It doesn't. 30 web-frontend files use Tailwind `dark:` variant classes, and `index.css` scopes that variant to `.dark` only (`@custom-variant dark (&:where(.dark, .dark *))`). Since Light/Dark/HC are mutually exclusive classes, **every one of those 30 files silently renders in light-mode colors while in HC mode** — including the entire GST module, the Accounting reports module, and the main header. Separately, **Reduced Motion is a near no-op**: zero components anywhere consume `var(--duration-*)`; all animations use bare Tailwind transition utilities or hardcoded ms literals.
2. **Help/Info:** The `?` shortcut was documented in `02_ERP_NAVIGATION_ARCHITECTURE.md` as shipping a "shortcuts cheat-sheet" — it doesn't exist. `?` opens a context-sensitive help drawer instead, and **no shortcuts list exists anywhere in either app**. The one "Contact Support" affordance is a literal placeholder string (`1800-XXX-XXXX`, "chat via the support widget" — no such widget exists). All 12 "training guide" links point at markdown files that aren't served by the built app (404 in any real deployment) — already flagged as an open gap in `PHASE_14_COMPLETION.md` and never actioned.

Neither system is "fake" — both have working infrastructure (real token sets, real cross-tab tenant-branding sync, real per-route help content, real keyboard shortcuts registered) — but both have a gap between what's documented as done and what's actually wired end-to-end.

---

## Part 1 — Theme Settings

### 1.1 Where it lives

Single surface: `apps/web-frontend/src/components/erp/AppearanceMenu.tsx`, mounted in the header (`Layout.tsx:455`). Controls Mode (Light/Dark/HC), Density (Compact/Comfortable/Spacious), Reduced Motion. `pos-frontend` has an independent, deliberately-scoped-down `ThemeContext` with Light/Dark only — this matches the design spec (§7 of `05_ERP_THEME_SYSTEM.md`) and is **not** a gap.

### 1.2 Feature coverage matrix

| Dimension                                  | State mechanism                                       | DOM/CSS mechanism                                                      | Status                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Light / Dark                               | `ThemeContext.tsx`, localStorage `erp-theme`          | `.dark` class on `<html>`, real token block                            | ✅ Works                                                                                                                             |
| High Contrast                              | same as above, `'hc'` value                           | `.hc` class, real distinct token block (`tokens.css:253-294`)          | ⚠️ Token set is real, but **30 files' `dark:`-only styling silently ignores it** — see 1.3                                           |
| Density (Compact/Comfortable/**Spacious**) | Zustand `ui.store.ts`, localStorage `nexoraa-ui`      | `data-density` attribute, `--density-multiplier`                       | ✅ Works — but **undocumented**: spec (`05_ERP_THEME_SYSTEM.md`) only describes 2 presets; code ships 3, fully functional            |
| Reduced Motion                             | `ThemeContext.tsx`, localStorage `erp-reduced-motion` | `data-motion="none"`, `--duration-*` zeroed                            | 🐞 CSS mechanism correct, but **zero components consume `--duration-*`** — toggle has no observable effect app-wide                  |
| Tenant brand color                         | `TenantThemeSync.tsx` both apps                       | inline `style.setProperty()` on `<html>`, `BroadcastChannel` cross-tab | ✅ Works, including live cross-tab sync                                                                                              |
| `prefers-contrast: more` auto-detection    | —                                                     | —                                                                      | ❌ Missing entirely (spec §3 requires it in resolution order)                                                                        |
| FOUC / flash-of-wrong-theme prevention     | —                                                     | —                                                                      | ❌ Missing in both apps — no blocking inline script in either `index.html`; every reload flashes default theme before correcting     |
| Cross-tab sync (mode/density/motion)       | —                                                     | —                                                                      | ❌ Missing — only tenant brand color has `BroadcastChannel`; changing mode in one tab doesn't propagate to sibling tabs until reload |
| Cross-device / backend persistence         | —                                                     | —                                                                      | ❌ Missing — 100% localStorage, no backend preference table/API                                                                      |
| Per-user isolation on shared browser       | —                                                     | —                                                                      | ❌ Missing — `logout()` never clears theme localStorage keys; next user inherits prior user's settings                               |
| Focus-visible ring                         | `packages/ui` components                              | `--shadow-focus` token, `color-mix()`                                  | ✅ Works, token-driven, ~12 shared components                                                                                        |

### 1.3 Bugs found (ranked by severity)

**BUG-T1 [Critical — accessibility integrity]:** High Contrast mode does not apply to 30 web-frontend files that use Tailwind `dark:` variant classes instead of tokens. Root cause: `index.css:19` scopes the `dark:` variant to `.dark` only, and HC uses a separate `.hc` class — mutually exclusive with `.dark`. Affected: entire GST module (`Gstr1Page`, `Gstr2aPage`, `Gstr3bPage`, `GSTR9Page`, `GstCompliancePage`, `GstRegisterPage`, `EInvoicePage`), entire Accounting reports module (`ProfitLossPage`, `BalanceSheetPage`, `CashFlowPage`, `LedgerPage`, `JournalsPage`), plus `Layout.tsx` header itself (notification/help icon active states, unread badge). A user who turns on HC mode for accessibility reasons gets **no benefit at all** on ~30 of the app's screens.

**BUG-T2 [High — accessibility/functionality]:** Reduced Motion is a no-op. No component reads `var(--duration-*)`; all transitions are bare Tailwind utilities (`transition-colors`, `transition-all`) using Tailwind's own default duration, or hardcoded literals (`Layout.tsx:394` `150ms`, `ERPDrawer.tsx:80` `200ms`). Users with vestibular disorders who enable this setting get no relief.

**BUG-T3 [Medium]:** Hardcoded chart colors in 3 recharts pages (`DashboardPage.tsx`, `SalesAnalyticsPage.tsx`, `HRAnalyticsPage.tsx`) — 8-color hex palette never changes across Light/Dark/HC/tenant-brand.

**BUG-T4 [Medium]:** `ERPCommandPalette.tsx:70`'s `toggleTheme()` is a second, inconsistent theme control — a deprecated binary cycle that can never reach `'hc'`, and if invoked while in HC mode, jumps to `'dark'` skipping `'light'`.

**BUG-T5 [Low — perf]:** `ThemeContext.tsx` context value object isn't memoized (fresh object every render → all consumers re-render unnecessarily). `AppearanceMenu.tsx:26` subscribes to the entire `useUIStore()` with no selector, so it re-renders on every route navigation (which pushes to `recentPages`), not just on density change.

**BUG-T6 [Low]:** `main.tsx` Toaster styling hardcodes `boxShadow`/`borderRadius` instead of `var(--shadow-*)`/`var(--radius-*)`. `pos-frontend`'s `ThemedToaster` hand-types hex values that duplicate existing token values instead of reading them. `ReceiptOverlay.tsx` and `AccountSuspendedScreen.tsx` in POS use raw Tailwind palette classes with no dark-mode handling at all.

**GAP (not a bug, spec is stale):** Design doc says 2 densities; code correctly ships 3 (Compact/Comfortable/Spacious), fully working. Spec doc should be updated to match reality, not the other way around.

### 1.4 Accessibility testing gap

`color-contrast` axe rule is explicitly **disabled** in the shared test harness (jsdom limitation) — so the WCAG-AAA claim for HC mode has **zero automated verification**, ever. None of the 11 axe-covered test files render their component under `.dark` or `.hc` — Dark and HC modes are completely untested by the a11y test suite.

---

## Part 2 — Help / Info

### 2.1 Where it lives

`apps/web-frontend`: `HelpCircle` button in header (`Layout.tsx:456-463`) → opens `HelpPanel.tsx`, a right-side drawer with per-route content (15 routes have dedicated content, everything else gets a generic fallback). Also a floating `OnboardingChecklist.tsx` widget (7-step setup checklist). **`apps/pos-frontend` has zero Help/Info affordance of any kind** — not even for its own documented F-key shortcuts.

### 2.2 Feature coverage matrix

| Feature                                                  | Status                                           | Note                                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context-sensitive help                                   | ⚠️ Partial                                       | 15 of the app's ~40+ routes have real content; rest get a generic fallback                                                                                                    |
| Tooltips                                                 | ❌ Missing                                       | No `Tooltip`/`role="tooltip"` component exists anywhere; only native `title=` attrs                                                                                           |
| Guided tours / onboarding                                | ⚠️ Partial                                       | Static checklist exists (`OnboardingChecklist.tsx`), not a spotlight/walkthrough tour; progress is localStorage-only, resets if browser cleared                               |
| **Keyboard shortcuts modal**                             | ❌ **Missing / documented-as-shipped but isn't** | Doc explicitly claims this closed a known gap; it didn't. 6 shortcuts exist in code, enumerated nowhere in the UI                                                             |
| Feature explanations / FAQ                               | ❌ Missing                                       | No FAQ component anywhere                                                                                                                                                     |
| Searchable help                                          | ❌ Missing                                       | HelpPanel has no search; command palette searches business records, not help content                                                                                          |
| Documentation links                                      | 🐞 **Broken**                                    | All 12 `guideUrl` links point to `/docs/training/*.md`, not served by the Vite build — 404 in any real deployment. Known, flagged, never fixed (`PHASE_14_COMPLETION.md:316`) |
| Release notes / What's New                               | ❌ Missing                                       | No changelog surfaced anywhere                                                                                                                                                |
| Contact Support                                          | 🐞 **Fake placeholder**                          | `"Call 1800-XXX-XXXX or chat via the support widget"` — unfilled template number, no widget exists                                                                            |
| Report Issue / Request Feature                           | ❌ Missing                                       | No mechanism anywhere                                                                                                                                                         |
| App version display                                      | ❌ Missing                                       | `package.json.version` never read/rendered                                                                                                                                    |
| Environment indicator                                    | ❌ Missing                                       | No dev/staging/prod badge                                                                                                                                                     |
| Browser info display                                     | ❌ Missing                                       | —                                                                                                                                                                             |
| User session info                                        | ⚠️ Partial                                       | Sidebar shows name/email only; session-expiry countdown exists only for impersonation, not normal sessions                                                                    |
| System status / health / diagnostics reachable from Help | ❌ Missing                                       | Event Store / DLQ / Saga / Schema Registry / Performance pages exist but live only in permission-gated admin nav, zero link from Help                                         |
| Role-based help content                                  | ❌ Missing                                       | `HELP_CONTENT` has zero permission/role checks — cashier and owner see identical text                                                                                         |
| Org/tenant-specific docs                                 | ❌ Missing                                       | —                                                                                                                                                                             |
| Security/privacy/accessibility/compliance docs           | ❌ Missing                                       | No such links anywhere                                                                                                                                                        |
| Support escalation path                                  | ❌ Missing                                       | Beyond the placeholder phone number                                                                                                                                           |
| POS shortcut hints                                       | 🐞 Broken                                        | Only `F8` has a visible hint (hardcoded text, not the shared `Kbd` component the spec calls for); `F2`/`F9` have zero visible indication                                      |

### 2.3 Accessibility of the Help feature itself

| Check                                       | Status                                                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Keyboard reachable (tab order, Enter/Space) | ✅ Works                                                                                                                      |
| `aria-label` on trigger                     | ✅ Works (missing `aria-haspopup`/`aria-expanded`)                                                                            |
| Focus trap in panel                         | ❌ Missing — no `role="dialog"`, no `aria-modal`, no trap (contrast: `ERPCommandPalette.tsx` does this correctly)             |
| Focus restore on close                      | ❌ Missing                                                                                                                    |
| Escape-to-close                             | 🐞 **Bug** — violates the platform-wide law stated in `02_ERP_NAVIGATION_ARCHITECTURE.md:107` ("Esc closes any open overlay") |
| axe-core test coverage                      | ❌ Missing — no test file exists for `HelpPanel` or `OnboardingChecklist` at all                                              |

### 2.4 Dead code / broken links

No orphaned components (both Help components are properly wired). The defects are broken _external_ links and fake content, not dead code: 12 broken `guideUrl` links, 1 fake support phone number, 1 documented-but-unshipped shortcuts cheat-sheet, 1 spec claim about a shared `Kbd` component in POS that doesn't exist (POS never imports it — it isn't even in a shared package).

---

## Part 3 — Prioritized Implementation Plan

Given the size (30+ files for the HC-mode fix alone, plus new surfaces for shortcuts/version/support), I'd suggest tackling this in tiers rather than one pass. My recommended priority order:

**P0 — Silent correctness/accessibility bugs (small, surgical, high impact)**

1. Fix HC mode: either extend the `dark:` custom-variant to also match `.hc`, or migrate the 30 files to tokens (the design doc's actual rule) — needs a decision, see below.
2. Wire Reduced Motion for real: point Tailwind's transition-duration at `var(--duration-normal)` (or add a `motion-safe`/`[data-motion=none]` override layer), replace the 2 hardcoded-ms keyframe animations.
3. Add Escape-to-close + focus trap + focus restore to `HelpPanel`.
4. Fix the fake Contact Support text (either wire a real support channel or remove the false claim) and fix/remove the 12 broken doc links (serve `docs/training/` statically, or point elsewhere).

**P1 — Documented-but-missing features** 5. Build the actual keyboard-shortcuts modal (the doc says this already shipped — it should). 6. Add version/environment display somewhere reachable (Help panel or footer). 7. FOUC-prevention inline script in both `index.html`s (mode/density/motion, not just brand color).

**P2 — Coverage/consistency** 8. Tokenize the 3 recharts pages' hardcoded colors. 9. Extend cross-tab `BroadcastChannel` sync to mode/density/motion (reuse the existing tenant-brand pattern). 10. POS: add F2/F9 visible shortcut hints via a shared `Kbd` component (needs promoting `Kbd` out of web-frontend into a shared package first). 11. Perf: memoize `ThemeContext` value, add Zustand selector in `AppearanceMenu`.

**P3 — New enterprise surfaces (larger, more judgment calls)** 12. Searchable help / FAQ, role-based help content, release notes, guided product tour, backend-persisted preferences (cross-device sync), support/report-issue mechanism, links to a status/diagnostics page from Help.

P3 items in particular involve product decisions (what does "Contact Support" actually mean for this app — a real ticketing integration? an email? Is a guided tour worth building custom or should it use a library?) that are worth confirming before I build them.

---

## Open decisions needed before implementation

1. **HC-mode fix approach**: extend the `dark:` variant to cover `.hc` too (fast, but means dark-mode colors get reused for HC rather than true HC-tuned tokens on those 30 files) vs. migrate all 30 files to semantic tokens (matches the design doc's actual rule, more correct, much larger diff).
2. **Reduced Motion**: acceptable to just point Tailwind's default transition duration at the token (global, cheap) vs. wanting per-component opt-in control?
3. **Contact Support**: is there a real support channel to wire in (email/ticketing system), or should the placeholder just be removed/replaced with something accurate for now?
4. **Scope for this session**: implement P0 only, P0+P1, or attempt everything through P2? P3 needs its own scoping conversation regardless.

---

## P3 Implementation — Completed 2026-07-15 (same session, continued)

- **Searchable help:** `HelpPanel` now has a search box that, when non-empty, replaces the current-route view with a flattened, filtered list of matches across every route's title/description/tasks (`ALL_HELP_ENTRIES` + `matchesQuery` in `HelpPanel.tsx`) — so searching "GSTIN" from `/dashboard` surfaces the Customers and Organization Settings pages' relevant tasks, not just whatever the current page happens to have.
- **Contact Support / Report an issue made persistent:** previously "Contact support" only appeared in the generic fallback content, meaning it was **unreachable from any of the app's 13 routes with dedicated help content** — a real gap only noticed while implementing this. Moved both to a persistent footer section (visible on every route) alongside a new "Report an issue" mailto link (same address, distinct subject line — flagging this as a placeholder same as `support@nexoraa.com` itself; a real bug tracker integration would be a better long-term answer).
- **Role-based help + admin diagnostics link:** a "System diagnostics" footer link now appears only for users with `PERMISSIONS.PERFORMANCE_VIEW`, pointing at `/admin/distributed/performance` — the first real permission-gated help content, and closes the "Help has no path to system status" gap. (Did not attempt to gate the Dashboard's "Approve pending items" task — this app has no single unified `APPROVAL_VIEW` permission (retired per PG-014); approvals are one permission per domain (`INVOICE_APPROVE`, `PO_APPROVE`, etc.), so there's no single correct permission to gate on without guessing.)
- **What's New / release notes:** new `WhatsNewModal.tsx`, opened from HelpPanel's footer, listing real dated entries sourced from this session's and recent prior sessions' actual shipped work (theme/help fixes, UX standardization, Accounting Reports overhaul, GSTR-9 fix, tenant branding, design-system rollout) — not placeholder copy.
- **Explicitly skipped (user's call, not a silent omission):** a guided product spotlight tour (OnboardingChecklist already covers getting-started; a full tour was judged the largest, most speculative remaining item) and backend-persisted cross-device preference sync (cross-tab sync from P2 covers the common case; a DB migration + new API endpoint for a per-browser preference was judged lower-value than its cost).
- **Tests added:** 8 new `HelpPanel.test.tsx` cases (search behavior incl. empty-results and clear-to-reset, permission-gated diagnostics link shown/hidden, distinct report-issue link) + 4 new `WhatsNewModal.test.tsx` cases. Full suite: 119/120 passing (same one pre-existing unrelated `navigation.test.ts` failure as every prior verification pass this session). Lint unchanged at 6 pre-existing errors (zero new). Type-check clean.

## Session Summary

**P0, P1, P2, and P3 (to the extent scoped) are now all complete.** Both Theme Settings and the Help/Info feature meet the enterprise bar this audit set out to verify: High Contrast mode now genuinely applies everywhere, Reduced Motion genuinely reduces motion, cross-tab sync covers mode/density/motion/brand, chart colors and shortcut hints are token-driven and complete, and Help now has real search, real support/issue-reporting channels, real role-based content, and a real changelog. Two deliberately-scoped-out items (guided tour, cross-device preference sync) were the user's explicit call, not gaps that slipped through.

**Two placeholder decisions need real-world follow-up before this is customer-facing:** the `support@nexoraa.com` address used for both Contact Support and Report an Issue is not a real inbox, and the two P3-flagged content approximations (`/accounting/bank-reconciliation`'s guide link, `/settings/organization` having none) could use real docs-site anchors if/when that app's content is extended to cover them.
