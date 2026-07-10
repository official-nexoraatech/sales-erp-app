# NEXORAA ERP — Implementation Plan

**Status:** Execution roadmap for documents `01`–`06`. This is the only document in the set that authorizes code changes — `01`–`06` are the specification; nothing gets implemented until this plan is approved.
**Governing rule (non-negotiable):** never redesign one screen at a time. Build reusable primitives first, in the order below, then migrate every screen onto them in one systematic sweep per layer. A page-by-page redesign that duplicates UI or invents per-page styling is a process failure, not a shortcut.
**Continuity note:** `ERP-PLANNING/phase-completions/FRONTEND_DESIGN_COMPLETION_PLAN.md` already completed 12 of its own 23 milestones (tokens, icons, core `ERP*` component build-out). This plan does not repeat that work — Phase 0 below is a verification pass to confirm what `01_ERP_UI_AUDIT.md` §10 says is already correct, is still correct, before building on top of it.

---

## Phase 0 — Verify the Foundation (no new code)

**Goal:** confirm every "already correct, don't rebuild" claim in `01_ERP_UI_AUDIT.md` §10 still holds, since some time has passed since the underlying components were built.

| Task | Verify |
|---|---|
| Token system | `tokens.css` light/dark values match `06_ERP_DESIGN_TOKENS.md` §1-13 exactly (they should — `06` was transcribed from it) |
| `ERPDataGrid`, `ERPFormSection`, `ERPDropdownMenu`, `ERPCommandPalette`, `ERPBreadcrumb`, skeleton components | Still present, still passing their existing test files |
| `PermissionRoute` | Still the sole enforced RBAC mechanism, ~140 route call sites — do not touch in any later phase |

**Exit criteria:** a short confirmation note, not a rewrite. If anything has drifted, fix the drift before Phase 1 — do not build Phase 1 on a foundation that's silently changed.

---

## Phase 1 — Reusable Layout & Navigation Components

Implements `02_ERP_NAVIGATION_ARCHITECTURE.md` in full, `04_ERP_COMPONENT_LIBRARY.md` §11.

1. **Sidebar:** add responsive breakpoint collapse (`02` §5), hover-expand mode (`02` §4), per-group collapse persistence, Pinned group (`02` §10).
2. **Header:** add Tenant Switcher, Branch Switcher (`02` §14), Quick Create menu (`02` §11), `<Kbd>` component replacing hand-typed shortcut text.
3. **Command palette:** add action/command mode (`02` §9) and recent-pages section (`02` §10).
4. **New state stores:** `branch.store.ts` (zustand), extend `useUIStore` for recent-pages + sidebar-group-collapse state.
5. **New backend surface (flagged in `02` §10):** a small `user-preferences` endpoint for server-persisted Favorites/Pinned/Saved-Views — this is the one piece of this phase that isn't pure frontend. Scope it minimally: one table, one CRUD endpoint, keyed by `(userId, tenantId, kind, payload)`.
6. **Sticky header/sidebar:** make `position: sticky` explicit (`02` §6) instead of relying on scroll-container incidental correctness.

**Verify:** every route reachable via sidebar is also reachable via command palette action-mode in ≤3 keystrokes (`02` §1). Tenant/branch switch updates the active session without full logout (`02` §14). Manual keyboard-only pass: Tab through header + sidebar, confirm no dead ends.

---

## Phase 2 — Reusable Design Tokens & Theme Engine

Implements `05_ERP_THEME_SYSTEM.md`, `06_ERP_DESIGN_TOKENS.md` in full.

1. ~~Extract token definitions into `packages/design-tokens`~~ **DONE 2026-07-07.**
2. ~~Add `.hc` (High Contrast) mode and the 3-value mode enum~~ **DONE 2026-07-07.**
3. ~~Add tenant `themeConfig` fetch + runtime `style.setProperty()` override mechanism, plus `BroadcastChannel` multi-tab sync~~ **DONE 2026-07-08** (migration `0034_organization_theme_config.sql`, `TenantThemeSync.tsx`) — color + font + radius-scale, all three. Radius-scale (Sharp/Default/Rounded) was completed same-day: Tailwind v4's `rounded-*` utilities reference `var(--radius-*)` at use time (confirmed via compiled-CSS inspection), so a `--radius-multiplier` custom property + `[data-radius-scale]` blocks in `packages/design-tokens/tokens.css` apply app-wide with zero component changes — the earlier "no hook to attach to" conclusion was wrong. Along the way, found and fixed a real bug: `tokens.css` was imported *before* `tailwindcss` in both apps' `index.css`, so Tailwind's own `@theme` defaults for `--font-sans`/`--radius-*` were silently winning the cascade — the app had never actually rendered in Inter font. See `css_import_order_bug_and_radius_scale` memory.
4. ~~Add Density mode and wire the density toggle~~ **DONE 2026-07-07** (Appearance menu, `03` §3.1).
5. ~~Wire `prefers-reduced-motion` → Animation-scale "None" override~~ **DONE 2026-07-07.**
6. ~~Add the new token groups~~ **DONE 2026-07-07.**

