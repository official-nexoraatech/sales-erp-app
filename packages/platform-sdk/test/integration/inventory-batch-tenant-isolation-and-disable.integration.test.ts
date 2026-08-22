// Phase 2B (INVENTORY_BATCH) — real Postgres + Redis proof of three things the plan calls
// out as must-hold (D4, 17-migration-and-backward-compatibility.md, 26-decision-record.md):
//
// 1. Tenant isolation: one tenant's INVENTORY_BATCH override never leaks into another's
//    resolution, same guarantee capability-resolution.integration.test.ts already proves
//    generically — this asserts it specifically for the new capability.
// 2. Disabling the capability for a tenant does NOT reset/mutate an existing item's
//    fefoEnabled column or any other business data (D4's exact "must not" list).
// 3. The FEFO consumption engine (ValuationService.consumeForStockOut) keeps honoring an
//    item's fefoEnabled=true even while the tenant's capability is currently disabled —
//    proving consumption flows trust items.fefoEnabled as sole source of truth and never
//    re-check the capability at consumption time (26-decision-record.md's capability-boundary
//    confirmation). Only the write path that turns fefoEnabled on is capability-gated, not
//    every read of it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type ErpDatabase } from '@erp/db';
import { featureFlags, items, warehouses, branches, inventoryFifoLayers } from '@erp/db';
import { and, eq, inArray } from 'drizzle-orm';
import Redis from 'ioredis';
import { isCapabilityEnabled } from '../../src/capability-guard.js';
import { ValuationService } from '../../src/valuation-engine.js';
import { PlatformFeatureFlags } from '../../src/feature-flags.js';
import { TenantScopedDatabase } from '../../src/database.js';
import { TenantScopedCache } from '../../src/cache.js';

const DB_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];

const TENANT_A = 900_201;
const TENANT_B = 900_202;

