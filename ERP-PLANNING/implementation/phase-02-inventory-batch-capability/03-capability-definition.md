# 03 — Capability Definition

## 1. Classification (per the brief's CORE / REUSABLE DOMAIN / INDUSTRY CAPABILITY / INDUSTRY-SPECIFIC framework)

| Element                                                                      | Classification                                 | Why                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item-level `fefoEnabled` toggle + FEFO consumption ordering                  | **INDUSTRY CAPABILITY**                        | Genuinely optional — most Cloth Retail tenants will never enable it; Grocery/Distribution/Manufacturing/Bakery tenants will                                                                                                                                                     |
| GRN batch/expiry capture (`GRNService.ts`)                                   | **REUSABLE DOMAIN**, already always-on         | Capturing batch/expiry metadata when a supplier provides it is harmless and useful regardless of whether the item is FEFO-tracked (e.g. for audit/traceability even without ordering logic) — stays unconditional, not capability-gated (see `05-service-impact.md` §2 for why) |
| `inventory_fifo_layers`, FIFO/WACC valuation itself                          | **CORE**                                       | Every tenant needs stock valuation; this capability only adds an optional ordering refinement on top, never replaces it                                                                                                                                                         |
| Near-expiry alerting mechanism (Kafka/notification plumbing)                 | **CORE**                                       | The scheduler/notification infrastructure it rides on is generic, reused unchanged                                                                                                                                                                                              |
| A future Hotel "room inventory" or Manufacturing "BOM component lot" concept | **INDUSTRY-SPECIFIC** (future, not this phase) | Would consume this capability's data model but adds its own domain logic — explicitly out of scope                                                                                                                                                                              |

## 2. Registry entry

```ts
// packages/shared-types/src/capability-registry.ts — ADD to existing CAPABILITY_REGISTRY

INVENTORY_BATCH: {
  key: 'INVENTORY_BATCH',
  name: 'Batch & Expiry Tracking',
  domain: 'Inventory',
  owningService: 'inventory-service',   // primary owner of the *configuration* (item toggle);
                                          // enforcement also lives in purchase-service and
                                          // sales-service — see 21-capability-resolution-architecture.md
                                          // §1's explicit "don't infer one service" rule
  flagKey: 'inventory.batch.enabled',
  requires: [],                          // deliberately no dependency on a hypothetical
                                          // 'INVENTORY' capability — inventory itself is Commerce
                                          // Core / always-on, never gated (03-target-architecture.md §7,
                                          // 16-phase-roadmap.md Phase 4's explicit Commerce-Core-stays-
                                          // ungated scope note) — there is nothing to require
  status: 'BETA',
  applicableBusinessTypes: ['GROCERY', 'DISTRIBUTION', 'MANUFACTURING'],
                                          // documentation only, per 21-capability-resolution-architecture.md
                                          // §4 — not an enforcement input. DISTRIBUTION/MANUFACTURING
                                          // don't exist as business_types yet; listed for forward
                                          // reference, matches how HR_PAYROLL/POS already list both
                                          // existing verticals even though nothing enforces the list
  permissions: ['BATCH_VIEW', 'BATCH_CONFIGURE'],
},
```

### Deviation from `21-capability-resolution-architecture.md` §4's own worked example

That document's illustrative registry entry for `INVENTORY_BATCH` lists `permissions: ['BATCH_VIEW', 'BATCH_CREATE', 'BATCH_ADJUST']`. This phase uses `['BATCH_VIEW', 'BATCH_CONFIGURE']` instead — `BATCH_CREATE`/`BATCH_ADJUST` implied a standalone batch-adjustment workflow that isn't in this phase's scope (batches are created implicitly by GRN receipt, not by a direct user action; adjusting a batch's remaining quantity already goes through the existing, unrelated `adjustment.routes.ts` stock-adjustment flow). This is the same kind of "correct the plan's placeholder against real scope" deviation Phase 1 documented in its own `20-implementation-report.md` §16 deviation 5 for the `POS` entry — flagged here for the same reason, not silently changed.

## 3. Naming convention compliance (per `21-capability-resolution-architecture.md` §4)

- Capability key: `INVENTORY_BATCH` — `SCREAMING_SNAKE_CASE`, noun phrase, no verb. ✓
- Flag key: `inventory.batch.enabled` — dotted-lowercase, `domain.capability.enabled` shape, matches existing convention (`hr.payroll.enabled`, `pos.enabled`). ✓
- Registered in the same change that first makes it gateable (this phase), not speculatively ahead of the code. ✓

## 4. Why this is a capability and not a plain feature flag with no registry entry

Per `05-module-capability-model.md` §2 and `21-capability-resolution-architecture.md` §1: any tenant-facing, gateable unit of product functionality that a plan/business-type should be able to turn on or off is a capability by definition — the registry is what makes it discoverable, documented, and enforced consistently (via `requireCapability`/`isCapabilityEnabled`) rather than an ad hoc `if (flags.isEnabled(...))` check scattered through route handlers with no central record of what it gates or what depends on it.
