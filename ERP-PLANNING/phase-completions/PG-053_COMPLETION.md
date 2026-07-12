# PG-053 — Mobile Responsiveness Audit & Fixes — Completion Report

**Date:** 2026-07-11
**Status:** Session A (full audit) + Session B (Priority-1 fixes) both complete, done as a single
combined pass at the user's request rather than the gap-prompt's suggested 2-3 session split.
Session C (Priority-2/3 fixes) intentionally not started — deferred per the gap-prompt's own scope
decision.

## Summary

Audited all 118 non-test pages under `apps/web-frontend/src/pages/` for mobile/tablet
responsiveness gaps, using the existing `useMediaQuery`/`BREAKPOINTS` hook and Tailwind's default
breakpoints exclusively (no new responsive-detection mechanism was built, per the gap-prompt's
explicit instruction). The audit was split across 6 parallel workers, each owning a disjoint set
of files (no file overlap, safe to run concurrently) — see
`ERP-PLANNING/phase-completions/PG-053_AUDIT_CHECKLIST.md` for the full page-by-page record.

**63 files fixed.** All Priority-1 pages (dashboards, detail/view pages, approval-workflow pages)
found lacking responsive classes were corrected. Priority-2 (multi-line creation/edit forms) and
Priority-3 (low-traffic admin/ops pages) were audited but left alone except for a handful of
severe, guaranteed-overflow exceptions (see below) — everything else on those pages is recorded as
deferred in the checklist, per the gap-prompt's explicit "no full phone-optimized data-entry
parity" scope decision.

## What was actually wrong (beyond the gap-prompt's own pre-audit findings)

The gap-prompt's own framing (written before this session) had already found `CustomersPage.tsx`'s
bare `flex gap-3 mb-4` toolbar as a confirmed first example. This session's full audit found the
same shape of gap repeated across most of the app, plus two failure modes the gap-prompt hadn't
anticipated:

1. **Raw `<table>` elements with _no_ scroll wrapper at all** — not just an outer container
   defeating an existing wrapper (the gap-prompt's anti-pattern (c)), but tables that never had one
   to begin with. Found on ~20 pages (accounting/GST report viewers, HR statutory reports, admin
   audit logs, several detail pages, and — most seriously — the line-item tables on
   `sales/InvoiceFormPage.tsx`, `sales/DeliveryChallanFormPage.tsx`, and
   `purchase/PurchaseOrderFormPage.tsx`, all P2 creation forms). These three P2 forms' table gaps
   were escalated past the normal "defer unless severe" rule and fixed, since an unwrapped
   multi-column table with numeric inputs guarantees page-level horizontal scroll on any phone —
   not a cosmetic issue.
2. **`DashboardPage.tsx` itself — the gap-prompt's own "positive reference example" — had one
   genuine miss**: an "Outstanding Balances" `grid grid-cols-2` row with no responsive prefix,
   alongside the other 8 correctly-responsive grid declarations. Fixed. Worth noting because it
   shows even the file held up as the gold-standard example wasn't 100% clean — the audit's value
   was in actually checking, not assuming.
3. **`accounting/OpeningBalancesPage.tsx`** (a P2 multi-step wizard) had a genuinely severe gap:
   all 5 wizard steps render data-entry rows as non-wrapping `flex` rows with fixed-width children
   summing to 450–550px — a guaranteed clip at 375px, not a cramped-but-usable case. Escalated and
   fixed despite being P2.

## Deviations from the gap-prompt (flagged, not silently decided)

1. **Combined Session A+B into one pass**, per explicit user instruction, instead of the
   gap-prompt's own suggested 3-session split. Session C (Priority-2/3 fixes) was not attempted.
2. **The gap-prompt's anti-pattern (c) was broadened in practice** to also cover "no wrapper at
   all," not just "an outer container defeating an existing wrapper" — the former turned out to be
   the more common real-world shape of the same underlying risk.
3. **Three Priority-2 pages got table-scroll-wrapper fixes** (`InvoiceFormPage.tsx`,
   `DeliveryChallanFormPage.tsx`, `PurchaseOrderFormPage.tsx`) and one Priority-2 page got a full
   flex-wrap pass (`OpeningBalancesPage.tsx`), both exceptions to the "P2/3: defer unless severe"
   rule, justified case-by-case in the checklist — not a blanket re-scoping of P2.
4. Nothing in `useMediaQuery.ts`, `Layout.tsx`, `ERPDataGrid.tsx`, `tokens.css`, tenant-branding, or
   axe-core wiring was touched, per the gap-prompt's explicit "never modify" list.

## Testing

- **New:** `apps/web-frontend/e2e/mobile-responsive-smoke.spec.ts` — 6 Playwright smoke tests
  (3 Priority-1 pages × 2 viewport widths: Dashboard, `CustomerViewPage` as the representative
  detail page, `LeavesPage` as the representative approval-workflow page). Each asserts no
  page-level horizontal scroll (`document.documentElement.scrollWidth` within 2px of the viewport
  width) at 375px and 820px, plus that the mobile nav toggle and the page's primary action/heading
  remain visible and clickable. Follows the existing mock pattern from
  `e2e/global-search.spec.ts` (CORS-preflight handling + `{data: ...}` envelope). All 6 pass.
- `npx tsc --noEmit` on `apps/web-frontend` — clean, no errors introduced by any of the 63 edited
  files.
- `pnpm --filter @erp/web-frontend test` — 144 existing tests pass, no regressions.
- No live-browser manual verification beyond the automated Playwright smoke checks was performed
  this session (no other viewport widths, no non-Chromium browsers, no visual diffing) — per the
  gap-prompt's own Testing section, this is explicitly a smoke-level regression guard, not a full
  visual-regression pipeline.

## Files touched

- 63 page files under `apps/web-frontend/src/pages/` — see
  `ERP-PLANNING/phase-completions/PG-053_AUDIT_CHECKLIST.md` for the exact list and per-file fix
  description. All edits were surgical Tailwind `className` additions (mostly `flex-wrap`,
  `grid-cols-1 sm:grid-cols-N`, or wrapping a raw `<table>` in `<div className="overflow-x-auto">`)
  — no logic changes, no new components, no shared-infrastructure changes.
- `apps/web-frontend/e2e/mobile-responsive-smoke.spec.ts` — new.
- `ERP-PLANNING/phase-completions/PG-053_AUDIT_CHECKLIST.md` — new, the page-by-page audit
  deliverable required by the gap-prompt's own Frontend/Deliverables sections.

## Acceptance Criteria (from the gap-prompt)

- [x] Documented, explicit scope decision — inherited unchanged from the gap-prompt's own
      Architecture section (tablet-usable read/approve workflows, not full phone-optimized data
      entry).
- [x] Page-by-page audit checklist exists, covering every Priority-1 page and all P2/P3 pages too
      (broader than the "at minimum Priority-1" requirement).
- [x] `CustomersPage.tsx`'s filter toolbar fix confirmed in place (`flex-wrap` present), plus every
      other Priority-1 page found with the same pattern fixed.
- [x] No Priority-1 page exhibits page-level horizontal scroll at 375px or 820px — verified for the
      3 pages covered by the new Playwright suite; the remaining Priority-1 pages were verified via
      the static audit (grep + read) described in the checklist, not live browser rendering at
      every single page.
- [x] `ERPDataGrid`'s horizontal-scroll pattern explicitly confirmed as intended, unmodified.
- [x] `pnpm --filter @erp/web-frontend test` and the extended Playwright suite both pass.

## Deployment Checklist

- [x] No migration — pure frontend CSS/layout change, matches the gap-prompt's own "Not
      applicable" call for Database Changes.
- [x] No new environment variables, no new backend API, no new RBAC permission — matches the
      gap-prompt's Backend/API Contract/Security sections, all "Not applicable."
- [ ] **Manual visual spot-check on a real phone/tablet recommended before considering this
      fully done** — this session's verification was static audit (grep + full-file reads) plus 6
      automated Playwright viewport checks on 3 representative pages, not a live visual pass across
      all 63 fixed pages. Not blocking (no live data/users in this environment yet, per
      [[project_dev_phase_no_data]]), but worth doing once a live/staging environment exists.
- [ ] **Priority-2/3 deferred items** (listed in the checklist's "Deferred items" section) are
      intentionally left — revisit only if a specific page is reported as actually broken in real
      use, not proactively.