describe.skipIf(!DB_URL || !REDIS_URL)(
  'INVENTORY_BATCH — tenant isolation + disable/re-enable data safety (real Postgres + Redis)',
  () => {
    let db: ErpDatabase;
    let redis: Redis;
    let warehouseId: number;
    let itemId: number;

    async function invalidate(tenantId: number): Promise<void> {
      const flags = new PlatformFeatureFlags(
        new TenantScopedDatabase(tenantId, db),
        new TenantScopedCache(redis, tenantId),
        tenantId
      );
      await flags.invalidate('inventory.batch.enabled');
    }

    beforeAll(async () => {
      db = createDatabaseClient({ url: DB_URL! });
      redis = new Redis(REDIS_URL!);

      // Tenant A: explicit override ON. Tenant B: explicit override OFF. Both override the
      // global default (seeded true by migration 0169) so this test is self-contained
      // regardless of what the global row currently says.
      await db
        .insert(featureFlags)
        .values([
          { tenantId: TENANT_A, flagKey: 'inventory.batch.enabled', enabled: true },
          { tenantId: TENANT_B, flagKey: 'inventory.batch.enabled', enabled: false },
        ])
        .onConflictDoNothing();
      await db
        .update(featureFlags)
        .set({ enabled: true })
        .where(
          and(
            eq(featureFlags.tenantId, TENANT_A),
            eq(featureFlags.flagKey, 'inventory.batch.enabled')
          )
        );
      await db
        .update(featureFlags)
        .set({ enabled: false })
        .where(
          and(
            eq(featureFlags.tenantId, TENANT_B),
            eq(featureFlags.flagKey, 'inventory.batch.enabled')
          )
        );
      await invalidate(TENANT_A);
      await invalidate(TENANT_B);

      const [branch] = await db
        .insert(branches)
        .values({
          tenantId: TENANT_A,
          name: 'Test HO',
          code: 'HO',
          isHeadOffice: true,
          isActive: true,
          createdBy: 1,
        })
        .returning();
      const [wh] = await db
        .insert(warehouses)
        .values({
          tenantId: TENANT_A,
          branchId: branch!.id,
          name: 'Main WH',
          code: 'MWH',
          isDefault: true,
          isActive: true,
          createdBy: 1,
        })
        .returning();
      warehouseId = wh!.id;

      const [item] = await db
        .insert(items)
        .values({
          tenantId: TENANT_A,
          name: 'D4 Test Item',
          itemCode: `D4-${TENANT_A}`,
          unitId: 1,
          hsnCode: '1234',
          gstRate: '5.00',
          salePrice: '100.00',
          purchasePrice: '50.00',
          costingMethod: 'FIFO',
          availableQty: '50.000',
          fefoEnabled: true, // written while the capability was on, per the test's premise
          createdBy: 1,
        })
        .returning();
      itemId = item!.id;

      await db.insert(inventoryFifoLayers).values({
        tenantId: TENANT_A,
        itemId,
        warehouseId,
        receivedAt: new Date(),
        originalQty: '50.000',
        remainingQty: '50.000',
        unitCost: '10.00',
        sourceLedgerId: 999905,
        batchNumber: 'D4-BATCH',
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    });

    afterAll(async () => {
      await db.delete(inventoryFifoLayers).where(eq(inventoryFifoLayers.itemId, itemId));
      await db.delete(items).where(eq(items.tenantId, TENANT_A));
      await db.delete(warehouses).where(eq(warehouses.tenantId, TENANT_A));
      await db.delete(branches).where(eq(branches.tenantId, TENANT_A));
      await db.delete(featureFlags).where(inArray(featureFlags.tenantId, [TENANT_A, TENANT_B]));
      redis.disconnect();
    });

    it('1. tenant isolation: Tenant A (override on) and Tenant B (override off) resolve independently', async () => {
      const [resultA, resultB] = await Promise.all([
        isCapabilityEnabled('INVENTORY_BATCH', TENANT_A, db, redis),
        isCapabilityEnabled('INVENTORY_BATCH', TENANT_B, db, redis),
      ]);
      expect(resultA).toBe(true);
      expect(resultB).toBe(false);
    });

    it("2. disabling the capability for Tenant A does not reset the existing item's fefoEnabled column", async () => {
      // Flip Tenant A's override off — simulates the tenant's plan losing the capability.
      await db
        .update(featureFlags)
        .set({ enabled: false })
        .where(
          and(
            eq(featureFlags.tenantId, TENANT_A),
            eq(featureFlags.flagKey, 'inventory.batch.enabled')
          )
        );
      await invalidate(TENANT_A);

      await expect(isCapabilityEnabled('INVENTORY_BATCH', TENANT_A, db, redis)).resolves.toBe(
        false
      );

      const [row] = await db
        .select({ fefoEnabled: items.fefoEnabled })
        .from(items)
        .where(eq(items.id, itemId));
      expect(row!.fefoEnabled).toBe(true); // untouched — D4
    });

    it('3. FEFO consumption still honors fefoEnabled=true while the capability is currently disabled for the tenant', async () => {
      // Precondition from test 2: capability is now OFF for Tenant A, item is still fefoEnabled.
      const totalCogs = await ValuationService.consumeForStockOut(db, {
        tenantId: TENANT_A,
        itemId,
        warehouseId,
        quantity: 10,
      });
      expect(totalCogs).toBeGreaterThan(0); // consumption succeeded, engine didn't refuse/no-op

      const [layer] = await db
        .select({ remainingQty: inventoryFifoLayers.remainingQty })
        .from(inventoryFifoLayers)
        .where(eq(inventoryFifoLayers.itemId, itemId));
      expect(parseFloat(layer!.remainingQty)).toBe(40); // layer was drawn down normally
    });

    it("4. re-enabling the capability leaves the item's configuration exactly as it was (no rewrite on toggle)", async () => {
      await db
        .update(featureFlags)
        .set({ enabled: true })
        .where(
          and(
            eq(featureFlags.tenantId, TENANT_A),
            eq(featureFlags.flagKey, 'inventory.batch.enabled')
          )
        );
      await invalidate(TENANT_A);

      await expect(isCapabilityEnabled('INVENTORY_BATCH', TENANT_A, db, redis)).resolves.toBe(true);

      const [row] = await db
        .select({ fefoEnabled: items.fefoEnabled })
        .from(items)
        .where(eq(items.id, itemId));
      expect(row!.fefoEnabled).toBe(true); // still true — never touched across the whole disable/re-enable cycle
    });
  }
);
