# 05 — Service Impact

Three services touched, each with a distinct, small, evidence-grounded change. No new service. No file outside the four listed touches production code.

## 1. `inventory-service` — item configuration + new report route

**`src/api/item.routes.ts`** (`POST /items`, `PUT /items/:id`):

- `ItemSchema` (Zod) gains an optional `fefoEnabled: boolean` field.
- **In-handler** capability check (not a route-level `preHandler`): both routes stay Commerce-Core always-on (every tenant creates/edits items regardless of this capability) — only the `fefoEnabled` field itself is conditional. If the request body sets `fefoEnabled: true` and `isCapabilityEnabled('INVENTORY_BATCH', tenantId, ...)` resolves `false`, the field is rejected with a `422`/`VALIDATION_ERROR` (not silently dropped — silent drop would be confusing UX; not a 403, since the rest of the request is legitimate) rather than gating the whole route. This is the capability-granularity pattern this phase's `15-security-impact.md` documents as a genuine addition to Phase 1's route-level-only precedent.
- Uses `isCapabilityEnabled()` directly (Phase 1 already exports it "so background/non-route callers... can reuse the same resolution logic without going through a Fastify preHandler" — `packages/platform-sdk/src/capability-guard.ts`), not `requireCapability`, since the check is conditional-within-a-route, not the whole route.

**New route, same file or a new `batch.routes.ts`** (decide at implementation time based on file-size convention already used elsewhere in this service): `GET /inventory/near-expiry-stock` — lists `inventory_fifo_layers` rows with non-null `expiryDate` within a configurable threshold, for the item's own tenant/warehouse scope. Route-level `preHandler: [authenticate, requireCapability('INVENTORY_BATCH', db, redis), requirePermission(PERMISSIONS.BATCH_VIEW)]` — this route IS genuinely whole-route-optional (a tenant without the capability has no near-expiry data to show), so it uses the standard Phase 1 preHandler pattern, matching `21-capability-resolution-architecture.md` §3's example almost verbatim. Reuses the same query shape `nearExpiryAlert.job.ts` already proves correct (`idx_fifo_layers_fefo_order` is shaped for exactly this).

## 2. `purchase-service` — no change

`GRNService.ts`'s existing unconditional batch/expiry capture (`01-current-code-evidence.md` §2) is **left exactly as-is**. Rationale: capturing supplier-provided batch/expiry metadata on a receipt line is harmless and potentially useful (audit trail) even for an item that isn't FEFO-tracked, and gating it would require `GRNService` to look up the capability/item-flag mid-transaction for zero behavioral benefit (the data is simply unused downstream if `fefoEnabled` stays `false` — `consumeFifoLayers` ignores `expiryDate` entirely for non-FEFO items, per §3 below). Not touching a working file matches CLAUDE.md's surgical-changes principle directly.

## 3. `sales-service` — consumption ordering

**`src/domain/ValuationService.ts`**, `consumeFifoLayers()`:

- Gains one new parameter (or an internal lookup — implementation detail for the coding session, both are small) resolving the consumed item's `fefoEnabled` value.
- `orderBy` becomes conditional: `fefoEnabled === true` → `orderBy(asc(expiryDate) NULLS LAST, asc(receivedAt))`; otherwise unchanged `orderBy(asc(receivedAt))`.
- **No capability check added inside `ValuationService.ts` itself.** `item.fefoEnabled` can only ever be `true` if the capability was enabled at the moment it was set (enforced in `item.routes.ts`, §1) — re-checking the capability again on every stock consumption (a hot path — every invoice, every POS sale, every transfer) would repeat exactly the performance anti-pattern Phase 1's own `21-post-implementation-review.md` §15 finding 1 flagged (`GET /users/me` paying a Redis round-trip per registry key with no L1-cache reuse). Trusting the already-capability-gated `fefoEnabled` column as the single source of truth here is the correct, evidence-informed design choice — documented explicitly so a future reviewer doesn't "fix" it by adding a redundant check. See `15-security-impact.md` §3 for the full reasoning and the one caveat this creates.

## 4. What does NOT change in any of the three services

- No route's `requirePermission` call is removed or reordered relative to existing checks.
- No existing route's response shape changes (only additive fields/new routes).
- No change to `authenticate.ts`, JWT handling, or any cross-service call convention in any of the three services.
- `nearExpiryAlert.job.ts` is untouched — it already works, independent of this phase's changes (`01-current-code-evidence.md` §5).

## 5. Confirms `21-capability-resolution-architecture.md` §1's rule in practice

This capability's enforcement touches `inventory-service` (config + new route, `preHandler`-style), `sales-service` (in-handler, hot-path, no capability recheck), and deliberately does **not** touch `purchase-service` at all — a real, non-contrived demonstration that "capability" and "service" are independent axes, and that not every service adjacent to a capability's data needs to enforce it (only the services that make a decision based on the capability's state do).
