# 03 — Capability & RBAC Model

Per CLAUDE.md §1 and this session's own established practice on the CRM/O2C split: decisions
requiring business judgment are recorded explicitly here, not silently resolved, even when a
recommendation is offered.

**Status: all three decisions below CONFIRMED by the user, 2026-08-20** — POS off by default,
tier `salePrice` authoritative (`discountPercent` does not stack), `INVENTORY_BATCH` on by
default. All three match this document's own recommendations. Preserved below in their original
form per this repo's convention of not rewriting decision history after the fact.

## 1. Does `DISTRIBUTION` need `POS` and/or `HR_PAYROLL`?

**CONFIRMED 2026-08-20: POS off by default** — "Wholesale is the default; retail counter is an
optional operating model." `HR_PAYROLL` added to `applicableBusinessTypes` as recommended below.

Neither capability currently lists `DISTRIBUTION` in `applicableBusinessTypes` (see
`01-current-state-evidence.md` §3) — a decision, not an oversight, since a pure B2B wholesaler's
core transaction is a Quotation/Invoice to a dealer, not a point-of-sale checkout.

**Recommendation**: add `DISTRIBUTION` to `HR_PAYROLL`'s `applicableBusinessTypes` (a distributor
still runs payroll for its own staff — no reason to exclude it), but **not** to `POS`'s. A pure
distributor has no retail counter; if a specific tenant also runs a cash-and-carry counter
alongside wholesale, that's the same "not every tenant of a vertical uses every capability"
situation the flag-based gating already handles — `pos.enabled` stays available to flip on
per-tenant regardless of what `applicableBusinessTypes` says (recall from `01-current-state-
evidence.md` §3: this field is metadata/documentation only, never read by the actual
`isCapabilityEnabled()`/`requireCapability()` enforcement path).

**Not decided here** — needs your confirmation: does a real Distribution tenant in this
business's target market ever run a retail counter alongside wholesale? If yes, the
`VERTICAL_DEFAULTS.DISTRIBUTION.featureFlagOverrides` entry below should still default
`pos.enabled: false` (opt-in only, per the recommendation above) even if `POS` capability is
later added to the registry's applicability list for documentation purposes.

## 2. `INVENTORY_BATCH`'s existing `DISTRIBUTION` entry — keep or reconsider?

**CONFIRMED 2026-08-20: keep it, default enabled** — "Strong fit for distributor traceability
and inventory operations."

Already lists `DISTRIBUTION` (planted by an earlier planning pass, per `01-current-state-
evidence.md` §3). **Recommendation: keep it, and default it enabled** —
`VERTICAL_DEFAULTS.DISTRIBUTION.featureFlagOverrides` should include
`{ key: 'inventory.batch.enabled', enabled: true }`. Rationale: a distributor reselling packaged
goods sourced from multiple manufacturers has a materially higher chance of caring about
lot/expiry traceability than a cloth retailer does (recalls, expiry-driven FEFO rotation across
a dealer network) — this matches Grocery's own default (`enabled: true`) for the same reason.
This is genuinely a product call, not a technical one — flagged, not silently defaulted.

## 3. `VERTICAL_DEFAULTS.DISTRIBUTION` — proposed entry

```ts
DISTRIBUTION: {
  excludeRoles: [],
  featureFlagOverrides: [
    { key: 'pos.enabled', enabled: false },
    { key: 'hr.payroll.enabled', enabled: true },
    { key: 'inventory.batch.enabled', enabled: true },
  ],
},
```

Matches the shape of the existing two entries exactly — no new mechanism, just a new record
value. `excludeRoles: []` because §4 below finds no role needs excluding.

## 4. RBAC — confirmed, no new role needed

Per `01-current-state-evidence.md` §5: `SALES_MANAGER` (customer/account/quotation/invoice
management) and `PURCHASE_MANAGER` (supplier/GRN) already cover a wholesale distributor's two
core staff functions. `ACCOUNTANT`/`INVENTORY_MANAGER`/`HR_MANAGER` need no changes either — none
of their permission sets are retail-POS-specific in a way that would need trimming for a
Distribution tenant that has `pos.enabled: false`.

**No new permission constants needed** — `price_list`-related permissions, if the frontend needs
a dedicated "manage price lists" screen, likely already exist or fit under existing
`ITEM_EDIT`/`ITEM_CREATE`-adjacent permissions (price lists are configured per-item); verify the
exact permission name at implementation time rather than assuming here (`TO VERIFY`).

## 5. New `business_types` row

```sql
INSERT INTO business_types (code, industry_id, name, default_capability_keys, default_regulatory_pack)
VALUES ('DISTRIBUTION', <COMMERCE industry id>, 'Distribution / Wholesale', '["INVENTORY_BATCH"]', 'INDIA_GST');
```

`default_regulatory_pack` reuses `'INDIA_GST'` — no new regulatory pack needed, per
`00-vision-and-business-requirements.md`'s explicit scope boundary (reuses GST as-is).
