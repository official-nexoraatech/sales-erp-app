# 01 — Current-State Evidence

Every claim below is verified directly against the running dev database and current source —
none inferred from the planning docs' own prior snapshots, which this pass found were already
stale on the `INVENTORY_BATCH` registry's `applicableBusinessTypes` (see §4).

## 1. The complete, exhaustive list of `vertical`-keyed call sites

Grepped fresh across the whole codebase (`TenantVertical`, `vertical ===`, `vertical:` in non-test
files) — **7 files**, not the "4-5" some earlier planning notes estimated:

| File                                                               | What it does with `vertical`                                                                                                                             | Change needed for `DISTRIBUTION`                                                                                                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db-client/src/schema/tenant.ts:36`                       | `varchar('vertical', {length:20})` — no DB-level CHECK constraint, plain string column                                                                   | None (schema already accepts any ≤20-char string)                                                                                                                 |
| `apps/tenant-service/src/rbac/vertical-defaults.ts:1`              | `TenantVertical = 'CLOTH_RETAIL' \| 'GROCERY'` type + `VERTICAL_DEFAULTS` record (`excludeRoles`, `featureFlagOverrides`)                                | Add `'DISTRIBUTION'` to the union; add a `VERTICAL_DEFAULTS.DISTRIBUTION` entry                                                                                   |
| `apps/tenant-service/src/domain/TenantProvisioner.ts`              | Resolves `vertical` (default `CLOTH_RETAIL`), looks up matching `business_types.code` row, seeds roles/flags, calls accounting-service with `?vertical=` | No logic change — already generic over whatever `business_types` row matches; needs the new row to exist (§3)                                                     |
| `apps/tenant-service/src/api/tenant.schemas.ts:13`                 | `z.enum(['CLOTH_RETAIL', 'GROCERY']).optional().default('CLOTH_RETAIL')` — the Zod input boundary for tenant creation                                    | Add `'DISTRIBUTION'` to the enum                                                                                                                                  |
| `apps/tenant-service/src/api/tenant.routes.ts:154`                 | Passes `body.data.vertical` straight through to `TenantProvisioner`                                                                                      | None — already generic                                                                                                                                            |
| `apps/accounting-service/src/api/scheduler-internal.routes.ts:194` | `query.vertical === 'GROCERY' ? 'GROCERY' : 'CLOTH_RETAIL'` — a **binary ternary**, not a switch                                                         | Must become a real switch/lookup or it silently maps `DISTRIBUTION` to `CLOTH_RETAIL`'s chart of accounts                                                         |
| `apps/accounting-service/src/domain/default-accounts.ts:716-718`   | `vertical: 'CLOTH_RETAIL' \| 'GROCERY' = 'CLOTH_RETAIL'`, selects `GROCERY_DEFAULT_ACCOUNTS` or `DEFAULT_ACCOUNTS`                                       | Widen the type; decide whether Distribution needs its own COA list or reuses `DEFAULT_ACCOUNTS` (see `02-domain-model-and-gaps.md` §3 — evidence points to reuse) |

The scheduler-internal.routes.ts ternary is the one **silent-failure risk** in this list: unlike
every other site, it doesn't read from `business_types`/`VERTICAL_DEFAULTS` — it's a hardcoded
binary check that will quietly do the wrong thing for a third vertical unless explicitly updated.

## 2. Business Profile Foundation — current DB state

```
industries:      id=1, code='COMMERCE', name='Commerce & Retail'   (the only row)
business_types:   CLOTH_RETAIL / COMMERCE / default_capability_keys=[]
                  GROCERY      / COMMERCE / default_capability_keys=["INVENTORY_BATCH"]
