# 41 — Phase 2B Closure Review (Final)

**UPDATE 2026-08-20 (post-Distribution-Phase-B session): F2 gap closed.** The two recommended
test files (§5) were written and pass against a real Postgres instance:
`apps/purchase-service/src/__tests__/purchase-return-fefo.integration.test.ts` and
`apps/production-service/src/__tests__/job-work-material-issue-fefo.integration.test.ts`, both
following this review's own template (two layers per item, differing expiry, plus a
`fefoEnabled: false` regression case). Full `@erp/purchase-service` (76/76) and
`@erp/production-service` (16/16) suites re-run clean afterward — zero regressions. This was the
one still-open, non-blocking item from §12; everything else in that list remains as this review
left it (git-hygiene/commit-splitting still not done, roadmap-numbering drift in §14 still
unreconciled — see the separate `roadmap_status_and_uncommitted_backlog_2026_08_20` memory).

**Session type: independent closure gate, third pass.** `39-implementation-report.md` (the build) and `40-post-implementation-review.md` (the first independent gate) were both treated as claims to spot-verify, not as evidence in themselves. Where this review re-ran something `40` already ran, the result is reported as _my own_ re-run, not copied. Where this review found something `40` did not check (criterion J, the exact F2 code-path evidence, the roadmap-numbering drift), it is marked as new. No application source, migration, test, or configuration file was changed to produce this document — see §15.

---

## 1. Executive Verdict

**B. CLOSED WITH FOLLOW-UPS**, for Phase 2B itself.

**Phase 10 (first industry) is NOT ready to begin next**, regardless of Phase 2B's closure — this is a roadmap finding, not a Phase 2B defect, and is the most important corrective finding in this review (§14).

Every claim in `40` that I independently re-tested held up: capability registry, RBAC backfill, migration idempotency, tenant isolation, false→true gating, frontend UX-only enforcement, and the "no expiry blocking / no industry coupling" claims are all re-confirmed against live code and a live Postgres/Redis stack, not re-read from the prior report. One acceptance criterion (`J`, financial-neutrality-language correction) that `40` explicitly left "NOT INDEPENDENTLY VERIFIED" is resolved here as **PASS** (§4). The F2 test-coverage gap is confirmed genuinely missing, not defensible as "already covered" (§5) — but it is bounded and low-risk enough not to block closure, matching this review's own preferred standard. The single new, material finding this pass adds is that the roadmap-tracking scheme itself has drifted from what was actually built (§14) — this needs the user's attention before any "what's next" decision, independent of Phase 2B's own status.

---

## 2. Current Implementation State (independently re-derived)

Read in full: `README.md`, `23`–`40` (revised plan set), `31-revised-acceptance-criteria.md`, `26-decision-record.md`, `27-affected-flow-matrix.md`, `28-financial-impact-analysis.md`, `29-expiry-policy-analysis.md`, `07-api-contracts.md` (original plan, cross-referenced per criterion J).

Phase 2A (sales-service valuation-engine consolidation, D1 option B) and Phase 2B (`INVENTORY_BATCH` capability) both exist in the working tree exactly as `39`/`40` describe:

- `packages/shared-types/src/capability-registry.ts` — 3 entries: `HR_PAYROLL`, `POS` (Phase 1), `INVENTORY_BATCH` (new). Verified by direct read this session.
- `apps/sales-service/src/domain/ValuationService.ts` — confirmed deleted; `InvoiceService.ts`/`SaleReturnService.ts` import `ValuationService` from `@erp/sdk`.
- `packages/db-client/migrations/0169_inventory_batch_capability.sql` — data-only, 3 statements, no DDL. Read in full this session (§7).
- `apps/inventory-service/src/api/{item.routes.ts,stock.routes.ts}` — the only two backend boundaries with a new capability/permission check. Confirmed by grep: `requireCapability(` has exactly one call site in the entire `apps/` tree (`stock.routes.ts:292`); `item.routes.ts` has the in-handler equivalent (`assertBatchConfigureAllowed`).
- `apps/web-frontend/src/lib/navigation.ts` — `INVENTORY_BATCH` is the only nav item with a `capabilityKey` (`navigation.ts:395`). Confirmed by grep — `HR_PAYROLL`/`POS` never appear in `navigation.ts` at all.

---

## 3. Git / Worktree State

Reproduced this session:

```
Branch: suresh-v3
26 modified files, ~17 new/untracked files+dirs, working tree entirely uncommitted
```

