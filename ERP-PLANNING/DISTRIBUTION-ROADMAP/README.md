# ERP-PLANNING/DISTRIBUTION-ROADMAP — How to Use This Folder

Status: **Discovery/planning only.** No source file, migration, or config was changed to produce
any document in this folder. Written 2026-08-20, immediately after the CRM/O2C service split
completed and cleared the last hard prerequisite the multi-industry-platform roadmap named for
onboarding a new industry vertical (see `ERP-PLANNING/multi-industry-platform/16-phase-roadmap.md`
Phase 10's readiness criteria).

Distribution was the user-confirmed pick over Hotel/Healthcare/Manufacturing, per
`ERP-PLANNING/multi-industry-platform/19-first-industry-recommendation.md`'s own ranking
(highest reuse, lowest new-domain-complexity — the correct choice for validating the pipeline on
a real second vertical before attempting something genuinely harder).

**Right-sized deliberately**: 6 documents, not a copy of `CRM-ROADMAP`'s 15-doc structure —
because the actual investigation found Distribution is "mostly configuration," and padding the
doc count to match a much more complex prior initiative would be its own kind of overcomplication
(CLAUDE.md §2).

## Start here

1. `00-vision-and-business-requirements.md` — why Distribution, what it needs, the one real gap
   found (price lists exist but aren't wired into quotation/invoice pricing), explicit scope
   boundary (no route-to-market/van-sales).
2. `01-current-state-evidence.md` — the exhaustive, verified inventory of what's reused vs. what
   needs a small change, including every `vertical`-keyed call site in the codebase.
3. `02-domain-model-and-gaps.md` — the price-list-resolution design (the one piece of real new
   domain work).
4. `03-capability-rbac-model.md` — three explicit, unresolved product decisions (POS default,
   `discountPercent`'s intended meaning, `INVENTORY_BATCH` default) that need your confirmation
   before implementation.
5. `04-database-and-api-impact.md` — the exact file list, plus a frontend gap this pass found
   (both line-item forms always send an explicit price today, so the backend change alone
   wouldn't actually be reachable through the UI without a matching frontend change).
6. `05-rollout-plan.md` — two-phase implementation (Business Profile first, price-list
   resolution second), completion criteria, rollback, and the three open decisions restated.

## What "done" looks like

A tenant provisioned with `vertical: 'DISTRIBUTION'` behaves identically to `CLOTH_RETAIL` in
every existing respect (Phase A), and a rep building a quotation/invoice for a price-listed
customer sees the correct quantity-tiered price applied automatically, verified live in a browser,
with zero behavior change for any customer that has no price list assigned (Phase B).

## Explicit non-goals

Route-to-market / van-sales / delivery-route planning. Supplier-side volume pricing. Any new
regulatory/GST modeling. Any new RBAC role. `POS` capability defaulting on for Distribution.

## Status: CLEARED TO CODE (2026-08-20)

All three decisions in `03-capability-rbac-model.md`/`05-rollout-plan.md` are confirmed by the
user: POS off by default, tiered `salePrice` authoritative (`discountPercent` doesn't stack),
`INVENTORY_BATCH` on by default — same "decisions requiring business judgment are recorded, not
silently resolved" discipline this session's CRM/O2C split used throughout. Phase A
implementation begins now.