```

Distribution is B2B/wholesale commerce — it fits under the existing `COMMERCE` industry, same as
the other two. **No new `industries` row needed**, only a new `business_types` row.
`default_capability_keys` is confirmed (per `phase-04-business-profile-foundation/
26-implementation-report.md §8`) to have zero real runtime consumer yet — it's descriptive
metadata only, so its exact value for the new row doesn't gate anything today, but should still
be set correctly (empty, unless §4 below changes).

## 3. Capability Registry — current state (verified directly, not from the planning docs' snapshot)

```ts
CAPABILITY_REGISTRY = {
  HR_PAYROLL:      { applicableBusinessTypes: ['CLOTH_RETAIL', 'GROCERY'], ... },
  POS:             { applicableBusinessTypes: ['CLOTH_RETAIL', 'GROCERY'], ... },
  INVENTORY_BATCH: { applicableBusinessTypes: ['GROCERY', 'DISTRIBUTION', 'MANUFACTURING'], ... },
}
```

**`INVENTORY_BATCH` already lists `DISTRIBUTION`** in `applicableBusinessTypes` — an earlier
planning pass already anticipated Distribution needing batch/lot tracking (plausible: a
distributor reselling packaged/dated goods cares about lot traceability same as Grocery does).
This is metadata only today (`applicableBusinessTypes` isn't read by `isCapabilityEnabled()` or
`requireCapability()` — confirmed by reading `packages/platform-sdk/src/capability-guard.ts` in
full; it's a documentation/UI-hint field, not an enforcement one), so it doesn't grant anything
automatically, but it's a signal worth deciding on explicitly rather than ignoring — see
`03-capability-rbac-model.md` §2.

`HR_PAYROLL`/`POS` do **not** list `DISTRIBUTION` — a decision this phase must make (does a
Distribution tenant run its own payroll and/or a retail counter? Almost certainly HR_PAYROLL yes,
POS probably not central to a pure B2B wholesaler, but not impossible if it also has a
cash-and-carry counter) — see `03-capability-rbac-model.md` §1.

## 4. Reusable commerce infrastructure — verified present and mature

- **`customers.customerType`**: `'RETAIL' | 'WHOLESALE' | 'B2B' | 'GOVERNMENT' | 'EXPORT'`
  (`master.ts:65`) — `WHOLESALE`/`B2B` already exist, unused by any vertical-specific logic today
  (a plain descriptive field), ready to be the primary type for a Distribution tenant's customers.
- **`customers.creditLimit` / `creditDays` / `creditLimitEnabled`** (`master.ts:97-99`) — already
  enforced today via the `CREDIT_LIMIT_OVERRIDE` permission guard on invoice creation (confirmed
  in `apps/sales-service/src/__tests__/permission-guards.test.ts`).
- **`customers.priceListId`** (`master.ts:104`) — an assignable FK, but see `00-vision-and-
business-requirements.md`'s central finding: nothing reads it automatically yet.
- **`price_lists` / `price_list_items`** (`items.ts:312-358`) — per-tenant price lists, each item
  can have multiple `minQty`-tiered rows with `discountPercent`. Currently consumed in exactly one
  runtime path (`pos.routes.ts`'s item-search, manual `priceListId` query param only).
- **`crm_accounts`** (now in `crm-service`, CRM-ROADMAP Phase 1 Feature 1) — already models the
  company/entity a B2B customer belongs to, with dedupe-candidate scoring and contact management.
  A Distribution tenant's dealer network maps directly onto this with zero changes.
- **Purchase Orders → GRN → GRN Lines** (`purchase.ts`) — mature, vertical-agnostic, already
  supports batch/expiry capture (`GRNService.ts`, per this session's `INVENTORY_BATCH` work) and
  unit conversion (`items.purchaseUnitId`/`purchaseUnitConversionFactor`, migration `0166`).
- **Multi-branch/warehouse, GST invoicing, credit-note/sale-return** — all vertical-agnostic,
  already exercised in production-shaped tests for both existing verticals.

## 5. RBAC — existing roles, no gap found

`apps/tenant-service/src/rbac/role-defaults.ts` defines 14 roles (`OWNER`, `ADMIN`,
`SALES_MANAGER`, `CASHIER`, `STORE_MANAGER`, `PURCHASE_MANAGER`, `ACCOUNTANT`,
`INVENTORY_MANAGER`, `HR_MANAGER`, `STAFF`, `ACCOUNTANT_SUPERVISOR`, `AUDITOR`, `DATA_OFFICER`,
`SUPER_ADMIN`), applied identically to every vertical today (`VERTICAL_DEFAULTS.excludeRoles` is
`[]` for both existing verticals — the mechanism exists but has never actually excluded anything).
`SALES_MANAGER` (quotations, invoices, customer/account management) and `PURCHASE_MANAGER`
(supplier/GRN) already cover what a wholesale distributor's staff need. No `Distributor`-specific
role surfaced as necessary — see `03-capability-rbac-model.md` for the explicit confirmation.