Same three-initiative commingling `40`§3 found (Phase 1 / Phase 2A / Phase 2B all stacked in one uncommitted diff), unchanged since that review — no new commits landed between `40` and this session (`git log` head is still `cc9627f`, the CRM/O2C scaffold commit, which predates all of Phase 1/2A/2B). No unexpected Phase 2C source change, no unexpected industry-specific code, no file outside the three known buckets. `git status --porcelain -- apps/purchase-service apps/production-service` → empty, re-confirmed — Phase 2B touched neither service; the F2 gap flows in those services are pre-existing, unmodified call sites, not new code this phase added and then under-tested.

**Not commented on further** — this is the same pre-existing git-hygiene item `38`§13 and `40`§24 already flagged, not something this review needed to re-litigate.

---

## 4. Acceptance Criteria Matrix (`31-revised-acceptance-criteria.md`)

### Phase 2A

| #            | Criterion                                                                                                  | Status   | Evidence                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 2A-1 to 2A-5 | Engine consolidation, equivalence, FEFO-through-real-call-path, restock traceability, zero behavior change | **PASS** | Re-ran `valuation-fefo.test.ts` + `sale-return-batch-traceability.test.ts` myself against real Postgres this session: 3/3 pass |
| 2A-6         | Zero remaining local `ValuationService.js` imports                                                         | **PASS** | Confirmed deleted; grep re-run, zero matches                                                                                   |

### Phase 2B

| #                                                                   | Criterion                                                  | Status                                                                                                                                                                                                                                                                                                                | Evidence |
| ------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A — capability can be defined                                       | **PASS**                                                   | §2; registry read directly                                                                                                                                                                                                                                                                                            |
| B — tenant can have it enabled                                      | **PASS**                                                   | §7 — global flag row confirmed via direct SQL this session                                                                                                                                                                                                                                                            |
| C — user can have the permission                                    | **PASS**                                                   | §7 — `role_permissions` rows confirmed via direct SQL this session (own join query, not copied)                                                                                                                                                                                                                       |
| D — backend enforcement works                                       | **PASS**                                                   | §2, §8 — single `requireCapability` call site + in-handler item-route gate, confirmed by grep and by re-running `item-batch-capability.test.ts`/`near-expiry-stock-route.test.ts` (within the inventory-service suite run, §6)                                                                                        |
| E — frontend nav responds to capability state                       | **PASS**                                                   | Re-ran `navigation.test.ts`: 125/125 pass, this session                                                                                                                                                                                                                                                               |
| F — existing tenants unaffected                                     | **PASS**                                                   | §6 — full regression re-run across inventory/purchase/production/sales/auth/web-frontend this session                                                                                                                                                                                                                 |
| **F2 — all nine flows have explicit FEFO + regression coverage**    | **PARTIAL**                                                | §5 — Purchase Return and Job-Work Material Issue confirmed genuinely untested for FEFO, independently, by reading both test files in full (not just grepping for absence)                                                                                                                                             |
| G — reusable for a different business model                         | **PASS**                                                   | §9 — no vertical-specific code in any Phase 2B file                                                                                                                                                                                                                                                                   |
| H — no industry fork required                                       | **PASS**                                                   | §9                                                                                                                                                                                                                                                                                                                    |
| I — registry grows 2→3                                              | **PASS**                                                   | §2                                                                                                                                                                                                                                                                                                                    |
| **J — financial-neutrality claim corrected, not silently asserted** | **PASS** (resolved this session — `40` left it unverified) | §4a below                                                                                                                                                                                                                                                                                                             |
| K — expired-stock scope boundary disclosed in UI                    | **PASS**                                                   | §8 — grep confirms `isExpired` in `stock.routes.ts:371` is read-only (feeds a response field), never a conditional that blocks anything; `ItemFormPage.tsx`/`NearExpiryStockPage.tsx` disclosure copy re-confirmed present (not re-quoted here, already read verbatim in `40`§14 and spot-checked again this session) |

### §4a — Criterion J, resolved

`40` flagged this "NOT INDEPENDENTLY VERIFIED" because it did not read `07-api-contracts.md §4` in that session. I read it this session. It still contains the original, uncorrected sentence:

> _"`consumeFifoLayers`'s ordering change is entirely internal to `ValuationService`, invisible at any API boundary (same total quantity consumed, same COGS calculation, only which layer rows are decremented first changes for `fefoEnabled` items)."_

This is the exact false claim `28-financial-impact-analysis.md` was written to correct — that document's own opening line states: _"Corrects `07-api-contracts.md` §4's claim that reordering is 'financially neutral... same COGS calculation, only which layer rows are decremented first changes.' That claim is false whenever consumed layers carry different unit costs — the normal case, not an edge case."_

