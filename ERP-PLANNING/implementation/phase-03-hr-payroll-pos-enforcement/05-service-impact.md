# 05 — Service Impact

## `apps/hr-service` (Phase 3A)

**File: `apps/hr-service/src/api/payroll.routes.ts`** — six `preHandler` arrays gain one entry each:

```ts
// before, e.g. line 80:
{
  preHandler: [authenticate, requirePermission(PERMISSIONS.PAYROLL_VIEW)];
}

// after:
{
  preHandler: [
    authenticate,
    requireCapability('HR_PAYROLL', ctxFactory.rawDb, ctxFactory.getRedis()),
    requirePermission(PERMISSIONS.PAYROLL_VIEW),
  ];
}
```

New import: `import { requireCapability } from '@erp/sdk';` (already exported since Phase 1 — `packages/platform-sdk/src/index.ts`). `ctxFactory` is already an in-scope parameter of `payrollRoutes(fastify, ctxFactory)` — no new parameter threading needed (`01-current-code-evidence.md` §6).

Routes 923/1059 (`/internal/payroll/*`) — **unchanged**, per D2.

No other file in `apps/hr-service` changes for Phase 3A.

## `apps/sales-service` (Phase 3B)

**File: `apps/sales-service/src/api/pos.routes.ts`** — 12 `preHandler` arrays gain the same one-entry addition, `requireCapability('POS', ctxFactory.rawDb, ctxFactory.getRedis())`, positioned before whatever existing permission check each route has (`requireAnyPermission`/`requirePermission`, varies by route — verify each at implementation time, do not assume uniform shape across all 12).

**File: `apps/sales-service/src/api/day-end.routes.ts`** — both routes (Z-report generate/view) gain the same addition.

**File: `apps/sales-service/src/api/promotion.routes.ts`** — the one route gated by `requireAnyPermission([POS_MANAGE, POS_ACCESS])` gains the same addition.

New import in all three files: `import { requireCapability } from '@erp/sdk';`. `ctxFactory` already threaded into all three route-registration functions (`01-current-code-evidence.md` §6) — confirmed by `main.ts`'s existing `posRoutes(sub, ctxFactory)` / `dayEndRoutes(sub, ctxFactory)` / `promotionRoutes(sub, ctxFactory)` calls.

No other file in `apps/sales-service` changes for Phase 3B — in particular, `InvoiceService.ts`, `PaymentService.ts`, `LoyaltyService.ts` (imported by `pos.routes.ts` but not modified by it) are untouched; the gate lives entirely in the route registration layer, never inside a domain service.

## `packages/platform-sdk`, `packages/shared-types`, `packages/logger`

**Unchanged.** `requireCapability`, `isCapabilityEnabled`, `CAPABILITY_REGISTRY`, `erpCapabilityCheckDeniedTotal` all already exist and are already correct for this use — this phase is a pure consumer of Phase 1's exports, adding zero new SDK surface. (Contrast Phase 2B, which needed a new `assertBatchConfigureAllowed` in-handler helper — no analogous new helper is needed here since every route in scope is a simple top-level preHandler case, not a conditional-on-request-body case like `item.routes.ts` PUT handling.)

## `apps/web-frontend`

**File: `apps/web-frontend/src/lib/navigation.ts`** — the existing `HR & PAYROLL` nav group (line ~704) gains `capabilityKey: 'HR_PAYROLL'` on its relevant leaf/group entry (exact node TBD at implementation time — verify whether the whole group or just the Payroll leaf should carry the tag; see `09-navigation-and-frontend.md`). No `filterNavItem`/`filterNavGroups` signature change needed — Phase 1 already built that parameter; this phase only sets a previously-unused field, exactly the pattern Phase 2B already used for its own nav entry (`39-implementation-report.md` §8).

No POS-side change in `web-frontend` — POS has no nav group there.

## `apps/pos-frontend`

New work, not an extension — see `09-navigation-and-frontend.md` §9 for the explicit, bounded scope (handle the new `403 CAPABILITY_NOT_ENABLED` response gracefully; this app currently has no capability-state delivery mechanism at all, unlike `web-frontend`'s `GET /users/me`-based one).

## Services confirmed NOT touched

`apps/inventory-service`, `apps/purchase-service`, `apps/production-service`, `apps/auth-service`, `apps/tenant-service`, `apps/api-gateway`, `apps/ai-copilot-service`, `apps/report-service`, `apps/search-service`, `apps/event-service`, `apps/accounting-service`, `apps/gst-service` — none of these files reference `PAYROLL_*`/`POS_*` permissions as a route gate (confirmed by the same full-tree grep in `01-current-code-evidence.md`).
