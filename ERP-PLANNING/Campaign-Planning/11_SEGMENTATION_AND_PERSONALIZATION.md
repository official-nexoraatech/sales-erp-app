# 11 — Customer Segmentation & Personalization Requirements

## Segmentation

### Keep (from current implementation)

- Computed-on-read `WHERE`-clause model (`customer_segments.filter_definition`: `{rules: [{field,
operator, value}], logic}`) — extend, don't replace.
- The 6 prebuilt system segments — keep as-is, they're useful defaults.
- Preview/count-before-save and CSV export patterns.

### Extend: Field Whitelist (`FIELD_COLUMNS` in `SegmentService.ts`)

Today (12 fields): `customerType, status, creditLimit, loyaltyPoints, openingBalance, healthSegment,
healthScore, createdAt, dateOfBirth, displayName, phone, email`.

Target additions, grouped:

| Category          | New fields                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purchase behavior | `lastPurchaseDate`, `orderCount`, `averageOrderValue`, `lifetimeValue`, `daysSinceLastPurchase`                                                                 |
| Preferences       | `preferredCategory`, `preferredBrand` (derived from invoice-line aggregation, refreshed periodically or computed live depending on performance testing in CP-3) |
| Loyalty/lifecycle | `loyaltyTier` (distinct from raw `loyaltyPoints`), `membershipStatus`, `membershipExpiryDate`                                                                   |
| Geography         | `city`, `state`, `pincode`                                                                                                                                      |
| Organizational    | `branchId` (store-specific), `assignedSalespersonId`                                                                                                            |
| Engagement        | `visitFrequency` (from `customer_interactions`), `isInactive` (derived), `lastCampaignEngagementDate`                                                           |
| Custom            | tenant-defined custom attributes (see Data Model doc for the extensible-attribute approach)                                                                     |

Each new field needs: (a) a safe SQL projection (possibly a subquery/aggregate, not a raw column — purchase
aggregates in particular), (b) appropriate operators, (c) an index if the aggregate proves too slow at scale
(`NFR-03`).

### Segment Builder UX

Multi-rule builder with visible AND/OR grouping (`MH-04`), matching what `filter_definition` already
supports — this is a **frontend-only gap today**, the backend model doesn't need to change shape, only the
whitelist needs to grow.

### Dynamic / Saved Segments

"Save this ad-hoc filter as a segment" from within the campaign builder (`SH-18`) — turns a one-off targeting
choice into a reusable asset without a separate trip to the Segments page.

## Personalization

### Keep

- `{{token}}` regex-based templating (`renderCampaignMessage`) — simple, works, no reason to replace with a
  heavier templating engine for this scale.
- Existing tokens: `customerName, balance, loyaltyPoints, shopName, customField`.

### Extend: Token Library

| New token                                                                | Source                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `{{lastPurchaseItem}}`, `{{lastPurchaseDate}}`, `{{lastPurchaseAmount}}` | Latest invoice for the customer                                                                                     |
| `{{recommendedProduct}}`                                                 | Simple rule-based suggestion (e.g. most-purchased category's top SKU) — explicitly **not** ML-based in this roadmap |
| `{{couponCode}}`                                                         | Linked coupon/offer record (see Media/Analytics docs for coupon-campaign linkage)                                   |
| `{{storeName}}`, `{{storeAddress}}`                                      | Customer's assigned branch                                                                                          |
| `{{salespersonName}}`                                                    | Customer's assigned salesperson                                                                                     |
| `{{membershipTier}}`, `{{membershipExpiryDate}}`                         | Membership/loyalty record                                                                                           |
| `{{customField:X}}`                                                      | Tenant-defined custom attribute, parameterized                                                                      |

### Fail-Safe Rendering (`FR-F2`)

- A missing value renders a **configured fallback** (default: empty string, but tenant/campaign can set a
  specific fallback per token, e.g. `"valued customer"` for a missing name).
- The preview step must enumerate which sampled/matched recipients would hit a fallback for any token used,
  so the author catches a bad segment/token combination before sending, not after.

### Conditional Content (`SH-03`)

Simple conditional blocks (e.g. "if `loyaltyTier == VIP` show this paragraph, else show that one") — a
lightweight extension of the token renderer, not a general templating language. Scope kept intentionally
small to avoid building an unnecessary DSL (per CLAUDE.md simplicity guidance).

## Industry-Agnostic Design Note

Clothing-specific attributes (size/color/fabric preference) are modeled as **tenant-defined custom
attributes** (see `17_DATA_MODEL_AND_API_DESIGN.md`), not as first-class schema fields — this is what lets a
Healthcare or Manufacturing tenant define their own relevant attributes without a schema change per
industry.