Criterion J's literal text accepts **either** editing `07-api-contracts.md` **or** having the document set explicitly supersede it — "both acceptable; silence is not." `28` does not silently sit next to the wrong claim; its first sentence names the document, quotes the false claim, and states it is false and why. That is an explicit correction-by-superseding, not silence. On the criterion as literally written, this is **PASS**. It is a documentation-only resolution, not a code change — `07-api-contracts.md §4`'s prose itself remains uncorrected in place, which is a real (if cosmetic) inconsistency worth fixing opportunistically, but it does not fail the acceptance criterion as worded.

---

## 5. F2 Test-Gap Analysis (Step 4 — investigated fresh, not re-quoted from `40`)

### Affected code paths (confirmed by direct read this session)

| Flow                    | File : line                                                                                 | Call                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Purchase Return         | `apps/purchase-service/src/domain/PurchaseReturnService.ts:228` (inside `approve()`)        | `ValuationService.consumeForStockOut(trx, { tenantId, itemId, variantId, warehouseId, quantity })` |
| Job-Work Material Issue | `apps/production-service/src/domain/JobWorkOrderService.ts:200` (inside `issueMaterials()`) | `ValuationService.consumeForStockOut(trx, { tenantId, itemId, variantId, warehouseId, quantity })` |

Both import `ValuationService` from `@erp/sdk` (`PurchaseReturnService.ts:20`, `JobWorkOrderService.ts:15`) — confirmed by direct grep, not inferred. The parameter shape is **identical**, field-for-field, to the shape used by `inventory-service`'s `InventoryLedgerService.deductStock`, which **is** covered by `fefo-consumption-flows.integration.test.ts`. There is no flow-specific pre-processing between either call site and the shared engine — both simply decrement `items.availableQty` (with an optimistic-lock `WHERE availableQty >= qty` guard), call the shared function, and write an `inventory_ledger` row. This independently confirms the "code-identity" argument `39`/`40` made — it is not merely plausible, it is what the code literally shows.

### Existing test coverage — read in full this session, not just grepped

- **`apps/purchase-service/src/__tests__/purchase-return-ledger.test.ts`** (287 lines, read in full): exercises `PurchaseReturnService.approve()`/`.create()` against a fully mocked, scripted `trx` object. The mock script never seeds more than one candidate layer, never sets `batchNumber`/`expiryDate` on anything, and asserts only `debitNoteId`, GST split (CGST/SGST/IGST), and return-quantity-validation behavior. **Zero assertion anywhere in this file touches layer-selection order.** Because the mock is a scripted call-sequence stub (not a real query engine), it could not distinguish FEFO from FIFO consumption even if it wanted to — the test never lets `ValuationService.consumeForStockOut` actually run against real data.
- **`apps/production-service/src/__tests__/job-work-order-valuation.integration.test.ts`** (236 lines, read in full): runs against a **real** Postgres instance (`describe.skipIf(!DB_URL)`), and correctly proves `issueMaterials()`/`complete()` route through `ValuationService` with real ledger before/after values. But it seeds exactly one item with a single `waccCost`/`currentStockValue` pair and **no `inventory_fifo_layers` rows at all** — the test's items are WACC-costed, single-cost-pool items, not FIFO/FEFO items with multiple layers. There is no scenario in this file with two layers of differing `expiryDate`, so FEFO-vs-FIFO ordering is structurally untestable by this file as currently written, even though it is a real-DB test.

**Conclusion: option B applies — dedicated tests are genuinely missing**, not merely absent-but-covered-elsewhere. Neither existing file could catch a regression that broke FEFO ordering specifically at these two call sites (e.g., a future refactor that added flow-specific filtering before the shared call, or an accidental hardcoded `orderBy(receivedAt)` override).

### What is currently untested, precisely

1. That `PurchaseReturnService.approve()` consumes the earliest-expiring layer first when the returned item has `fefoEnabled: true` and multiple layers with differing `expiryDate`.
2. That `PurchaseReturnService.approve()` remains byte-identical to today's FIFO-by-`receivedAt` behavior when `fefoEnabled: false` (regression proof).
3. The equivalent pair of assertions for `JobWorkOrderService.issueMaterials()`.

### Recommended test cases (not written — authorization required per the governing brief)

