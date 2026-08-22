# 02 — Domain Model & Gaps

Per `01-current-state-evidence.md`, almost everything Distribution needs already exists. This
document designs the one real gap (automatic price-list resolution) and confirms, explicitly,
everything else that does **not** need new domain modeling.

## 1. Price-list resolution — the actual design

**Current shape**, confirmed by reading both call sites in full:

- `QuotationService`'s and `InvoiceService`'s line-input interfaces (`QuotationLineInput`,
  `InvoiceLineInput`) both declare `unitPrice: number` as **required** — every existing caller
  (web-frontend forms, POS) already supplies it explicitly today.
- `InvoiceService` already has a _related but different_ mechanism: a price-floor check
  (`PriceFloorViolationError` if `l.unitPrice < minPrice`, gated by `PRICE_FLOOR_OVERRIDE`). The
  new resolution logic must feed into this unchanged — an auto-resolved price still has to clear
  the floor check, never bypass it.

**Proposed change, minimal and additive:**

1. Make `unitPrice` **optional** on both line-input interfaces. Every existing caller keeps
   sending it explicitly — this is the entire reason the change is backward-compatible by
   construction, not by careful testing: a tenant that never omits `unitPrice` literally cannot
   observe any behavior change.
2. When a line omits `unitPrice`, resolve it via a new, small, shared function —
   `resolveLinePrice(db, tenantId, itemId, customerId, quantity)` — before the existing
   price-floor check runs:
   - If the customer has a `priceListId`, look up `price_list_items` for
     `(priceListId, itemId)`, filter to rows where `minQty <= quantity`, order by `minQty DESC`,
     take the first match's `salePrice`.
   - If no price list assigned, or no matching tier, fall back to `items.salePrice` (the
     item's own standard price) — the exact same `COALESCE(priceListItems.salePrice,
items.salePrice)` precedent `pos.routes.ts`'s item-search endpoint already established, kept
     consistent rather than inventing a second convention.
3. Call this resolver from `QuotationService.create()` and `InvoiceService`'s line-creation path,
   only for lines missing `unitPrice`.

**CONFIRMED 2026-08-20: `salePrice` is authoritative; `discountPercent` does not stack** —
"Resolved tier price should be authoritative and predictable." `resolveLinePrice()` reads only
`price_list_items.salePrice`, matching the one existing precedent (`pos.routes.ts`'s
`COALESCE(priceListItems.salePrice, items.salePrice)`); `discountPercent` is left untouched by
this resolution path. Quotation/Invoice lines already have their own independent
`discountPct`/`discountAmount` fields for a rep to apply an additional, situational discount on
top if needed — that remains the only discount mechanism this phase wires up.

## 2. Everything else — confirmed no new domain modeling needed

- **Customer/account model**: `customers.customerType = 'WHOLESALE'`/`'B2B'` + `crm_accounts` for
  the dealer's company entity — both already exist, zero schema change.
- **Credit terms**: `creditLimit`/`creditDays`/`creditLimitEnabled` — already enforced, zero
  change.
- **Procurement**: Purchase Orders/GRN — already vertical-agnostic, zero change.
- **Batch/lot tracking**: `INVENTORY_BATCH` capability already lists `DISTRIBUTION` in its
  `applicableBusinessTypes` (see `01-current-state-evidence.md` §3) — reuse as-is if the tenant
  needs it (a distributor reselling dated/lotted goods), gate it the identical way Grocery does,
  no new capability needed.
- **GST**: reuses the existing engine unchanged, per the source recommendation.
- **Multi-branch/warehouse**: already mature, zero change.

## 3. Chart of accounts — one small decision needed

`accounting-service/src/domain/default-accounts.ts` currently has exactly two account lists,
`DEFAULT_ACCOUNTS` and `GROCERY_DEFAULT_ACCOUNTS`, selected by a binary vertical check. A B2B
wholesale distributor's chart of accounts doesn't need anything Grocery-specific (no retail POS
cash-drawer accounts, no perishables write-off account) — **recommendation: reuse
`DEFAULT_ACCOUNTS` unchanged for `DISTRIBUTION`**, the same list `CLOTH_RETAIL` uses, since both
are non-perishable resale businesses from an accounting-structure point of view. This needs an
explicit widening of the vertical parameter's type and the `scheduler-internal.routes.ts` ternary
(see `01-current-state-evidence.md`'s table) to route `DISTRIBUTION` to `DEFAULT_ACCOUNTS`
rather than silently falling through to it via the ternary's own default branch (works today by
accident of the ternary's shape, but must be made an explicit case, not a fallthrough, so a
future fourth vertical doesn't silently inherit the same accident).
