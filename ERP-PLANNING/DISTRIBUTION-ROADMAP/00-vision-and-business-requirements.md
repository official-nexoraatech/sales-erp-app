# 00 — Vision & Business Requirements

## Why Distribution, and why now

`ERP-PLANNING/multi-industry-platform/19-first-industry-recommendation.md` scored Distribution
as the **primary recommendation** for the platform's first new industry vertical: highest
existing-code reuse, lowest new-domain-complexity, cleanest signal on whether the Business
Profile / Capability Registry / capability-gating pipeline (built and proven on Grocery's
`INVENTORY_BATCH` and this session's `HR_PAYROLL`/`POS` enforcement) generalizes to a genuinely
different business shape — without also taking on Hotel/Healthcare's much larger domain-modeling
risk in the same pass. The two hard prerequisites the roadmap named (CRM/O2C service split,
Commerce Core generalization) are both done as of 2026-08-20.

**This document scopes "Distribution" deliberately narrowly**, per the recommendation's own
framing: a B2B/wholesale reseller that buys from suppliers/manufacturers and sells to other
businesses (retailers, sub-dealers) at negotiated, volume-tiered pricing with credit terms —
**not** a route-to-market/van-sales FMCG distributor with field reps, delivery-route planning,
or handheld order-taking. That's a materially different, larger undertaking (new domain:
routes, visit schedules, van inventory) that the source recommendation never scoped Distribution
as needing, and pulling it in now would silently expand what was sized as a low-risk validation
pass into something closer to Hotel's complexity profile. If field-sales/route-to-market is
wanted, it's a deliberate follow-on decision, not an assumed part of this phase — see
`05-rollout-plan.md`'s explicit non-goals.

## What a Distribution tenant actually needs, evidence-based

Verified directly against the current schema and domain code (not assumed):

1. **B2B customer relationships at scale.** `customers.customerType` already has `'WHOLESALE'`
   and `'B2B'` values (`packages/db-client/src/schema/master.ts:65`); `crm_accounts` (CRM-ROADMAP
   Phase 1, Feature 1, now in `crm-service`) already models the company/entity a B2B customer
   belongs to, separate from the transactional customer record.
2. **Customer-specific, volume-tiered pricing.** `price_lists`/`price_list_items` already exist
   (`packages/db-client/src/schema/items.ts:312-358`) with per-item `minQty` thresholds and
   `discountPercent` — exactly the "buy 100 units, pay less per unit" mechanic a distributor
   needs for its dealer network. `customers.priceListId` already exists as an assignable field
   (`master.ts:104`).
3. **Credit terms per customer.** `creditLimit`/`creditDays`/`creditLimitEnabled` already exist
   on `customers` (`master.ts:97-99`) and are already enforced (`CREDIT_LIMIT_OVERRIDE` permission
   guard, confirmed live in this repo's own test suite) — a distributor extending 30/60/90-day
   terms to its dealers needs nothing new here.
4. **Multi-branch/warehouse operations.** Already mature and vertical-agnostic — both existing
   verticals use it today.
5. **Procurement from suppliers.** Purchase Orders → GRN → GRN Lines (`packages/db-client/src/
schema/purchase.ts`) are fully built and reused by every vertical today; a distributor's
   "buy from manufacturer" side is not materially different from existing GRN-driven procurement.
6. **GST-compliant B2B invoicing.** Reuses GST as-is per the source recommendation — no new
   regulatory modeling.

## The one real, verified gap: price lists aren't wired into invoice/quotation pricing yet

This is the load-bearing finding of this discovery pass, found by tracing every consumer of
`priceListItems` in the codebase, not assumed from the schema's existence:

- `priceListItems` is read in exactly **one** runtime path today: `pos.routes.ts`'s item-search
  endpoint, and only when the caller explicitly passes a `priceListId` **query parameter** — a
  manual, per-request override for retail POS display, not an automatic resolution.
- `customers.priceListId` (the field that should drive this automatically for a given customer)
  is set on the customer record but is **never read** by `QuotationService.create()` or
  `InvoiceService`'s line-creation path — both require the caller to supply `unitPrice` on every
  line explicitly, with no price-list lookup in between.
- Net effect today: a distributor could configure price lists and assign one to each dealer, but
  every quotation/invoice line for that dealer would still need its price entered by hand,
  defeating the entire point of maintaining tiered pricing centrally.

This is the one piece of real, new domain work this phase needs — see `02-domain-model-and-gaps.md`
for the resolution design. Everything else in this list is pure reuse.

## Explicitly out of scope for this phase

- Route-to-market / van-sales / delivery-route planning (see above — a deliberate, separate
  future decision, not assumed here).
- Supplier-side (purchase) volume pricing — no evidence any current vertical needs it, and
  Distribution's own recommendation didn't call it out; revisit only if real usage demands it.
- Any new regulatory/GST modeling — reuses the existing GST engine unchanged.
- A new `Distributor`/`RouteSales` RBAC role — `SALES_MANAGER`/`CASHIER`/`ACCOUNTANT` already
  cover a wholesale reseller's operational needs; see `03-capability-rbac-model.md` for the
  explicit "no new role" confirmation.

## Success criteria

A tenant can be provisioned with `vertical: 'DISTRIBUTION'`, assign customers a `WHOLESALE`/`B2B`
type with a price list and credit terms, and have quotations/invoices for that customer
automatically price each line from that price list's quantity-break tiers (falling back to the
item's standard sale price when no matching tier exists) — without any change to GST, procurement,
or multi-branch behavior, and with zero behavior change for existing `CLOTH_RETAIL`/`GROCERY`
tenants.
