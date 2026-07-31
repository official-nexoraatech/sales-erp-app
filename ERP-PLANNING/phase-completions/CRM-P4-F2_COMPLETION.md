# CRM-ROADMAP Phase 4, Feature 2 — WhatsApp Commerce — Completion Report

**Date:** 2026-07-31
**Status:** Complete, tested against a real local Postgres, zero regressions.

## Summary

Browse-and-order-in-WhatsApp orders create a real `Quotation` through the existing
`QuotationService` — no parallel order-creation logic, per this feature's own explicit reuse
instruction. Research before writing code confirmed: the existing WhatsApp integration (Phase 2
Feature 5) is Meta's Cloud API directly (not a BSP), credentials carry over to Commerce API, but
the inbound webhook handler only ever parsed plain text messages — order-type messages needed
new parsing added, not a drop-in reuse.

### The catalog-setup gap (flagged up front)

Meta Commerce Manager catalog configuration — connecting a product catalog to the WhatsApp
Business Account, and mapping each catalog product's `product_retailer_id` to this ERP's own
`items.itemCode` — is a **manual admin step outside this codebase**, unaffected by any code
change here. This feature assumes that mapping convention (`product_retailer_id === itemCode`);
if the catalog is synced with a different id scheme, every order will reject with "Unknown
product_retailer_id" until the mapping is corrected on the Meta side.

### Backend

- **Schema** (migration `0148_crm_whatsapp_catalog_orders.sql`): `crm_whatsapp_catalog_orders`
  logs every order webhook received — successful or rejected — so a rejected order is never
  silently dropped; a merchandiser can see exactly why a customer's WhatsApp order never became
  a quote.
- **`WhatsAppCommerceService`** (new): `handleOrderMessage` — idempotent on
  `wa_order_message_id` (Meta retries webhook delivery), resolves the tenant's head-office
  branch, derives the seller's GST state code from that branch's own GSTIN (first 2 digits — the
  standard convention; no dedicated `stateCode` column exists on `branches`), validates every
  line's `product_retailer_id` against `items.itemCode`, and **reconciles price as a hard
  reject, never a partial honor**: any line whose WhatsApp-catalog price differs from the live
  ERP price by more than a rounding tolerance rejects the _entire_ order (not just that line) —
  per the roadmap's own explicitly-named edge case. On success, creates a real `Quotation` via
  the existing `QuotationService.create`. A brand-new WhatsApp contact (no matching `customers`
  row by phone) is auto-created (`createdBy: 0`, this codebase's established system-actor
  convention, also used by `LoyaltyService`/`NumberSeriesEngine`).
- **`inbound-webhooks.routes.ts`** extended: the existing `/webhooks/whatsapp` handler now
  branches on `msg.type === 'order'` (routing to `WhatsAppCommerceService`) vs. plain text
  (unchanged, still `ConversationService.recordInboundMessage`) — same signature-verified,
  public-route shape as before, no new webhook path or gateway change needed.
- **`GET /crm/whatsapp-orders`** (new, in `crm.routes.ts`): reuses the existing
  `QUOTATION_VIEW` permission rather than inventing a new one — this is just "which quotations
  came from WhatsApp," the same resource a caller already needs `QUOTATION_VIEW` to see.

### Frontend

Per the roadmap's own "minimal ERP-side UI beyond an order-source indicator" spec: no new page.
Added a "Source" column to the existing `QuotationsPage.tsx` list, showing a "WhatsApp" badge on
any quotation whose id appears in `crm_whatsapp_catalog_orders`.

## Decisions (flagged, not silently decided)

1. **Place of supply defaults to intra-state (same as the seller) for a brand-new WhatsApp
   contact** — there's no known billing address for a customer who has only ever messaged on
   WhatsApp. This is a real GST-treatment limitation: if the customer is actually in a different
   state, the auto-created quotation's GST split (CGST+SGST vs. IGST) will be wrong until
   corrected manually. Flagged prominently, not silently assumed correct.
2. **Order rejection is logged but the customer is never auto-notified on WhatsApp** — a
   rejected order (unknown product, price drift) is visible to staff via the new order-source
   list, but nothing messages the customer back explaining why their order didn't go through.
   Deferred as a real, separate follow-up (would need its own outbound-message template/consent
   handling), not silently dropped.
3. **`product_retailer_id === items.itemCode`** — the one mapping convention that makes catalog
   sync possible without a dedicated mapping table; documented above as the thing to verify first
   if orders start rejecting unexpectedly in a real deployment.
4. **No catalog-sync tooling built** — pushing this ERP's item catalog into Meta Commerce
   Manager is a manual admin process, explicitly out of scope (the roadmap's own spec frames the
   catalog as "provider-hosted").

## Testing performed this session

- `pnpm --filter @erp/db build` — clean.
- Migration `0148` live-applied to the local dev Postgres.
- Type-check clean: `sales-service`, `web-frontend`.
- **New tests, all passing**: `whatsapp-commerce-service.test.ts` (6, real DB) — rejects an
  unknown `product_retailer_id` (no quotation created), rejects a price-drifted order (never
  silently honors the stale WhatsApp price), creates a real quotation + auto-creates the
  customer for a valid order, reuses an existing customer matched by phone instead of
  duplicating, idempotent replay of the same `wa_order_message_id` creates no second quotation,
  a head-office branch with no GSTIN configured rejects with a clear reason rather than crashing
  or guessing a state code.
- **Full regression sweep**: `sales-service` showed the same 13-file JWT-issuer baseline plus
  one already-confirmed CPU-contention flake (`journey-service.test.ts`, re-run standalone this
  same session during CTI's own sweep and again just now — both times 19/19 clean). Zero real
  regressions. `web-frontend`: 442/442, no `dark:` variant issues from the new `QuotationsPage.tsx`
  column.
- `pnpm --filter @erp/sales-service lint` — at its pre-existing 2-error baseline (one new error
  introduced and fixed during this session: an unused `itemId` test-fixture variable).

## What is not done (remaining TODO)

| Item                                                       | Why deferred                                            | Target                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| Auto-reply to the customer on order rejection              | Separate outbound-messaging/consent concern             | Follow-up if real usage shows the gap matters                  |
| Catalog-sync tooling (ERP → Meta Commerce Manager)         | Roadmap frames the catalog as provider-hosted/manual    | Only if manual sync proves too costly at scale                 |
| Real customer state/address resolution for place-of-supply | No address exists for a brand-new WhatsApp-only contact | Ask for state during/after the order, or on next staff contact |
| Playwright E2E coverage                                    | Not run this session                                    | Follow-up                                                      |

## Deployment Checklist

- [ ] Apply migration `0148_crm_whatsapp_catalog_orders.sql` to every real tenant's database
      (same `db:migrate`-is-broken caveat as every other feature shipped this session).
- [ ] Set up the product catalog in Meta Commerce Manager and connect it to the WhatsApp
      Business Account (user's own action — outside this codebase).
- [ ] Confirm every catalog product's `product_retailer_id` matches this ERP's `items.itemCode`
      exactly, or orders will reject with "Unknown product_retailer_id" until corrected.