Both would follow the exact template `fefo-consumption-flows.integration.test.ts` already establishes (real Postgres, `describe.skipIf(!DB_URL)`, two layers per item — one received-first/expires-later, one received-second/expires-sooner — assert the sooner-expiring layer's `remainingQty` drops first):

- `apps/purchase-service/src/__tests__/purchase-return-fefo.integration.test.ts` (new file, ~80-100 lines by the existing template's shape): seed a GRN'd item with two FIFO layers of differing cost/expiry, approve a `PurchaseReturnService` return for a quantity that only partially drains the preferred layer, assert layer selection order + a `fefoEnabled:false` regression case in the same file.
- `apps/production-service/src/__tests__/job-work-material-issue-fefo.integration.test.ts` (new file, similar shape): seed a raw-material item with two layers, call `issueMaterials()`, assert the same ordering + regression pair.

### Is adding these necessary for Phase 2B closure?

**No, not as a blocking condition — but recommended as a near-term follow-up, not an indefinitely-deferred one.** Reasoning, applying the brief's own stated standard:

- The missing coverage is for **stock-out consumption ordering only**, at two call sites that are structurally, verifiably identical (not merely "probably similar") to an already-tested entrypoint. This is different in kind from, say, an untested new authorization branch or an untested new financial calculation — the mechanism being left unverified is the exact mechanism three other consumers (`inventory-service`, `sales-service`, and `fefo-consumption-flows.integration.test.ts` itself) already prove correct at the shared-engine layer.
- The blast radius of a hypothetical regression is bounded: it would only matter for the small subset of tenants that (a) have `fefoEnabled: true` on an item, **and** (b) return that item to a supplier or consume it as job-work raw material, **and** (c) have multiple open FIFO layers with different costs/expiries for that item at the time. Given no tenant can reach `fefoEnabled: true` until this same phase ships the write path, this is a zero-current-exposure gap, not a live one.
- It is self-disclosed, bounded, and independently reproducible by a future session using the exact template that already exists — this is materially different from a silently-hidden gap.

This satisfies the "test-coverage/documentation gap only" branch of the closure standard given for this review, not the "materially risky financial/inventory behavior... cannot be reasonably considered covered" branch — the financial _mechanism_ is covered (at the shared-engine and at three of five call sites using it identically); only two structurally-identical call sites lack their own dedicated proof.

**Estimated scope/risk of writing the two tests**: Low. Both follow an existing, proven template exactly; no production code change is implied (this is pure test-coverage closure, not a bug fix); estimated at under half a day of focused work for both files including review. **STOPPING HERE per the governing brief — awaiting explicit authorization before writing test code**, even though the scope is small.

---

## 6. Test Execution Results (all run by me, this session, against the live dev stack)

Dev infra confirmed running before any test: `erp-postgres-primary` (`0.0.0.0:5435`), `erp-redis-1` (`0.0.0.0:6379`), via `docker ps`. `DATABASE_URL=postgresql://erp:erp_password@127.0.0.1:5435/erp` (the actual credential set found in `.env`, not assumed).

| Suite                                                                                                                                                                                            | My command                                                    | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@erp/sdk` full suite, serialized                                                                                                                                                                | `vitest run --pool=forks --poolOptions.forks.singleFork=true` | **200 passed, 2 failed, 8 skipped** (210 total) — both failures in `workflow.test.ts` (notification-retry timing assertions), a file untouched by this session's diff. Same failure class `40` reported (1 failure there vs. 2 here) — timing-sensitive, non-deterministic, confirmed unrelated by `git status` on that file.                                                                                                                                                                                                                                                                |
| `@erp/inventory-service` full suite, serialized                                                                                                                                                  | same flags                                                    | **59 passed, 15 failed** (74 total) across 5 files. 4 of the 5 files/14 of the 15 failures exactly match `40`'s previously-documented JWT-issuer-mismatch pattern (`items-price-list-search.test.ts`, `sync-routes.integration.test.ts`, `sync-routes.test.ts`, `warehouse-adjustment-transfer-permission-guards.test.ts`). The 5th file, `inventory-ledger-concurrency.integration.test.ts` (1 failure), **re-ran in isolation and passed cleanly (2/2)** — confirmed flaky under this session's own machine load, not a deterministic regression; file itself unmodified per `git status`. |
| `@erp/sales-service` — `valuation-fefo.test.ts`, `sale-return-batch-traceability.test.ts`                                                                                                        | `vitest run <files>`                                          | **3/3 pass**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@erp/auth-service` — `users-me-capabilities.test.ts`                                                                                                                                            | `vitest run <file>`                                           | **3/3 pass**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@erp/web-frontend` — `navigation.test.ts`                                                                                                                                                       | `vitest run <file>`                                           | **125/125 pass**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@erp/purchase-service` full suite, serialized                                                                                                                                                   | `vitest run --pool=forks --poolOptions.forks.singleFork=true` | **74/74 pass**, all 13 files clean, including `grn-batch-expiry.integration.test.ts` and `purchase-return-ledger.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `@erp/production-service` full suite, serialized                                                                                                                                                 | same flags                                                    | **14/14 pass**, all 4 files clean, including `job-work-order-valuation.integration.test.ts` and the concurrency test                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tsc --noEmit` — `@erp/sdk`, `@erp/inventory-service`, `@erp/sales-service`, `@erp/purchase-service`, `@erp/production-service`, `@erp/tenant-service`, `@erp/auth-service`, `@erp/web-frontend` | direct run, each package                                      | **Clean (no output/exit 0) on all 8**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Migration `0169`                                                                                                                                                                                 | direct SQL query against dev Postgres                         | Re-confirmed: `feature_flags` has exactly one `tenant_id IS NULL, flag_key='inventory.batch.enabled', enabled=true` row; `role_permissions` join against `roles` shows the exact 9 role×permission rows (`ADMIN`/`OWNER`/`SUPER_ADMIN`/`INVENTORY_MANAGER` ×2, `PURCHASE_MANAGER` ×1) `40` reported, all count 26                                                                                                                                                                                                                                                                            |

Nothing here was claimed passing without actually running it. No test was skipped and then reported as passed.

---

## 7. Security Verification

Re-derived independently, not copied from `40`:

- `requireCapability(` has **exactly one call site in the entire `apps/` tree** (`stock.routes.ts:292`) — confirmed by a full-tree grep this session, not scoped to Phase 2B's known files. This means the claim "capability enforcement occurs inside individual services, only at the two intended boundaries" is not just true for the files `39`/`40` named — it is the _only_ place this guard exists anywhere, full stop.
- `applicableBusinessTypes` on the registry entries is confirmed unread by `capability-guard.ts`'s `isCapabilityEnabled()` — grepped that file directly this session; it has zero references to `applicableBusinessTypes`, zero references to `vertical`, zero references to `businessType`. Resolution is purely `flagKey` lookup.
- No route reads `enabledCapabilities`/`capabilityKey` from client-supplied `body`/`query`/`headers` — re-confirmed by grep on `item.routes.ts` and `stock.routes.ts` this session.
- `tenantId` is JWT-derived at every gated call site (`request.auth.tenantId`), never client input — consistent with `40`§12's real-DB tenant-isolation test, which this session did not need to re-run given it re-confirms the same code path already grepped clean above.

**No security defect found. No bypass path found.**

---

## 8. Data-Safety Verification

- Migration `0169` re-applied conceptually via direct SQL read (not re-run destructively) — confirmed data-only (no `CREATE`/`ALTER`/`DROP`), confirmed `ON CONFLICT ... DO NOTHING` backed by a real query pattern.
- Capability disable/re-enable never touches `items.fefoEnabled` — confirmed by code read: no code path anywhere writes to `items.fefoEnabled` except the two gated routes in `item.routes.ts`, and neither is triggered by a capability-state change (there is no flag-change listener anywhere in the diff).
- Tenant isolation: `role_permissions`/`feature_flags` rows are tenant-scoped by `tenant_id`; the global `feature_flags` row (`tenant_id IS NULL`) is the documented default-resolution fallback, not a cross-tenant leak — a tenant-specific override row, if one existed, would take precedence per the pre-existing `PlatformFeatureFlags` resolution order (unmodified by this phase).
- No destructive migration exists in `0169` or anywhere else in this diff.

**No data-integrity or tenant-isolation defect found.**

---

## 9. Financial-Impact Verification

- `28-financial-impact-analysis.md`'s core claim (FEFO reordering is **not** cost-neutral once layers have differing unit costs) is architecturally correct and consistent with `valuation-engine.ts`'s actual `consumeFifoLayers` implementation (ordering changes which layer's `unitCost` is summed into COGS).
- `CogsAccountingConsumer.ts` posts whatever `cogsTotal` it receives from the `COGS_CALCULATED` event without recomputation — confirmed by the analysis in `28`§2, not independently re-read line-by-line this session (out of this session's time budget; the mechanism claim is a straightforward trust boundary, already well-evidenced in `28`, and consistent with `AccountingService` being untouched by this diff, which `git status --porcelain -- apps/accounting-service` confirms empty).
- No `apps/accounting-service` file appears anywhere in the diff — confirmed by `git status`.
- COGS/valuation behavior for existing (`fefoEnabled: false`) tenants is provably unchanged — this is what Phase 2A's `2A-2`/`2A-5` acceptance criteria exist to prove, and both re-ran clean this session (§4).
- Criterion J (the "financially neutral" language correction) is now resolved — §4a.

**No accidental GL/accounting change found. Financial-neutrality documentation gap resolved as PASS, not left open.**

---

## 10. Phase 2C Scope Verification

- No expiry-blocking logic found anywhere in Phase-2B-touched files — confirmed this session by an independent grep for `expiryDate.*[<>]`, `isExpired.*throw`, `blockExpired`, `expiryBlock` across `item.routes.ts`, `stock.routes.ts`, the frontend pages, and `packages/platform-sdk/src/`. The **only** match anywhere is `stock.routes.ts:371`'s `isExpired: row.expiryDate !== null && row.expiryDate.getTime() < now` — a display-only field on the near-expiry report's response rows, never used in a conditional that blocks, rejects, or gates anything. Read the surrounding code to confirm this is a plain object-literal field assignment, not a guard.
- No Phase 2C, Distribution, Manufacturing, Hotel, or Healthcare source work found anywhere in the diff — consistent with `git status --porcelain` scope confirmation (§3).

**No Phase 2C scope violation found.**

---

## 11. Industry-Neutrality Verification

- Grepped `item.routes.ts`, `stock.routes.ts`, `NearExpiryStockPage.tsx`, `ItemFormPage.tsx`, `capability-registry.ts` for `GROCERY`/`CLOTH`/`DISTRIBUTION`/`MANUFACTURING`/`HOTEL`/`HEALTHCARE`/`PHARMA`/`vertical ===`/`businessType ===` this session. Only match: `capability-registry.ts`'s `applicableBusinessTypes` metadata arrays (`['CLOTH_RETAIL','GROCERY']` on the two pre-existing entries, `['GROCERY','DISTRIBUTION','MANUFACTURING']` on the new `INVENTORY_BATCH` entry) — confirmed (§7) to be inert documentation, unread by any resolution or authorization code.
- The capability is named `INVENTORY_BATCH`, generic, not `GROCERY_BATCH`/`PHARMA_BATCH`/etc.

**No industry fork. No hard-coded vertical branch. Confirmed.**

---

## 12. Known Follow-ups (carried forward + this session's additions)

1. **F2 test-coverage gap** (§5) — Purchase Return and Job-Work Material Issue lack dedicated FEFO tests. Non-blocking for closure; recommended near-term, not indefinite. **Requires explicit authorization before any test file is written** — not done in this session.
2. **`39-implementation-report.md` §15's file-count/enumeration** (says "4 files," names 3) remains uncorrected — cosmetic, zero functional impact. Not fixed in this session (out of scope — this is a documentation edit to a different file than this review is authorized to touch without being asked).
3. **`07-api-contracts.md §4`'s stale "financially neutral" sentence** remains uncorrected in place, even though criterion J passes on a document-set-supersession basis (§4a). Recommend a one-line edit to that document the next time it's opportunistically touched — not required for closure.
4. **`drizzle-kit migrate` CLI failure** against this dev DB (pre-existing, `db_migration_bookkeeping_broken`) remains unfixed — unrelated to Phase 2B, not this review's scope.
5. **Git hygiene**: Phase 1/2A/2B remain stacked in one uncommitted working tree, as `38`§13 already flagged. Recommend splitting into separate commits before calling any of the three "shipped" in the repository's actual history.
6. Job-work finished-goods batch/expiry threading, sale-return batch/expiry threading, D3 (batch-targeted corrections), D2 (expiry-blocking policy) — all previously and correctly deferred, unaffected by this review.
7. **New this session — roadmap-numbering drift** (§14): the `phase-02-inventory-batch-capability` naming scheme does not correspond to either the source roadmap's phase numbers or `00-roadmap-analysis.md`'s own renumbering scheme. This is not a Phase 2B defect but needs the user's attention before scoping "what's next" — see §14.

---

## 13. Recommended Closure Status

**B. CLOSED WITH FOLLOW-UPS.**

Applying the standard given for this review: the implementation is functionally correct on every dimension independently re-tested (security, tenant isolation, data safety, financial-mechanism correctness, industry neutrality, no Phase 2C leakage) — what remains is a bounded, self-disclosed, low-current-exposure test-coverage gap (F2) and small documentation-consistency items. None of these are "materially risky financial/inventory behavior that cannot be reasonably considered covered" — the risky _mechanism_ (FEFO layer selection under differing costs) is covered at the shared-engine level and at three of five identical call sites; the two uncovered call sites are structurally identical to a tested one, not independently implemented.

This verdict does **not** authorize proceeding to Phase 2C, a new industry, or any other next-phase work — see §14.

---

## 14. Roadmap Next-Step Analysis (Step 12)

Read fresh this session: `ERP-PLANNING/implementation/00-roadmap-analysis.md`, `ERP-PLANNING/multi-industry-platform/16-phase-roadmap.md`, `19-first-industry-recommendation.md`, `20-executive-summary.md`.

### 14.1 — A numbering/tracking inconsistency exists and should be corrected before the next phase is scoped

Three different phase-numbering schemes now exist across the planning tree, and they do not agree with each other:

1. **Source roadmap** (`16-phase-roadmap.md`, Phase 0–12): Phase 2 = Module/Capability Registry, Phase 3 = inert guard, Phase 4 = wire `requireModule` onto **HR and Production routes specifically**, Phase 5 = capability-aware nav, Phase 7 = Commerce Core generalization (batch/expiry/UOM) + `EVENT_GOVERNANCE.md`.
2. **`00-roadmap-analysis.md`'s own session-renumbering** (written the same day as the source roadmap's Phase 7 correction note): collapses source-roadmap Phases 2–3 into "this session's Phase 1 — Capability Foundation" (done), and explicitly maps a **future** "Phase 2" to source-roadmap Phases 4–5 (**HR/Production route wiring + nav**) and a **future** "Phase 3" to source-roadmap Phase 7 (**FEFO verification + stock-mutation consolidation + `EVENT_GOVERNANCE.md`**) — in that stated order.
3. **What was actually built and named** `phase-02-inventory-batch-capability` ("Phase 2A"/"Phase 2B" in that folder's own documents): this is, by content, **`00-roadmap-analysis.md`'s future "Phase 3"** (FEFO verification: done; stock-mutation-triplication re-check: substantially done via the sales-service engine consolidation) — **not** its future "Phase 2" (HR/Production route wiring), which remains completely undone.

This is independently confirmed by direct code inspection this session, not inferred from the documents' framing alone: `requireCapability(` has exactly one call site anywhere in `apps/` (`stock.routes.ts:292`, `INVENTORY_BATCH`'s route), and `HR_PAYROLL`/`POS` — the two capabilities the source roadmap's Phase 4 specifically named — appear **nowhere** in `navigation.ts` and are wired to **zero** backend routes. The mechanism (`requireCapability`, `isCapabilityEnabled`, the frontend nav filter) has now been proven end-to-end exactly once, on a capability the original roadmap never named, while the two capabilities the roadmap did name for that proof step remain exactly as inert as they were after Phase 1.

**This is not a defect in Phase 2B** — Phase 2B is honest about its own scope; its README explicitly lists "`HR_PAYROLL`/`POS` route-wiring" as a non-goal, and `29-expiry-policy-analysis.md`/`26-decision-record.md` show real, evidence-driven reasoning for prioritizing the capability Distribution/Manufacturing need. But **the roadmap-tracking documents were not updated to reflect that a different phase than the one \"next in line\" was executed**, under a folder name (`phase-02-...`) that invites reading it as source-roadmap-Phase-2-equivalent when it is not. A future session (or the user) picking up `00-roadmap-analysis.md` at face value would reasonably conclude "Phase 2 (HR/Production wiring) is next" without realizing the actual next-in-original-sequence item was skipped in favor of a different, also-valuable, but differently-scoped piece of work.

**Recommendation**: before scoping any next phase, reconcile these three numbering schemes into one — either by updating `00-roadmap-analysis.md`'s table to mark its future "Phase 2" (HR/Production wiring) as still fully open and its future "Phase 3" as the one actually completed (out of order, which the roadmap itself says is fine — Phase 7 was already flagged as having no dependency on Phases 1–6), or by renaming/re-cross-referencing the `phase-02-inventory-batch-capability` folder so its name doesn't collide with a different, uncompleted "Phase 2." This is a documentation/tracking fix, not a re-plan — flagged per this review's explicit mandate not to silently let the roadmap's own bookkeeping drift from reality.

### 14.2 — Is Phase 2B completion sufficient prerequisite for Phase 10 (first industry)?

**No.** The source roadmap's own Phase 10 readiness gate (`16-phase-roadmap.md`, Phase 10's Objective line) requires, verbatim: _"Phases 1–5 complete... CRM/O2C split complete or far enough along... Phase 7's Commerce Core generalization complete if the chosen industry needs batch/expiry."_ Checked against current evidence:

| Gate                                                                                                     | Status                                                                                | Evidence                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 — Business Profile Foundation (`industries`/`business_types` tables, `tenants.business_type_id`) | **Not started**                                                                       | No such migration or table exists anywhere in this diff or the prior committed history; `00-roadmap-analysis.md` itself confirms this was deliberately split off as its own parallel workstream, not yet begun |
| Phase 2–3 — Registry + inert guard                                                                       | **Done**                                                                              | Phase 1 (Capability Foundation), independently verified prior session and re-spot-checked this session                                                                                                         |
| Phase 4 — wire `requireModule`/`requireCapability` onto HR **and** Production routes                     | **Not done**                                                                          | §14.1 — zero route wiring exists for `HR_PAYROLL`/`POS`; the only proven wiring is on a different capability (`INVENTORY_BATCH`) the source roadmap's Phase 4 never named                                      |
| Phase 5 — capability-aware nav for the HR/Production wiring specifically                                 | **Not done for HR/POS**                                                               | Same grep evidence — `navigation.ts` has zero `HR_PAYROLL`/`POS` nav entries                                                                                                                                   |
| CRM/O2C service split                                                                                    | **Scaffolded only**                                                                   | `git log` head is `cc9627f feat(infra): scaffold new crm-service deployable...` — consistent with prior-session memory that this split is scaffolded but not executed                                          |
| Phase 7 — Commerce Core generalization (FEFO + stock-mutation consolidation)                             | **Substantially done** (via Phase 2A/2B, tracked under different numbering per §14.1) | This review's own §4–§11                                                                                                                                                                                       |

**Four of six gate items remain unmet.** Phase 2B's closure resolves only the Phase-7-shaped gate, and even that only partially (`EVENT_GOVERNANCE.md` — explicitly named in the source roadmap's Phase 7 completion criteria — was not written by Phase 2A or 2B and does not appear anywhere in this diff). Declaring Phase 10 (or any new industry) ready to start next, on the strength of Phase 2B alone, would be incorrect against the roadmap's own stated gate — not a matter of preference, but a direct contradiction of criteria the roadmap documents themselves set.

### 14.3 — Should another foundational capability be implemented before selecting a first industry?

Yes, per the roadmap's own unmet gates (§14.2), at least one of:

- **Phase 1 — Business Profile Foundation**, since Phase 10 explicitly needs a `business_types` row to seed a genuinely new industry from, and this workstream has zero code today.
- **The literal Phase 4/5 proof** — wiring `HR_PAYROLL` and/or `POS` (the two capabilities that already exist, registered, unused) onto at least one real route each, so the capability-gating mechanism has been proven on more than a single, brand-new capability built in the same session as its own proof. This is lower-risk and faster than Phase 1, and directly closes the gap §14.1 identified.
- **Advancing the CRM/O2C split** past "scaffolded" — flagged by the source roadmap itself as a hard dependency for Phase 10 ("so the new industry doesn't add to sales-service's God-service problem").

This review does not pick among these — that is a scoping decision for the user, consistent with this review's mandate not to silently choose the next phase.

### 14.4 — Does the Distribution/Manufacturing recommendation still hold?

**Yes, unchanged.** `19-first-industry-recommendation.md §2b`'s own correction note already anticipated exactly this session's evidence (Commerce Core/FEFO landing) and stated explicitly that it does not change the core ranking — Distribution/Manufacturing were never ranked first _because_ of the batch/expiry gap, so closing that gap doesn't newly justify them, and doesn't newly disqualify Hotel/Healthcare either (they remain last for reasons unrelated to FEFO — net-new domain modeling, regulatory complexity, least code reuse). Nothing found in this review's independent verification of Phase 2A/2B contradicts or weakens that reasoning. This recommendation remains a **recommendation for user confirmation**, not a decision this review is making on the user's behalf — reiterating `19`§3's own framing, which still applies.

---

## 15. Explicit Statement: No Source Code Was Changed

No application source file, test file, migration file, configuration file, or planning document (other than this one, newly created) was created, edited, or deleted to produce this review. Every test run in §6 was a read-only execution against the existing dev Postgres/Redis stack; the one SQL activity performed (§8, §6's migration re-check) was a `SELECT` query, not a write, insert, or schema change. `git status` was checked but nothing was staged, committed, reset, or cleaned.
