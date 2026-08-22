# 23 — Executive Summary & Decision Record

Per the governing brief's FINAL OUTPUT and TENTH (Decision Record) sections. All claims cross-reference evidence in this folder — nothing here is asserted without a citation trail in `01-current-code-evidence.md`.

## 1. Recommended Phase 2

**Register and fully wire one new capability, `INVENTORY_BATCH` (batch/lot + expiry-aware FEFO stock tracking), end-to-end across `inventory-service`, `purchase-service`(unchanged, confirmed already-correct), and `sales-service`.** Not "launch Distribution." Not "launch Manufacturing." Not "wire HR_PAYROLL/POS" (Phase 1's own suggested starting point).

## 2. Why this is the best next step

1. **It is what the roadmap already calls Phase 2** (`00-roadmap-analysis.md`'s renumbering table: "wire `requireCapability` onto real routes... expand the registry one entry per PR"), scoped using evidence from this session's Distribution/Manufacturing evaluation rather than an arbitrary pick.
2. **It is real, not synthetic**: the underlying schema shipped 2026-08-16 (`0165_inventory_batch_expiry_fefo.sql`) but is currently **completely unreachable** — `items.fefoEnabled` has zero write path anywhere in the codebase, and FEFO consumption-ordering was never implemented (pure FIFO-by-receipt-date always, verified by direct code read of `ValuationService.consumeFifoLayers`). This phase doesn't gate an already-working feature behind a flag (a demo-flag anti-pattern the brief explicitly warns against) — it **completes** a half-built feature _as_ the act of gating it.
3. **It genuinely stress-tests the Phase 1 mechanism** in ways HR_PAYROLL/POS (both single-service, both route-level-only) do not: it spans three services with zero shared code path, and it is the first capability that needs to gate a conditional field _within_ an always-on Commerce Core route (not a whole route) — forcing the discovery and resolution of a real capability-granularity gap in Phase 1's design (`15-security-impact.md` §1).
4. **It serves the actual next-industry candidates without picking one**: Distribution and Manufacturing (this phase's own re-evaluation, §3 below) both need batch/lot tracking as a near-first-class requirement; Grocery (existing) benefits immediately; Bakery/Pharmacy (future candidates per `19-first-industry-recommendation.md`) need the identical primitive. One capability, useful to the present and every plausible near-term future, with zero industry-specific code anywhere in it.

## 3. Why the alternatives are not better now

- **Distribution as a full industry**: requires the Business Profile foundation (`industries`/`business_types` tables — confirmed not built, `01-current-code-evidence.md`) and the CRM/O2C split (confirmed still scaffolded-only, `apps/crm-service/src/main.ts` has zero registered routes) — neither exists. Building Distribution now would mean building both prerequisites _inside_ this phase, which is a different, much larger, differently-risked piece of work than what was asked ("do not create a new industry module yet").
- **Manufacturing as a full industry**: same prerequisite gap, plus a **corrected, larger** domain gap than previously estimated — `19-first-industry-recommendation.md`'s claim that `production-service` has "BOM/routing concepts partially present" is false (zero BOM/work-order/MRP code found, `01-current-code-evidence.md` §11). Manufacturing is now known to need more net-new domain modeling than Distribution, not less.
- **Hotel/Hospital**: unchanged from the prior analysis — least code reuse, highest domain/regulatory complexity of any candidate. Confirmed, not re-litigated; no new evidence surfaced that would change this ranking.
- **Wiring `HR_PAYROLL`/`POS` onto real routes instead**: lower risk, but weaker proof of the brief's requirement G ("used by a genuinely different business model") — both capabilities are already used identically by both existing verticals, so wiring them proves the mechanism works but not that it generalizes. Recommended as an easy, low-risk **parallel or immediately-following** step (§9 below), not the headline of this phase.
- **"Generalize an existing domain first" (the brief's third alternative)**: this phase _is_ that answer, precisely — `INVENTORY_BATCH` is Commerce Core generalization work (the source roadmap's own "Phase 7" scope, `16-phase-roadmap.md`), completed through the capability-registry lens rather than as a separate, disconnected effort. This phase does not pick between "generalize" and "prove the capability model" — it does both with one piece of work, because the evidence showed they're the same piece of work here.

## 4. Exact business capability being introduced

`INVENTORY_BATCH` — batch/lot number + expiry-date tracking on inventory items, with expiry-aware (FEFO) stock consumption ordering, gated per-tenant via a new `inventory.batch.enabled` feature flag and exposed through one new report route and one new nav-visible frontend surface.

## 5. Existing functionality being reused

The Phase 1 capability-resolution mechanism in full (`CAPABILITY_REGISTRY`, `requireCapability`, `isCapabilityEnabled`, the `CAPABILITY_NOT_ENABLED`/`FORBIDDEN`/`CAPABILITY_RESOLUTION_UNAVAILABLE` contract, the frontend `enabledCapabilities`/`capabilityKey` delivery path) — zero changes to any of it. The entire schema layer (`0165_inventory_batch_expiry_fefo.sql`'s columns and index). GRN batch/expiry capture (`GRNService.ts`, unmodified). Near-expiry alerting (`nearExpiryAlert.job.ts`, unmodified). Existing RBAC/permission/audit/observability infrastructure.

## 6. New functionality required

One registry entry, two permission constants, one migration (flag seed + role backfill), one conditional field on two existing routes, one new route, one FIFO-ordering conditional branch, one nav item, one frontend form section, one new report page. No new service, no new table.

## 7. Architecture being validated

`21-capability-resolution-architecture.md`'s central claims: capability enforcement is per-service (not gateway-only); a capability's implementation is not tied to a single service; the frontend delivery mechanism scales to new registry entries with zero mechanism change; the registry grows one entry per PR without touching `requireCapability`/`isCapabilityEnabled`. All directly exercised for the first time by this phase.

## 8. Risks

Full register: `22-risk-register.md`. Headline risk: repeating the `rbac_dead_permission_constant_pattern` (permission backfill must reach existing tenants, not just new-tenant provisioning code) — explicitly named and mitigated in this plan, not left implicit.

## 9. Non-goals (explicit, per the brief's SEVENTH section)

Does not build Distribution, Manufacturing, Hotel, or Hospital as an industry/business type. Does not touch `industries`/`business_types` (don't exist). Does not touch the CRM/O2C split. Does not wire `requireCapability` onto `HR_PAYROLL`/`POS` real routes (recommended as a separate, low-risk fast-follow using this phase's exact pattern, not bundled in to keep this phase to one capability). Does not build `MULTI_UOM` (the sibling capability with an identical dead-code shape — explicitly flagged as the natural next fast-follow after this phase and `HR_PAYROLL`/`POS`, not built here). Does not redesign any existing ERP module, rewrite the database architecture, touch RBAC's naming convention, touch billing, or touch the gateway.

## 10. Expected files/services affected

3 services (`inventory-service`, `sales-service`, `tenant-service`-for-role-defaults — `purchase-service` explicitly unaffected), 2 shared packages (`shared-types`, and indirectly `platform-sdk` via already-existing exports, no new file there), 1 frontend (`web-frontend`), 1 new migration. Full list: `21-file-level-change-plan.md`.

## 11. Estimated implementation complexity

**Small-to-medium**, comparable to Phase 1 in file count, smaller in conceptual novelty (reuses Phase 1's mechanism entirely) but with one genuinely new design problem to resolve carefully (the in-handler, sub-route capability check pattern, `15-security-impact.md` §1-§2) that Phase 1 never needed. Estimated at a similar single-session scope to Phase 1's own implementation session, given the schema is already complete and the mechanism is already built and tested.

## 12. Dependencies

None on the Business Profile foundation or the CRM/O2C split (confirmed independent, `00-overview.md` §2). Depends only on Phase 1 being merged (it is — `VERIFIED WITH FOLLOW-UP`) and, ideally, Phase 1's one open follow-up item (`capability-resolution.integration.test.ts` run against real infra) being closed first so this phase's own new integration tests aren't the first to hit that same untested path — not a hard blocker, but recommended sequencing.

## 13. Acceptance criteria

Full list: `20-acceptance-criteria.md`, mapped 1:1 to the brief's A–I requirements.

## 14. Recommended implementation sequence

Full detail: `21-file-level-change-plan.md`. Summary: registry+permissions (inert) → migration → item-route + valuation-ordering change → new report route → frontend → full regression. Each step independently verifiable before the next, matching CLAUDE.md's Goal-Driven Execution principle and Phase 1's own proven sequencing discipline.

---

## Addendum: what to tell the user if asked "so did we pick Distribution?"

No. This phase deliberately defers that decision. It builds the one piece of infrastructure Distribution, Manufacturing, and Grocery-today all need regardless of which industry ships next, using evidence (not a guess) about which capability is smallest, most reusable, and most load-bearing for the Phase 1 mechanism to prove itself against. The actual industry choice (`19-first-industry-recommendation.md`'s open question) remains open, and remains the user's call once the Business Profile foundation and CRM/O2C split are ready to support it.
