# OFFLINE-09 — web-frontend Offline Scope (Client-Scoped Subset)
## STATUS: ✅ COMPLETE — rescoped to pos-frontend (see Agreed Scope below); see `ERP-PLANNING/phase-completions/OFFLINE-09_COMPLETION.md`
## Sprint: Offline-9 | Effort: Large (this is the biggest phase in the series; exact size depends entirely on scope decided below) | Risk: Medium–High (largest surface area, most files touched)
## Depends on: OFFLINE-01 through 04 at minimum (auth/idempotency/local-DB/sync patterns must exist to extend into a second app)
## Unlocks: nothing further in this series
## Source: `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §2a, §9; roadmap decision #5

---

## YOUR ROLE

You are the **Frontend Platform Engineer** deciding, with the client, how much of
`apps/web-frontend` — the main back-office app (invoicing, inventory, HR, accounting,
CRM, GST, purchases, reports) — should gain offline capability, and then building that
agreed subset.

**This phase cannot start with a fixed scope the way OFFLINE-01 through 08 can.** The
audit found `web-frontend` has zero offline infrastructure of any kind, and building
full offline parity for "the majority of the ERP's functionality" (the audit's own
characterization) is realistically a program of its own, not a single phase. The
roadmap deliberately left this open, scoped to "a defined subset of read paths — decided
with the client based on which back-office tasks actually happen at a store counter."

**Do not begin implementation before that scoping conversation has happened and is
recorded in this file's "Agreed Scope" section below.** Building a large, unscoped
offline layer for an app this size without agreement first risks significant wasted
effort exactly the kind CLAUDE.md's guidelines warn against.

---

## AGREED SCOPE

**Decided 2026-07-05, with client:**

- **Target app: `apps/pos-frontend`, not `web-frontend`.** The client picked the option
  this file explicitly raised as worth considering — `pos-frontend` already has the full
  offline foundation from OFFLINE-01 through 08 (Dexie, delta sync, idempotency), so a
  counter-level lookup need is served there instead of building new offline
  infrastructure in the much larger, architecturally separate `web-frontend`.
- **Data in scope: item/price/tax lookup + customer lookup, read-only.** Both are
  already fully mirrored to `pos-frontend`'s Dexie store by OFFLINE-04's reference-data
  sync (`catalogItems`, `customers` tables) — this required **no new backend endpoint,
  no new Dexie table, and no new sync logic**, only a new read-only screen over
  already-synced data.
- **Explicitly excluded: stock-quantity lookup and customer purchase history.**
  Investigated and rejected for this phase because neither is cached anywhere today —
  stock has zero sync path (no `/sync/stock` endpoint, no Dexie table; the only stock
  data reaching the client is a transient conflict artifact on a single failed sale) and
  purchase history only exists via an online-only `sales-service` endpoint. Both would
  require genuinely new sync infrastructure (a new endpoint, a new Dexie table, and —
  for stock specifically — a much more prominent staleness warning since it goes stale
  far faster than item/price/tax master data). Deferred rather than built speculatively.
- Since the target app changed, this phase produced no changes to `apps/web-frontend` at
  all — `web-frontend` remains at the confirmed-zero offline baseline the audit
  described, unchanged by this decision.

---

*(Original scoping questions, for reference — first bullet resolved to pos-frontend, second to read-only, third is the "excluded" note above)*

