# [PG-031] Remove dead `GET /items/:id/stock` stub endpoint

> Template version 1.0. Every gap-prompt file in this tree must follow this exact section order. Do not add sections; do not omit sections that apply. If a section genuinely does not apply to this gap, write "Not applicable — <one-line reason>" instead of deleting it, so the structure stays diffable across files.

**Category:** Inventory
**Priority:** Low
**Complexity:** S — one dead route removal + one dead frontend wrapper removal, no schema/migration involved
**Depends on:** none
**Blocks:** none
**Primary service(s)/package(s):** apps/inventory-service, apps/web-frontend

---

## Overview

- **Business objective:** dead code that silently returns a fabricated "success" response is worse than a 404 — anything that ever calls `GET /items/:id/stock` gets `stock: []` and a plausible-looking envelope (`_projection: { isStale: true, lagMs: 0 }`) instead of an error, which could be misread as "this item has zero stock everywhere" and drive a wrong reorder or sales decision if a future feature accidentally wires up to this route instead of the real one. Removing it eliminates that trap and the duplicate-endpoint confusion for anyone reading `apps/inventory-service/src/api/item.routes.ts`.
- **Current implementation:** the stub lives in `apps/inventory-service/src/api/item.routes.ts`, lines 200-216, registered inside the `itemRoutes` Fastify plugin:
  ```ts
  // ── GET /items/:id/stock — Stock by warehouse (Phase 4 projection) ────────
  fastify.get<{ Params: { id: string } }>('/items/:id/stock', { preHandler: [authenticate, requirePermission(PERMISSIONS.ITEM_VIEW)] }, async (request, reply) => {
    ...
    if (!item) throw new NotFoundError('Item', id);
    // Phase 4 will provide real stock from inventory_ledger projection
    return reply.code(200).send({ data: { itemId: id, stock: [], _projection: { isStale: true, lagMs: 0 } } });
  });
  ```
  It looks up the item (so it 404s on a bad ID) but then unconditionally returns an empty `stock: []` array — it was written as a Phase-4 placeholder and Phase 4 (ES-13, inventory valuation) shipped the real replacement in a different file instead of filling this one in.
- **Current architecture:** `itemRoutes` and `stockRoutes` are both registered in `apps/inventory-service/src/main.ts` inside the same `fastify.register(async (sub) => { ... })` block (`await itemRoutes(sub, ctxFactory); await stockRoutes(sub, ctxFactory); await valuationRoutes(sub, ctxFactory);`), so both routes are live side by side today — one real, one a decorative stub.
- **Current limitations:** the real, working replacement already exists and has for some time: `GET /inventory/stock/:itemId` in `apps/inventory-service/src/api/stock.routes.ts` (lines 107-140), which queries `projectionStockLevel` joined with `warehouses` and returns genuine per-warehouse `{ warehouseId, warehouseName, availableQty, reservedQty, lastMovementAt }` rows. The same file also exposes `GET /inventory/stock` (paginated list with `belowReorder`/`warehouseId` filters) and `GET /inventory/ledger/:itemId` (raw ledger). `GET /items/:id/stock` duplicates none of this — it just fakes an empty answer.

## Existing Code Analysis

- **What already exists and should be reused:** `stock.routes.ts`'s `GET /inventory/stock/:itemId` is the canonical, already-shipped stock-by-warehouse endpoint. No new backend logic is needed — this package is a deletion, not a reimplementation.
- **What should never be modified:** `stock.routes.ts` itself, the `projectionStockLevel` CQRS read model it queries, and the nightly ledger-vs-projection reconciliation job (`FEATURE_INVENTORY.md` §5.4) that keeps that projection trustworthy — none of that is in scope here.
- **Prior related work:** `ERP-PLANNING/reports/FEATURE_INVENTORY.md` §8 already documents this exact finding ("`GET /items/:id/stock` is dead/stub code (superseded by the real stock endpoint elsewhere)") from the 2026-07-08 source-code audit; this package is the first one to actually act on it. No phase-completion report currently references either route.

## Architecture

- No architectural change. This is a subtractive change: remove one Fastify route handler and one now-orphaned frontend API-client wrapper function. No new pattern, no redesign of `stock.routes.ts`.
- Data flow after the change: any caller that needs per-warehouse stock uses `GET /inventory/stock/:itemId` exactly as it does today (nothing about that path changes).

## Database Changes

Not applicable — no schema, table, or migration change. The stub never read or wrote any table (it only did a `SELECT` on `items` to produce a 404, then returned a hardcoded literal).

## Backend

