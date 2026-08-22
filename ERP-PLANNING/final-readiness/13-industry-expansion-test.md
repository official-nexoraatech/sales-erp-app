# 13 — Industry Expansion Test

Conceptual test: for Distribution, Manufacturing, Hotel, and Healthcare, assess reuse vs. net-new work, and whether the platform architecture remains intact (no fork required).

---

## Distribution — already shipped, used as the calibration case

- **Reused**: Customer, Item, Invoice, Payment, Branch/Warehouse, core sales/purchase/accounting services entirely unmodified.
- **New capabilities**: tiered/distributor pricing (`PricingResolutionService`), `DISTRIBUTION` vertical defaults, `INVENTORY_BATCH` capability reused (not duplicated) as a declared dependency.
- **Services changed**: none of the core services required modification; sales-service gained a new domain file.
- **New services**: none required.
- **DB changes**: one new `business_types` row (migration 0172) plus supporting tables for pricing tiers — additive, no shared-table schema changes.
- **Nav/RBAC**: new nav entries, no new permission-vocabulary mechanism needed.
- **Fork required?** **No** — confirmed, this vertical is live and built entirely through composition.
- **Caveat found by this audit**: `PricingResolutionService` lives only in `apps/sales-service/src/domain/`, not a shared package — reusable in principle, not yet positioned as a platform capability (`07-domain-reusability.md`).

## Manufacturing — already shipped, the platform's own best and worst proof case simultaneously

- **Reused**: Customer, Item, Warehouse, Purchase-to-GRN flow, `ValuationService`, the generic BOM/Routing/WorkCenter/MRP primitives are themselves reusable by _other future_ verticals (e.g. Bakery, Furniture) needing assembly/production logic.
- **New capabilities**: `BOM`, `WORK_CENTERS`, `PRODUCTION_ORDER`, `ROUTING`, `MRP` — 5 new capability-registry entries.
- **Services changed**: none of the core services (sales/inventory/purchase/accounting) required modification — all new logic lives in `production-service`.
- **New services**: none required — `production-service` already existed (for Job Work Orders) and was extended.
- **DB changes**: 5 new migrations (0174, 0175, 0179, 0180, 0181), additive tables, no shared-table schema mutation.
- **Nav/RBAC**: new nav entries; new permission constants, currently OWNER/ADMIN-only by explicit design ("no PRODUCTION_MANAGER role yet... pending product decision").
- **Reports/Events/AI Copilot**: no Manufacturing-specific reports, events, or AI-Copilot tools were found to exist yet — this is a genuine remaining gap, not evaluated as a blocker since the vertical itself is still in a controlled rollout state.
- **Fork required?** **No** — the architecture pattern is proven: BOM/Routing/WorkCenter/MRP are genuinely industry-agnostic primitives with zero hardcoded industry strings.
- **BUT**: this is also the vertical carrying **all 3 of this audit's confirmed blockers** — its capabilities are unenforced server-side (`05`), its entitlement can be silently reset by a billing change (`05`), and it cannot even be provisioned as a new tenant today (`06`). **The architecture pattern for adding an industry is proven correct; the operational discipline of finishing what the pattern requires (wiring the guard, seeding the row, testing the entitlement path) was not.** This is the single most important lesson this audit surfaces for planning a 5th industry: the mechanism works, but "mechanism exists" and "mechanism fully applied" must both be checked, every time, before calling a vertical done.

## Hotel — not yet built; worked example (see `06-industry-extensibility.md` for full detail)

- **Reusable**: Customer (guest), Invoice/Payment (folio-as-invoice), Branch (property), Price Lists (rate plans, if `PricingResolutionService` is promoted to shared).
- **New capabilities needed**: room inventory (as an extension table beside `items`, not a modification to it — following the `fabricRolls` precedent), booking/occupancy-calendar engine (genuinely new domain, no existing analog), folio-accrual timing logic.
- **Services changed**: none of the core services, following the Manufacturing/Distribution precedent.
- **New services**: plausibly a new `hotel-service`, or a capability within an existing service — either is architecturally consistent with what's already been built twice.
- **DB changes**: new `industries`/`business_types` row (correctly seeded this time, learning from the Manufacturing gap), new extension tables for rooms/bookings.
- **Nav changes**: new nav entries, no core navigation-mechanism change (`packages/ui` has zero hardcoded industry strings, confirmed).
- **RBAC permissions**: new constants, following the existing pattern (a code change, not configuration — `05`'s MEDIUM finding on vertical-mechanism genericity applies here).
- **Reports/Events/AI Copilot**: new report definitions + SQL cases (per `08`'s finding that reports are not pure-config); new event types are safe to add without destabilizing existing consumers (per `08`'s verified finding), but should get real consumer-side failure visibility and a considered wire-shape choice given the 2 live gaps found there; new AI Copilot tools are a mechanical addition to the existing hardcoded array (per `09`).
- **Fork required?** **No.**
- **Estimate: MEDIUM effort**, well-supported by the existing extension pattern.

## Healthcare — not yet built; worked example

- **Reusable**: `items` with `trackInventory=false` for consultations/procedures (schema field exists, not confirmed exercised), Invoice/Payment.
- **New capabilities needed**: patient medical-info extension table (same `fabricRolls`-style pattern), appointment/scheduling engine (same class of net-new work as Hotel's booking calendar).
- **The one materially different gap**: **regulatory/compliance infrastructure.** The entire codebase's compliance model is India-GST-specific (`defaultRegulatoryPack: 'INDIA_GST'`, hardcoded, never overridden). Healthcare needs patient-data-privacy controls (consent, access logging, data-retention rules) with **no existing scaffold anywhere in this codebase** — this is not a composition problem the way Hotel is; it is a genuinely absent capability domain that would need to be built from scratch, likely touching multiple services (audit logging, access control, possibly a new consent-management service).
- **Fork required?** **No** — the domain-modeling half of this vertical fits the existing extension pattern fine. The compliance half is new infrastructure, not a fork.
- **Estimate: HIGH effort**, specifically because of the compliance gap, not the domain modeling.

---

## Does the platform architecture remain intact across all four?

**Yes.** In every case — including the two already shipped — new industry work was additive: new tables, new services or new capabilities within existing services, new capability-registry entries, new nav entries, new permission constants. In no case did adding an industry require modifying a core service's existing logic, a shared table's existing columns (beyond the one narrow `isFabricItem`/`fabricWidth` exception, `07-domain-reusability.md`), or the platform's request-handling architecture (JWT auth, gateway routing, event dispatch, capability-guard mechanism). **No industry fork was found or would be required for any of the four.**

## The one honest caveat to "the architecture remains intact"

Architecture remaining intact is not the same claim as "every industry that used the architecture actually finished applying it correctly." Manufacturing proves both halves of that distinction in one vertical: the architecture held, and the application of it was incomplete. Any 5th industry (Hotel is the more natural next candidate per this audit's own effort estimate) should be preceded by fixing the 3 confirmed blockers first — not because the architecture needs to change, but because those are the exact 3 checks ("is the capability actually gated," "does billing respect vertical defaults," "is the tenant provisionable") that a 5th industry will re-expose if they remain unfixed.