- **Which specific pages/read-paths need offline support?** (e.g. item lookup for a
  manager checking stock at the counter, customer lookup — likely candidates per the
  audit's module table; full invoice creation/accounting/HR/GST are far less likely
  candidates for offline given their complexity and lower frequency of "must work
  during a counter-level outage")
- **Read-only or read/write?** Read-only (cached lookups) is a much smaller lift than
  offline write support (which would need its own idempotent-sync design mirroring
  OFFLINE-02, applied to whatever entities are in scope)
- **Is this even the right app for these use cases, or should they move into
  `apps/pos-frontend` instead?** Given `pos-frontend` already has the offline
  foundation (OFFLINE-01 through 08), a "manager needs to check exact stock/customer
  history at the counter during an outage" need might be better served by adding a
  small lookup feature to `pos-frontend` than by retrofitting offline support onto a
  much larger, architecturally separate app. Raise this option explicitly in the
  scoping conversation rather than assuming `web-frontend` is the only place this can
  go.

---

## PRE-FLIGHT CHECKLIST (once scope is agreed)

- [ ] Read `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §2a in full — the confirmed-zero baseline for `web-frontend`
- [ ] Read `apps/web-frontend/src/api/client.ts` — the current fetch-based API client with no offline handling, no `navigator.onLine` checks, `mutations: { retry: 0 }`
- [ ] Read `apps/web-frontend/vite.config.ts` — confirm no PWA/service-worker tooling exists yet; decide whether to add `vite-plugin-pwa` here (unlike `pos-frontend`'s hand-rolled SW, a fresh implementation in a new app might reasonably use a more standard tool — evaluate rather than mechanically copying `pos-frontend`'s hand-rolled approach)
- [ ] Read whichever specific pages are in the agreed scope (e.g. `ItemsPage.tsx`, `CustomerFormPage.tsx`) to understand their current data-fetching pattern (React Query, per `apps/web-frontend/src/main.tsx`'s query client config)
- [ ] Cross-reference OFFLINE-03/04's Dexie schema and delta-sync endpoints — if the agreed scope overlaps with entities `pos-frontend` already syncs (items, customers), evaluate whether `web-frontend` can reuse the *same backend endpoints* (it almost certainly can, they're generic authenticated endpoints) rather than building parallel ones

---

## PROJECT CONTEXT

### Why this phase is structured differently from OFFLINE-01–08

Every other phase in this series has a fixed, evidence-backed scope because the audit
already established exactly what's missing and exactly what needs to change. This
phase's scope is a business decision (which back-office tasks genuinely need to survive
a counter-level outage), not a technical one — building it before that decision is made
risks solving the wrong problem at large expense, which directly conflicts with "don't
rebuild the ERP" and "no features beyond what was asked."

### Coding Standards
- TypeScript strict — no `any`
- Reuse OFFLINE-01 through 04's established patterns (idempotent sync, delta-download
  convention, Dexie local storage) rather than inventing new ones for `web-frontend` —
  the whole point of building those patterns first was so a second app could adopt them
- Match `web-frontend`'s own existing conventions (React Query, its component structure) for whatever new offline-aware code is added — don't import `pos-frontend`'s UI patterns wholesale

---

## OBJECTIVE

*(Finalize once scope is agreed — draft below assuming a read-only lookup scope, adjust if the agreed scope differs)*

1. The agreed subset of `web-frontend` pages can display previously-synced data when offline, rather than erroring
2. A lightweight service worker + local cache (reusing OFFLINE-03's Dexie approach or a fresh minimal one, per the pre-flight decision) backs this
3. Clear UI indication when data shown is from a local cache (staleness indicator, matching the existing dashboard staleness-badge pattern from `ES-01`) rather than live

---

## SCOPE

*(To be written once the Agreed Scope section is filled in — this phase's prompt is deliberately left as a scoping template, not a fixed step-by-step plan, unlike OFFLINE-01–08. When scope is agreed, expand this section following the same Step 1/Step 2/... format as the other phases before implementation begins.)*

### OUT OF SCOPE (regardless of final agreed scope)
- Offline write support for anything beyond what's explicitly agreed — read-only lookup is the default assumption unless the scoping conversation specifically agrees otherwise
- Rebuilding `web-frontend`'s data-fetching layer wholesale — this should be additive (a cache-fallback layer), not a replacement of React Query
- Any GST filing, bank sync, or other explicitly-online-required module (per the roadmap's Phase 2 classification) — these remain online-only by design, not by oversight

---

## TESTING REQUIREMENTS

*(Finalize once scope is agreed; at minimum)*
1. Agreed pages display cached data correctly when offline
2. A clear staleness/offline indicator is shown when displaying cached (not live) data
3. Normal online behavior for these pages is unaffected

---

## BUILD VERIFICATION

```bash
pnpm --filter @erp/web-frontend build
pnpm --filter @erp/web-frontend type-check
pnpm --filter @erp/web-frontend test
pnpm lint
```

---

## VERIFICATION CHECKLIST

- [ ] Agreed scope is documented and confirmed before implementation began
- [ ] Agreed pages work offline as scoped
- [ ] Staleness/offline indication is clear and accurate
- [ ] No unscoped pages/modules were touched

---

## REGRESSION CHECKLIST

- [ ] All `web-frontend` pages outside the agreed scope behave exactly as before
- [ ] Existing React Query configuration/behavior for non-offline-scoped pages is unaffected

---

## DEFINITION OF DONE

- [ ] Scope explicitly agreed and recorded before implementation
- [ ] Agreed subset works offline with clear staleness indication
- [ ] All tests pass; regression suite green
- [ ] `pnpm lint` and `pnpm type-check` pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/OFFLINE-09_COMPLETION.md`
- [ ] `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` updated to mark OFFLINE-09 complete, with the final agreed scope documented

---

## COMPLETION REPORT TEMPLATE

**Save as:** `ERP-PLANNING/phase-completions/OFFLINE-09_COMPLETION.md`

```markdown
# OFFLINE-09 Completion Report — web-frontend Offline Scope
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE / PARTIAL

## Agreed Scope
[What was decided, and why — record the scoping conversation's outcome here]

## What Changed
[Summary]

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Known Issues / Deferred
- [Anything explicitly left out of the agreed scope, for future consideration]
```