- **Remove:** the `fastify.get('/items/:id/stock', ...)` handler block in `apps/inventory-service/src/api/item.routes.ts` (lines 200-216), including its header comment.
- **Verify before deleting:** confirm no test in `apps/inventory-service/src/__tests__/` asserts against this route's response shape. A repo-wide grep for `/items/:id/stock`, `` `/items/${...}/stock` ``, and the literal string `_projection` inside `apps/inventory-service` turned up only the stub's own file — no test currently exercises it, so removal has no test fallout to fix.
- **No route replacement needed:** because `GET /inventory/stock/:itemId` already exists, is registered, and already does the real job — there is nothing to "redirect" callers to that isn't already live.
- No Kafka topics, outbox events, or CQRS projections are touched by this removal — the stub never participated in any of them.
- No new validation, authorization, audit logging, or telemetry is needed; removing a route removes its `requirePermission(PERMISSIONS.ITEM_VIEW)` check along with it, which is correct since the route itself is gone.

## Frontend

- **Remove:** the dead wrapper `stock: (id: number) => apiClient.get('inventory', `/items/${id}/stock`)` at `apps/web-frontend/src/api/endpoints.ts:210` (inside the `items` endpoint group).
- **Confirmed dead:** a repo-wide grep of `apps/web-frontend/src` and `apps/pos-frontend/src` for `endpoints.items.stock(` and `items.stock(` found zero call sites — nothing in either frontend invokes this wrapper. The real stock lookup used in production code is `stock.byItem` (`apps/web-frontend/src/api/endpoints.ts:332`, calling `GET /inventory/stock/:itemId`), consumed by `StockLevelsPage` (routed at `/inventory/stock` in `App.tsx:308`, with a nav entry in `web-frontend/src/lib/navigation.ts:70`). That page and its data flow are untouched by this change.
- No component, hook, form, or permission-gating change needed beyond deleting the one dead line — this is backend-and-client-wrapper cleanup only, not a UI change (nothing user-visible depended on the dead wrapper).

## API Contract

- **Removed:** `GET /items/:id/stock` (`apps/inventory-service`). Previously: 200 response `{ data: { itemId: number, stock: [], _projection: { isStale: boolean, lagMs: number } } }` (always empty, non-functional). After this change: 404 (route no longer exists), same as any unregistered path.
- **Unchanged, already the correct contract to use:** `GET /inventory/stock/:itemId` → `200 { data: { warehouseId, warehouseName, availableQty, reservedQty, lastMovementAt }[] }`.

## Multi-Tenant Considerations

Not applicable beyond what already existed — the stub was tenant-scoped like every other route (`ctxFactory.create({ tenantId, ... })`) but never actually read tenant-scoped data beyond the item-existence check. Removing it changes no isolation behavior; the real replacement route was already correctly tenant/branch-scoped and continues to be.

## Integration

- **apps/inventory-service:** one route handler removed from `item.routes.ts`; `main.ts`'s registration list is unaffected (it registers the whole `itemRoutes` plugin, not individual routes within it, so no change needed there).
- **apps/web-frontend:** one dead API-client wrapper removed from `endpoints.ts`. No other service or frontend references either the route or the wrapper.

## Coding Standards

This package removes code rather than adding any — there is no new pattern to justify. The replacement path (`stock.routes.ts`) already follows this repo's standard Fastify + Zod + `requirePermission()` + `@erp/db` Drizzle-query convention, so nothing new needs to be introduced.

## Performance

