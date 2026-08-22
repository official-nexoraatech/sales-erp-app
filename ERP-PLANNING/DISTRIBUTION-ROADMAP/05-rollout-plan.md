# 05 — Rollout Plan

## Phased implementation

**Phase A — Business Profile + provisioning (no user-facing behavior change yet)**

- Migration: new `business_types` row.
- `vertical-defaults.ts`, `tenant.schemas.ts` updated (§`04-database-and-api-impact.md`).
- `default-accounts.ts`/`scheduler-internal.routes.ts` updated with an explicit `DISTRIBUTION`
  case.
- `HR_PAYROLL.applicableBusinessTypes` updated.
- Testing: provision a real test tenant with `vertical: 'DISTRIBUTION'`, confirm correct
  `business_type_id` backfill, correct default feature flags, correct chart of accounts seeded —
  mirrors the exact test shape `phase-04-business-profile-foundation` already used.
- **Completion criteria**: a Distribution tenant can be created and looks/behaves identically to
  a `CLOTH_RETAIL` tenant in every way except its own capability defaults — zero new domain
  behavior yet, purely the "can the platform recognize a third vertical" proof.

**Phase B — Price-list resolution (the actual new capability) ✅ Done, live-verified 2026-08-21**

- `resolveLinePrice()` + wiring into `QuotationService`/`InvoiceService`.
- New `GET /pricing/resolve` endpoint.
- Frontend: `QuotationFormPage.tsx`/`InvoiceFormPage.tsx` updated to call it when a line's
  customer has a `priceListId`, replacing the current unconditional `item.salePrice` prefill.
- Testing: unit test for `resolveLinePrice()`'s tier-selection logic (exact `minQty` boundary,
  no-match fallback to `items.salePrice`, no price list assigned at all); integration test proving
  a real quotation/invoice line prices correctly for a price-listed customer; a dedicated
  before/after test proving a customer **without** a price list gets byte-identical behavior to
  today (the same "zero behavior change for the non-participating case" discipline the CRM/O2C
  split's own acceptance criteria used).
- **Completion criteria**: this document's `00-vision-and-business-requirements.md` success
  criterion, verified live in a browser — a rep adds a line for a price-listed customer and sees
  the tiered price applied automatically, not just possible in theory via a raw API call.
  **Verified 2026-08-21** — implementation turned out server-authoritative rather than
  frontend-omission-based (`PricingResolutionService.resolveLines()` overrides _any_ submitted
  `unitPrice` when a matching price-list tier exists, not just when the field is omitted — a
  stronger, more robust design than this doc originally specified, confirmed intentional via its
  own test suite, `pricing-resolution.integration.test.ts`). Live-verified end-to-end via real API
  calls against a fresh `DISTRIBUTION` tenant: a quotation line submitted with `unitPrice: 999` at
  qty 25 against a price list with tiers (0+ → ₹90, 20+ → ₹70) persisted at ₹70 (correct tier,
  correct GST math); the same item at qty 5 persisted at ₹90 (correct lower tier). The
  frontend-gap concern this doc originally raised turned out to already be resolved by an
  unrelated earlier QA fix (`QuotationFormPage.tsx`/`InvoiceFormPage.tsx` already pass
  `priceListId` to item search, itself already resolved via the same `pos.routes.ts`-precedent
  `COALESCE` this doc cites) — no frontend change was needed this pass.

## Explicit non-goals (repeated from `00-vision-and-business-requirements.md`, load-bearing enough to restate)

- No route-to-market / van-sales / delivery-route domain modeling.
- No supplier-side (purchase) volume pricing.
- No new regulatory/GST modeling.
- No new RBAC role.
- No `POS` capability default-enabled for Distribution (opt-in only, per `03-capability-rbac-
model.md` §1's recommendation, pending your confirmation on whether real Distribution tenants
  ever run a retail counter).

## Rollback

**Phase A**: trivial — the new `business_types` row and vertical-defaults entry are additive;
removing them only affects future provisioning, not existing tenants (no existing tenant has
`vertical = 'DISTRIBUTION'` before this ships, by construction).

**Phase B**: `resolveLinePrice()` is only invoked when `unitPrice` is omitted — reverting the
frontend change (stop omitting it) instantly restores today's exact behavior with zero data
cleanup, matching the CRM/O2C split's own "additive preHandler, trivial revert" precedent for
capability gating.

## Decisions — CONFIRMED 2026-08-20

1. **POS**: off by default. "Wholesale is the default; retail counter is an optional operating
   model." (`03-capability-rbac-model.md` §1)
2. **`price_list_items.discountPercent`**: does not stack — resolved `salePrice` is authoritative
   and predictable. (`02-domain-model-and-gaps.md` §1)
3. **`INVENTORY_BATCH`**: on by default. "Strong fit for distributor traceability and inventory
   operations." (`03-capability-rbac-model.md` §2)

All three confirmed decisions match this plan's own recommendations. Cleared to begin Phase A.
