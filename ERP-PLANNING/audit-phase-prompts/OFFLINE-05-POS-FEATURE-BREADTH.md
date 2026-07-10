# OFFLINE-05 — POS Offline Feature Breadth (Held Sales, Customer, Receipt)
## STATUS: 🔲 NOT STARTED
## Sprint: Offline-5 | Effort: Medium (3–5 days) | Risk: Medium
## Depends on: OFFLINE-03 (Dexie stores), OFFLINE-04 (populated catalog/customer cache)
## Unlocks: OFFLINE-06 (background sync/status UI needs more than one feature's traffic to be meaningful), OFFLINE-07 (conflict handling needs held-sale reconciliation in scope)
## Source: `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §3 (module-by-module table)

---

## YOUR ROLE

You are the **Frontend Engineer** closing the gap the audit described as: *"only the
narrowest slice of one of three frontends — ringing up a sale... continues to function
without internet. Everything else in the ERP requires a live connection."* This phase
widens that slice within `apps/pos-frontend` specifically (not the whole ERP — that's
OFFLINE-09's decision) to cover held sales, customer search/creation against the local
cache, and giving the cashier a receipt of some kind when offline.

---

## PRE-FLIGHT CHECKLIST

- [ ] Read `ERP-PLANNING/reports/OFFLINE_READINESS_REPORT.md` §2b and §3 in full — the exact list of what does and doesn't work offline in pos-frontend today
- [ ] Read `apps/pos-frontend/src/POSScreen.tsx`'s held-sale (park/resume) code — currently online-only fetches
- [ ] Read the customer search/creation modal code in `POSScreen.tsx` — currently falls through to a live fetch when the customer isn't in the small cached list
- [ ] Read `apps/web-frontend/src/pages/hr/PayslipViewPage.tsx`'s `window.print()` usage — the one existing print pattern in this codebase, to match for the receipt feature
- [ ] Read the OFFLINE-03 Dexie schema for `heldSales` and `customers` (as actually implemented, not as originally sketched — re-check current state)
- [ ] Read the OFFLINE-04 sync loop to confirm `customers` is populated with enough of the customer directory to be useful for offline search (not just the small quick-list) before designing this phase's search UX around it
- [ ] Confirm whether receipt delivery (email/WhatsApp) is expected to queue offline in this phase or remain online-only — the roadmap scopes this phase as "on-screen printable receipt," not full offline receipt delivery; don't scope-creep into WhatsApp/email queueing unless explicitly asked

---

## PROJECT CONTEXT

### Held sales

Today, park-and-resume relies entirely on live backend fetches. Offline, this means a
cashier literally cannot park a cart to serve another customer and come back to it. Fix:
persist held sales locally (Dexie `heldSales` table from OFFLINE-03) and only sync them
to the backend opportunistically when online — parking/resuming a sale is a
single-device, single-session operation in most POS workflows, so a local-only held-sale
model (synced for backup/audit purposes when possible, not required for the park/resume
UX to function) is reasonable. Confirm this assumption matches how held sales are used
today (single-terminal vs. shared-across-terminals) before finalizing — if held sales
must be visible across multiple terminals at the same store, this needs a different
design and should be flagged as a decision point rather than assumed.

### Customer search/creation

With OFFLINE-04's catalog/customer sync in place, "search customers" can search the
local Dexie `customers` table instead of falling through to a live fetch. New-customer
creation offline should queue similarly to how OFFLINE-02 handles sale creation — a
locally-created customer needs its own idempotent sync path (client-generated ID,
atomic dedupe on sync) mirroring the sale-sync pattern, not a new invented mechanism.

### Receipt

The audit found POS "Complete Sale" produces zero receipt output today, online or
offline. Rather than building thermal/ESC-POS printing (out of scope, flagged separately
in the hardware-readiness report as its own gap), this phase's minimum bar is an
on-screen, printable summary via `window.print()` — matching the existing payslip
pattern — that works with zero network dependency, since it only needs data already in
memory/local DB from the completed sale.

### Coding Standards
- TypeScript strict — no `any`
- Reuse the OFFLINE-02 idempotent-sync pattern for any new offline-write path (customer creation); don't invent a second idempotency mechanism
- Match existing UI component patterns/styling in `POSScreen.tsx` rather than introducing new component conventions

---

## OBJECTIVE

1. Held sales can be parked and resumed entirely offline, using local Dexie storage
2. Customer search works offline against the locally-synced customer directory; customer creation offline queues and syncs idempotently
3. Completing a sale offline (or online) shows an on-screen, printable receipt via `window.print()`

---

## SCOPE

### Step 1 — Held sales offline

Rework the park/resume feature in `POSScreen.tsx` to read/write the Dexie `heldSales`
table as the source of truth, rather than a live fetch. If backend persistence of held
sales is still desired for cross-device visibility or audit, sync opportunistically when
online (best-effort, not blocking the local park/resume UX) — confirm this design
against actual multi-terminal usage patterns first (see Project Context).

### Step 2 — Customer search/creation offline

Point the existing customer-search modal at the local `customers` Dexie table (populated
by OFFLINE-04) instead of a live fetch, falling back to a live fetch only when online and
the local result set seems incomplete (e.g. to catch customers created very recently on
another terminal, if that's a real scenario). For offline customer creation, add a
locally-queued, idempotent creation flow mirroring OFFLINE-02's sale-sync pattern
(client-generated ID, atomic backend dedupe on sync).

### Step 3 — Printable receipt

Add a receipt view (component or simple print-formatted DOM) triggered after "Complete
Sale," populated from the just-completed sale's in-memory data (works identically
online or offline, since it needs no network call), triggering `window.print()` matching
`PayslipViewPage.tsx`'s pattern and print CSS conventions.

### OUT OF SCOPE
- Returns/Exchange offline support (still delegated to `web-frontend` per current
  design — bringing this in-app and offline-capable is a larger scope decision, not
  assumed as part of this phase unless explicitly requested)
- Thermal/ESC-POS receipt printing, WhatsApp/email receipt delivery offline
- Cross-terminal real-time visibility of held sales (unless Step 1's investigation finds this is already required — if so, flag it as a scope question rather than silently building it)

---

## TESTING REQUIREMENTS

1. A held sale created offline persists across app reload and can be resumed offline
2. Customer search returns results from the local cache when offline
3. A customer created offline queues, and syncs exactly once (no duplicate) when back online — mirror OFFLINE-02's idempotency test pattern
4. Completing a sale offline produces a printable receipt with correct sale data
5. Completing a sale online (existing path) is unaffected

---

## BUILD VERIFICATION

```bash
pnpm --filter @erp/pos-frontend build
pnpm --filter @erp/pos-frontend type-check
pnpm lint
```

---

## VERIFICATION CHECKLIST

- [ ] Held sales work fully offline (park + resume)
- [ ] Customer search works offline against synced data
- [ ] Offline customer creation is idempotent on sync
- [ ] A receipt is viewable/printable after any completed sale, online or offline

---

## REGRESSION CHECKLIST

- [ ] Existing online held-sale/customer-search behavior (if any backend sync is retained) still works
- [ ] OFFLINE-01/02/03/04 behavior is unaffected

---

## DEFINITION OF DONE

- [ ] Held sales, customer search/creation, and receipt viewing all work fully offline within pos-frontend
- [ ] All tests pass; regression suite green
- [ ] `pnpm lint` and `pnpm type-check` pass
- [ ] Completion report saved at `ERP-PLANNING/phase-completions/OFFLINE-05_COMPLETION.md`
- [ ] `ERP-PLANNING/reports/OFFLINE_FIRST_ROADMAP.md` updated to mark OFFLINE-05 complete

---

## COMPLETION REPORT TEMPLATE

**Save as:** `ERP-PLANNING/phase-completions/OFFLINE-05_COMPLETION.md`

```markdown
# OFFLINE-05 Completion Report — POS Offline Feature Breadth
**Date:** [YYYY-MM-DD]
**Status:** COMPLETE / PARTIAL

## Features Closed
| Feature | Offline behavior before | Offline behavior after |
|---|---|---|
| Held sales | online-only | local Dexie, works offline |
| Customer search/creation | online-only beyond small cache | local cache + idempotent offline creation |
| Receipt | none | on-screen printable via window.print() |

## Files Changed
[Table]

## Tests: [N]/[N] PASS | lint: PASS | type-check: PASS | build: PASS

## Known Issues / Deferred
- Returns/Exchange remain delegated to web-frontend (online-only)
- [Cross-terminal held-sale visibility — resolved as: ...]
```