Not applicable — removing an unused route with no callers has no measurable performance effect (it saves one dead code path from being loaded/JIT'd, which is negligible).

## Security

Removing a route that returns a fabricated, always-successful, always-empty response for any valid item ID closes a small but real "stale/misleading data" risk class: a caller (human or future automated integration) hitting this path would get a `200 OK` that looks legitimate rather than a clear signal that the endpoint doesn't work. There is no permission-check regression — the route's `requirePermission(PERMISSIONS.ITEM_VIEW)` guard is deleted along with the route itself, and the real replacement route enforces the same permission.

## Testing

- **Before removing:** run `pnpm --filter @erp/inventory-service test` and grep `apps/inventory-service/src/__tests__/**` for `/items/:id/stock` or `stock: []` to reconfirm no test currently depends on the stub (already checked during planning — zero matches found).
- **After removing:** re-run `pnpm --filter @erp/inventory-service test` and `pnpm --filter @erp/inventory-service typecheck` to confirm no compile-time or runtime reference to the deleted handler remains.
- **Frontend:** run `pnpm --filter @erp/web-frontend typecheck` after deleting the `endpoints.ts:210` wrapper to confirm nothing else in the frontend referenced `endpoints.items.stock` (expected: no errors, since no call sites exist).
- No new tests need to be added — this is a pure deletion of unreachable code with an already-tested replacement (`stock.byItem` / `GET /inventory/stock/:itemId` is exercised by existing `StockLevelsPage` component/integration tests, if any exist under `apps/web-frontend/src/pages/inventory/__tests__`).

## Acceptance Criteria

- [ ] `grep -r "items/:id/stock" apps/inventory-service/src` returns no matches after the change.
- [ ] `grep -r "endpoints.items.stock\|items\.stock(" apps/web-frontend/src apps/pos-frontend/src` returns no matches after the change.
- [ ] `pnpm --filter @erp/inventory-service typecheck` and `pnpm --filter @erp/inventory-service test` pass.
- [ ] `pnpm --filter @erp/web-frontend typecheck` passes.
- [ ] Manual/automated check: `curl GET /items/:id/stock` against a running inventory-service now returns 404, and `GET /inventory/stock/:itemId` continues to return real per-warehouse data for the same item.

## Deliverables

- **Files to create:** none.
- **Files to modify:**
  - `apps/inventory-service/src/api/item.routes.ts` (remove lines 200-216, the `/items/:id/stock` handler and its header comment).
  - `apps/web-frontend/src/api/endpoints.ts` (remove the `stock: (id) => ...` wrapper at line 210 from the `items` endpoint group).
- **Migrations:** none.
- **APIs added/changed:** `GET /items/:id/stock` removed (no replacement needed — `GET /inventory/stock/:itemId` already serves this purpose).
- **Events added/changed:** none.
- **Tests added:** none required; existing test suites re-run to confirm no regression.

---

## Context Preservation (for a fresh AI session with no prior history)

**Previous Work Summary:** `apps/inventory-service` has two endpoints that both claim to return "item stock": `GET /items/:id/stock` (a Phase-4-placeholder stub in `item.routes.ts` that always returns an empty array) and `GET /inventory/stock/:itemId` (the real, projection-backed endpoint in `stock.routes.ts`, already live and already consumed by `StockLevelsPage` in web-frontend via `endpoints.ts`'s `stock.byItem` wrapper). Both are registered today in `main.ts`.

**Current Objective:** delete the dead stub route in `item.routes.ts` and its now-orphaned frontend wrapper in `endpoints.ts`. This is pure removal — no new backend logic, no new frontend UI, no migration.

**Architecture Snapshot:** Fastify route plugins are registered per-domain-file in `apps/inventory-service/src/main.ts`; `itemRoutes`, `stockRoutes`, and `valuationRoutes` are three separate files registered into the same sub-router. `stock.routes.ts` reads from the `projectionStockLevel` CQRS table (populated by a Kafka-driven projection, reconciled nightly against the ledger) — this is the source of truth for per-warehouse stock, not `items` table columns.

**Completed Components:** the real stock endpoint (`GET /inventory/stock/:itemId`) and its frontend consumer (`StockLevelsPage`) are both already fully built and in production use — nothing here needs to be built.

**Pending Components:** none beyond the deletion itself. This package does not touch `stock.routes.ts`, `valuation.routes.ts`, or any other inventory report.

**Known Constraints:** none specific to this package — it's a low-risk, no-schema-change removal.

**Coding Standards:** no new code is introduced, so no new pattern decision is needed; the surviving route already follows this repo's Fastify + `requirePermission()` + Drizzle convention.

**Reusable Components:** `apps/inventory-service/src/api/stock.routes.ts` (`GET /inventory/stock/:itemId`) is the permanent replacement — nothing to import, since nothing new is being written.

**APIs Already Available:** `GET /inventory/stock/:itemId`, `GET /inventory/stock` (list), `GET /inventory/ledger/:itemId` — all in `stock.routes.ts`, all already callable.

**Events Already Available:** not applicable — this package touches no events.

**Shared Utilities:** not applicable.

**Feature Flags:** none.

**Multi-Tenant Rules:** unaffected — the surviving route already scopes by `tenantId` via `ctxFactory.create()` exactly like the deleted one did.

**Security Rules:** the deleted route was guarded by `PERMISSIONS.ITEM_VIEW`; the surviving route is guarded by the same constant, so no permission gap opens or closes.

**Database State:** no table changes; `items`, `projectionStockLevel`, `inventory_ledger` are all unaffected.

**Testing Status:** no existing test references the stub (verified by grep); no test needs to be written for its removal, only re-run of the existing suite to confirm no regression.

**Next Session Plan:** single session — this is a same-session, few-line change.

**Prompt for the Next Session:** "Implement `ERP-PLANNING/production-gap-prompts/005-Inventory/43-remove-dead-stock-stub-endpoint.md` (PG-031): delete the dead `GET /items/:id/stock` stub in `apps/inventory-service/src/api/item.routes.ts` (lines 200-216) and the orphaned `stock: (id) => ...` wrapper at `apps/web-frontend/src/api/endpoints.ts:210`. Re-verify with a fresh grep that neither is referenced anywhere before deleting, then run typecheck/tests for both packages."
