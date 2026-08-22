import { sql } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';

// Multi-industry platform, Phase 9 (13-security-architecture.md §2 step 1) — closes the
// "GUC-per-request gap": app.current_tenant_id was only ever set inside an explicit
// TenantScopedDatabase.transaction() call (database.ts), never for the far more common plain
// `ctx.db.raw.select()...` path most routes actually use.
//
// First attempt used postgres-js's sql.reserve() to pin one physical connection for a request's
// lifetime. Dead end, confirmed empirically: a reserved connection is a stripped-down Sql
// instance with no `.begin()` (only `.savepoint()`-free plain queries) — drizzle-orm's own
// `.transaction()` unconditionally calls `client.begin(...)`, so any domain service that opens a
// transaction against a reserved connection (most of them — see BOMService.create()) throws
// "this.client.begin is not a function". A reserved connection cannot be handed to drizzle() and
// still support nested transactions.
//
// The actual correct primitive was already sitting in database.ts: ErpDatabase.transaction()
// (postgres-js's pool-level `.begin()`) both opens a real transaction AND makes every later
// `.transaction()` call inside it resolve to a SAVEPOINT via drizzle's own class-switching
// (PostgresJsSession -> PostgresJsTransaction) — exactly what BOMService.create() and friends
// need, with zero changes to any domain service. `set_config(..., true)` (SET LOCAL semantics)
// auto-reverts at COMMIT/ROLLBACK, so there's no separate "reset before release" step to get
// wrong — Postgres itself guarantees it.
//
// The real cost: the request's entire DB-touching work must run inside the transaction callback
// (postgres-js's `.begin()` only stays open for the callback's lifetime — there is no
// "reserve now, release later via a separate hook" shape available). See
// fastify-tenant-connection.ts's tenantScopedHandler for what this means for route wiring, and
// 23-guc-per-request-rollout-checklist.md for the one real behavior change this introduces
// (a route that did several independently-committed writes would now share one commit/rollback).
export async function withTenantConnection<T>(
  pooledDb: ErpDatabase,
  tenantId: number,
  fn: (scopedDb: ErpDatabase) => Promise<T>
): Promise<T> {
  return pooledDb.transaction(async (trx) => {
    await trx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId.toString()}, true)`
    );
    return fn(trx as unknown as ErpDatabase);
  });
}