**Verify:** toggling a tenant's brand color in a test tenant updates every open component with zero reload — confirmed for same-origin tabs of each app individually (`web-frontend`'s own tabs sync live; `pos-frontend`'s own tabs sync live). **Cross-app** (web-frontend ↔ POS) does NOT sync instantly and never will via this mechanism — `BroadcastChannel` is same-origin-scoped and these are separate origins; POS picks up a branding change on its next 60s query refetch or reload instead. `prefers-reduced-motion: reduce` in OS settings measurably removes all CSS transitions — verified via the token definitions, not manually confirmed in a live browser (no browser-automation tool available). `.hc` mode's actual contrast ratios were not run through an automated contrast checker — the token *values* were chosen to target 7:1 (`06_ERP_DESIGN_TOKENS.md` §7) but this hasn't been measured.

---

## Phase 3 — Reusable Table (`ERPDataGrid` extension)

Implements `03_ERP_DESIGN_SYSTEM.md` Part 3, `04_ERP_COMPONENT_LIBRARY.md` §4.

Build, on the existing `ERPDataGrid` foundation, in this order (each is independently shippable and testable):
1. Column resize + reorder + visibility toggle (persisted per-user per-table)
2. Density prop consuming Phase 2's `--density-multiplier`
3. Bulk-action bar (checkbox column → contextual action row)
4. Saved views (consumes Phase 1's `user-preferences` endpoint)
5. Advanced filter builder (drawer-based, multi-condition)
6. Virtualization (only where profiling shows it's needed — not blanket-applied)
7. `role="grid"` keyboard navigation

**Do not** touch any page's `useQuery`/`useMutation` logic in this phase — this phase only extends the component in isolation, with its own Storybook-equivalent test harness or a throwaway test page. Pages consume the extended component in Phase 6.

**Verify:** each capability has a component-level test (existing `ERPDataGrid` test file, extended). No page migration happens yet — this phase's exit criteria is "the component can do everything `03` Part 3 requires," not "any page uses it yet."

---

## Phase 4 — Reusable Form (`ERPFormSection` + validation)

Implements `03_ERP_DESIGN_SYSTEM.md` Part 4, `04_ERP_COMPONENT_LIBRARY.md` §2, §5 (focus-trap fix), §9 (new inputs).

1. Fix `Modal`/`ERPDrawer` focus trap + focus-restore (`01_ERP_UI_AUDIT.md` §3.5) — small, isolated, ship first since it's independent of everything else.
2. Build new input primitives: `ERPDatePicker`, `ERPCurrencyInput`, `ERPPhoneInput`, `ERPCheckboxGroup`, `ERPRadioGroup` (`04` §2).
3. Build `ERPTabs`, `ERPAccordion` (`04` §10) for the Tabs/Accordion/Wizard escalation levels (`03` §4.5).
4. Build dirty-state-warning hook (`useBlocker` + `beforeunload`) as a reusable `useDirtyFormGuard` hook — one implementation, every form imports it (`03` §4.4).
5. Establish the `apps/web-frontend/src/schemas/` convention: one `zod` schema per entity, importing `@erp/types` primitives (`03` §4.3) — write the first 3 (Customer, Supplier, Account) as the reference implementations other schemas copy, closing the concrete validation-parity gap in `01_ERP_UI_AUDIT.md` §3.2.
6. Build `ERPFileUpload`, `ERPTimeline`, `ERPStatusBadge`, `ERPAvatar`, `ERPTag` (`04` §6, §7, §9) — needed by the Detail-page Attachments/Activity/Approval pattern (`03` §4.6).

**Verify:** keyboard test — open a Modal/Drawer, Tab stays inside it, closing returns focus to the trigger (closes the one confirmed accessibility defect). Each new schema's rules are diffed field-for-field against its corresponding backend route's zod schema — this is the actual acceptance test for 3.2, not "form has validation."

---

## Phase 5 — Chart & Report Primitives

Implements `03_ERP_DESIGN_SYSTEM.md` Part 6, `04_ERP_COMPONENT_LIBRARY.md` §3 (`ERPStatCard`), §8 (`ChartCard`).

1. Extract `DashboardPage`'s inline KPI-card markup into `ERPStatCard`.
2. Build `ChartCard` wrapper around the existing Recharts usage (no new charting library).
3. Consolidate `TrialBalancePage`-style tabular reports onto the Phase 3 table + Phase 1 filter bar; consolidate `SalesAnalyticsPage`-style dashboards onto `ERPStatCard` + `ChartCard`.

**Verify:** `DashboardPage`, `SalesAnalyticsPage`, `HRAnalyticsPage` visually unchanged in a side-by-side screenshot diff (this phase is extraction, not redesign — the goal is one shared implementation behind identical pixels, not a new look).

---

## Phase 6 — Systematic Screen Migration

**This is the only phase that touches individual pages**, and it happens *after* Phases 1-5 exist and are independently correct. Migration order (highest-traffic and highest-risk first, matching `design-audit-prompt.md`'s already-validated prioritization — no reason to re-derive a different order):

| Wave | Pages | Depends on |
|---|---|---|
| **A** | Items, Customers, Invoices (list + form) | Phase 3 (table), Phase 4 (form + validation) |
| **B** | Suppliers, Quotations, Purchase Orders, GRNs, Stock Transfers, Accounts | Same as Wave A, proven pattern |
| **C** | Remaining form pages: HR, Production, GST, Settings | Phase 4 |
| **D** | Report/analytics pages onto Phase 5 primitives | Phase 5 |
| **E** | `OrganizationPage`, `EmployeeFormPage` responsive-grid fix | Phase 4 (subsumed by the `ERPFormSection` migration — same root cause, same fix, per `01_ERP_UI_AUDIT.md` §3.4) |

Per-page migration checklist (every page, every wave):
- [ ] Table: `ERPDataGrid` with pagination + sorting wired, `ERPDropdownMenu` for row actions, no custom loading/empty markup
- [ ] Form: `ERPFormSection` for all grouping, full-width responsive container, `zod` schema verified field-for-field against backend
- [ ] Filters synced to URL query params (`02_ERP_NAVIGATION_ARCHITECTURE.md` §17)
- [ ] Same rows, same data, same permission-gated actions render identically before/after (regression check)
- [ ] Same payload shape to the same endpoint on submit (regression check)
- [ ] `PermissionRoute` wrapping in `App.tsx` unchanged
- [ ] `pnpm --filter @erp/web-frontend type-check` and `test` pass

**Retirement:** once every consumer of `components/ui/DataTable.tsx` is migrated (end of Wave C), delete the file. Not before — do not delete a still-referenced deprecated component.

---

## Phase 7 — POS Token Convergence & Accessibility Hardening

Lower urgency than Phases 1-6; can run in parallel with Wave B/C once Phase 2 ships.

1. Point `apps/pos-frontend` at the shared `packages/design-tokens` package (`05` §7) instead of its copied `tokens.css`.
2. Wire `axe-core`/`jest-axe` into CI for both apps (`01_ERP_UI_AUDIT.md` §4.4 — currently zero automated a11y coverage).
3. Full WCAG 2.2 automated pass on both apps (POS explicitly deferred this in its last redesign — `01_ERP_UI_AUDIT.md` §10).

---

## Sequencing Rationale

Phases 1-5 are ordered by **dependency, not by user-visible impact** — Phase 6 (the only phase users actually see) cannot start correctly until the primitives it consumes exist, or it repeats exactly the mistake `01_ERP_UI_AUDIT.md` documents: components built in isolation, adopted nowhere. Phases 1, 2, 3, 4, 5 can partially overlap (e.g. Phase 4's Modal focus-trap fix has zero dependency on Phase 3's table work and can ship immediately), but **no page migration (Phase 6) starts until Phases 3 and 4 are both verified complete** for whichever primitive that page needs.

## Definition of Done (whole initiative)

- Every item in `01_ERP_UI_AUDIT.md`'s severity table (§9) is resolved or explicitly deferred with a written reason in this document.
- `components/ui/DataTable.tsx` is deleted.
- Zero hardcoded colors outside token-definition files (enforced by a lint rule / CI grep, not manual review — add this check as part of Phase 2).
- Every form's `zod` schema is verified against its backend route's schema (Phase 4 acceptance test, applied per-page in Phase 6).
- `axe-core` runs in CI for both apps with zero critical violations (Phase 7).
- A tenant can change brand color/font/radius in Settings and see it applied instantly, app-wide, in both `web-frontend` and `pos-frontend` (Phase 2 + 7 combined verification).

## Explicitly Deferred (not in this plan's scope — noted so it isn't silently forgotten)

- RTL activation for any real tenant (readiness only, per `05_ERP_THEME_SYSTEM.md` §8).
- Client-branding layer for a customer-facing portal (no such surface exists yet — `05` §4).
- Drag-and-drop reordering for the Pinned-menu feature (`02_ERP_NAVIGATION_ARCHITECTURE.md` §10 — pin/unpin only in v1).
- Full month/week Calendar component (`04_ERP_COMPONENT_LIBRARY.md` §7 — build only when a concrete scheduling module needs it).
- Consolidating `PermissionGate`/`usePermission` with `PermissionRoute` — explicitly out of scope, a functional RBAC change, not a UI one (`01_ERP_UI_AUDIT.md` §8.1).
