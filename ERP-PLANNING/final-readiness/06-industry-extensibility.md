# 06 — Industry Extensibility Audit (Business Profile / Industry Model)

## Business classification schema — thin, not a rich business-profile model

`packages/db-client/src/schema/tenant.ts`: `tenants.vertical` (line 36-39, `varchar(20)`, authoritative per ADR-01) plus `tenants.businessTypeId` (line 49, nullable FK, migration 0170, set once at creation, not kept in ongoing sync despite a code comment overclaiming this — confirmed via the plan-vs-implementation cross-check). `industries` (id/code/name, one row seeded — `COMMERCE` — until Manufacturing's migration added a second) and `business_types` (id/code/industryId/name/`defaultCapabilityKeys` — **display-only metadata, not consulted at provisioning time**/`defaultRegulatoryPack`, hardcoded `'INDIA_GST'` and never overridden anywhere).

**Verdict: enum column(s) plus one thin reference table**, not a rich configurable business-profile model. This is adequate for what has been built (4 verticals, all India-only) but is the ceiling the platform is currently operating at.

## BLOCKER — Manufacturing cannot be provisioned as a new tenant

Grepped every migration for `MANUFACTURING`: only the 5 manufacturing _feature_ migrations match (BOM, work centers, production orders, routing, MRP). **No migration inserts a `business_types` row with `code='MANUFACTURING'`.** `apps/tenant-service/src/domain/TenantProvisioner.ts:92-97` runs an unconditional lookup before creating any tenant and throws `Error: No business_types row found for vertical: MANUFACTURING` when it's missing. `vertical-defaults.ts` has a complete, well-commented `MANUFACTURING` entry — the provisioning _template_ is done, but the `business_types` _seed row_ it depends on is not. The one test that would catch this (`business-type-capability-consistency.test.ts:58`, `it.each([...,'MANUFACTURING'])`) is gated behind `describe.skipIf(!DB_URL)` and very plausibly never ran against a live database.

Any live Manufacturing tenant in a dev database today must have been created by a means that bypasses `TenantProvisioner.provision()`. **Fix is a one-line data migration** mirroring migration 0172's pattern for Distribution — trivial, but currently absent. See `00-executive-verdict.md` and `14-risk-and-blockers.md`.

## How vertical/businessType actually drives runtime behavior

Two patterns coexist:

- **(a) Generic capability-lookup (dominant, intended pattern).** `CAPABILITY_REGISTRY` maps a capability key to a feature flag; `VERTICAL_DEFAULTS` is a lookup table consulted once, at provisioning time, not branching logic in the request path. Business logic reads the resolved flag, never the vertical string. Confirmed as the pattern used by all 5 Manufacturing capabilities.
- **(b) Hardcoded if/else per named vertical (the one exception).** `apps/accounting-service/src/domain/default-accounts.ts:724`: `vertical === 'GROCERY' ? GROCERY_DEFAULT_ACCOUNTS : DEFAULT_ACCOUNTS`. DISTRIBUTION and MANUFACTURING both fall into the `else` (Cloth's) branch by design — functionally reasonable today (a chart of accounts doesn't need to differ across resale-type verticals), but it is the one clear "if/else hardcoded per named industry" instance in the codebase, and it will need a real per-business-type lookup once Hotel/Healthcare need genuinely different default ledgers (Room Revenue, Patient Receivables). Rated **LOW**.

No other hardcoded `vertical === '<NAME>'` runtime branch was found in any service sampled.

## Worked example: adding Hotel (room booking, occupancy, folio billing)

**Reusable as-is:** Customer (a guest is a customer), Invoice/Payment (a folio is structurally an invoice accumulating line items, closed at checkout — the GST invoice model has no room-specific columns to fight around), Branch (maps to property/location), Price Lists (season/corporate rate plans could reuse the tiered-pricing mechanism `PricingResolutionService` already implements for Distribution, if promoted to a shared package).

**Needs net-new**, following the precedent Manufacturing established (new tables + new capability-registry entries + possibly a new `hotel-service`, not a rewrite of core): a room is a poor fit for `items` (which carries stock-valuation columns — `availableQty`, `waccCost` — meaningless for a room that is occupied, not consumed/costed); the correct pattern is a parallel `rooms` table analogous to `fabricRolls` sitting beside `items`. A booking/occupancy-calendar engine (date-range availability, double-booking prevention) has no existing analog anywhere in the codebase — genuinely new domain modeling. Folio timing (charges accruing across a multi-day stay before becoming a final invoice at checkout) also needs new modeling, though final invoice emission can reuse `InvoiceService`.

**Estimate: MEDIUM effort, no core-service rewrite required.** This vertical fits the platform's existing extension model well — the same shape of work as Manufacturing (new tables, new capability-registry entries, core services untouched).

## Worked example: adding Healthcare (patient records, appointments, billing)

**Reusable as-is:** `items` with `trackInventory=false` (the field exists today, supporting non-stock "service" items) for consultations/procedures, reusing GST-rated billing — though India uses SAC codes for medical services, not the HSN codes `items.hsnCode` is built around, a real if minor schema mismatch. Invoice/Payment reuse the same model as Hotel folios. Customer could represent a patient for billing purposes, but real patient records (medical history, allergies, consent, vitals) need a `patient_medical_info` extension table keyed on `customerId` — the same pattern `fabricRolls` already validates.

**Needs net-new:** Appointments/scheduling — structurally identical problem to Hotel's booking calendar, no existing analog. **The regulatory/compliance layer is the real gap**: the entire codebase's compliance model is India-GST-specific (`defaultRegulatoryPack: 'INDIA_GST'`, hardcoded default, never overridden by any seeded business type). Healthcare needs patient-data-privacy controls (consent, access logging, data-retention rules) that have **no existing primitive anywhere in this codebase** to extend from — this is not a composition problem the way Hotel is; it is a genuinely absent capability domain.

**Estimate: HIGH effort, not medium** — not because the domain modeling is harder than Hotel's, but because the compliance/consent infrastructure gap is materially larger and has no scaffold to build on. Healthcare is not a "compose on primitives" vertical the way Hotel, Distribution, or Manufacturing were.

## Data-model extensibility

**Clean extension-table pattern is the norm**: `fabricRolls`/`fabricCuts` (own tables, feature-flagged), Tailor Work Log (own table, feature-flagged), `pricingPromotions` (own table for a Grocery-motivated capability). `invoices` itself (read in full) has **zero** cloth-specific columns — every field is universal or its own clearly-scoped feature.

**One bolted-on-column exception found**: `packages/db-client/src/schema/items.ts:214-215` — `isFabricItem`/`fabricWidth` sit directly on the shared, generic `items` table rather than in an extension table, unlike `fabricRolls` one migration domain over. For every non-Cloth tenant, these are permanently `false`/`NULL` — negligible cost today (2 narrow columns), but proof the extension-table discipline is a convention, not an enforced architecture. Rated **LOW**.

**Latent constraint**: `items.hsnCode` is `NOT NULL` — an India-GST-specific required field on every item. Not a blocker for the 4 shipped (all India-only) verticals, but relevant if the platform ever expands beyond India, or when Healthcare's SAC-code mismatch (above) needs resolving. Rated **DOC-ONLY** for current scope.

## Answering the required question directly

**"What happens when we add Hotel?"** — a new capability/service composed on Customer/Invoice/Payment/Branch, following the Manufacturing precedent exactly. No core-service changes required. Medium effort.

**"What happens when we add Manufacturing?"** — already answered by the platform's own history: it was added as new tables (BOM/Work Centers/Production Orders/Routing/MRP), new capability-registry entries, and a new `business_types` row (mostly — see the BLOCKER above), with zero changes to sales/inventory/purchase/accounting core services. The domain logic itself is genuinely generic (`BOMService.ts`, `RoutingService.ts`, `WorkCenterService.ts` — zero industry-named branches found in any of them). **The architecture pattern this question asks about is proven, live, and correct** — it is only the _entitlement enforcement_ around it (05) and the _provisioning seed data_ (this document) that are incomplete.
