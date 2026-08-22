# 04 — Database & API Impact

## Database

**One migration, data-only, no DDL** — matches the pattern every prior vertical-onboarding step
in this platform has used (Business Profile Foundation, capability backfills):

```sql
INSERT INTO business_types (code, industry_id, name, default_capability_keys, default_regulatory_pack)
SELECT 'DISTRIBUTION', id, 'Distribution / Wholesale', '["INVENTORY_BATCH"]'::jsonb, 'INDIA_GST'
FROM industries WHERE code = 'COMMERCE';
```

No column changes anywhere — `tenants.vertical` is already a plain `varchar(20)` with no CHECK
constraint (`01-current-state-evidence.md` §1), `price_lists`/`price_list_items`/
`customers.priceListId` already exist. Idempotent by construction (re-running the `INSERT ...
SELECT` a second time would need an `ON CONFLICT DO NOTHING` guard on `business_types.code` if
one doesn't already exist as a unique constraint — verify at implementation time).

## Backend code changes

| File                                                                                                                                                      | Change                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/tenant-service/src/rbac/vertical-defaults.ts`                                                                                                       | Add `'DISTRIBUTION'` to `TenantVertical`; add the `VERTICAL_DEFAULTS.DISTRIBUTION` entry (`03-capability-rbac-model.md` §3)              |
| `apps/tenant-service/src/api/tenant.schemas.ts`                                                                                                           | Widen the `vertical` Zod enum to include `'DISTRIBUTION'`                                                                                |
| `apps/accounting-service/src/domain/default-accounts.ts`                                                                                                  | Widen the vertical parameter type; explicit `DISTRIBUTION -> DEFAULT_ACCOUNTS` case, not a fallthrough default                           |
| `apps/accounting-service/src/api/scheduler-internal.routes.ts`                                                                                            | Replace the binary ternary with a real switch/lookup so a future 4th vertical can't silently reuse `CLOTH_RETAIL`'s COA by accident      |
| `packages/shared-types/src/capability-registry.ts`                                                                                                        | Add `'DISTRIBUTION'` to `HR_PAYROLL.applicableBusinessTypes` (per `03-capability-rbac-model.md` §1)                                      |
| `apps/sales-service/src/domain/QuotationService.ts`                                                                                                       | `unitPrice` becomes optional on `QuotationLineInput`; new `resolveLinePrice()` call for omitted lines (`02-domain-model-and-gaps.md` §1) |
| `apps/sales-service/src/domain/InvoiceService.ts`                                                                                                         | Same change to `InvoiceLineInput`, resolution called before the existing price-floor check                                               |
| New: `apps/sales-service/src/domain/PricingResolutionService.ts` (or a function in an existing shared module — naming `TO VERIFY` at implementation time) | The actual `resolveLinePrice(db, tenantId, itemId, customerId, quantity)` lookup                                                         |

`TenantProvisioner.ts` needs **no change** — already generic over whatever `business_types`
row/`VERTICAL_DEFAULTS` entry matches the resolved vertical.

## API contract changes

- `POST /quotations`, `POST /invoices` (and their line-item sub-resources): `unitPrice` on each
  line becomes optional in the request schema. Response shape is unchanged — the resolved price
  is always present in the persisted line, whether it came from the caller or the resolver.
- **New, small endpoint needed for the frontend to actually use this** (see below):
  `GET /pricing/resolve?itemId=&customerId=&quantity=` returning the resolved unit price, so the
  UI can show/apply it before the quotation/invoice is actually saved, not just discover it
  after the fact.

## The frontend gap this discovery pass found, not assumed

Checked both existing line-item entry forms directly: `QuotationFormPage.tsx:176` and
`InvoiceFormPage.tsx:311` both currently do `unitPrice: item.salePrice ? parseFloat(item.
salePrice) : 0` when a rep adds a line — **always pre-filling from the item's plain standard
price, with no price-list awareness, and always sending a non-empty `unitPrice`**.

This matters: if the backend-only change in `02-domain-model-and-gaps.md` ships without a
matching frontend change, the resolution logic will **never actually trigger through the existing
UI**, because the frontend always sends an explicit `unitPrice` today — the backward-compatible
"optional field, resolve only when omitted" design is safe, but silently non-functional for the
one thing this whole phase exists to deliver, unless the frontend is also updated to call the new
`GET /pricing/resolve` endpoint (or omit `unitPrice` and read back the resolved value from the
response) when a rep with a price-listed customer adds a line. **This frontend change is not
optional scope-creep — it's the actual feature**, and must be included in the rollout, not
treated as a follow-up.

## Explicitly not changed

`packages/db-client/src/schema/tenant.ts` (no DDL), `TenantProvisioner.ts`, GST engine, any
`purchase-service`/`inventory-service` route, POS routes, any RBAC permission constant.
