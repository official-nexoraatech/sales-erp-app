import { eq, and, sql, ne } from 'drizzle-orm';
import {
  inventoryLedger,
  projectionStockLevel,
  reconciliationErrors,
  tenants,
} from '@erp/db';
import { createLogger } from '@erp/logger';
import type { ErpDatabase } from '@erp/db';

const logger = createLogger({ serviceName: 'inventory-service', level: 'info' });

/**
 * Nightly reconciliation: sum inventory_ledger movements per (tenant, item, warehouse)
 * and compare against projection_stock_level. Flag discrepancies.
 *
 * Safe to run multiple times — existing unresolved errors are not duplicated.
 */
export async function runReconciliation(db: ErpDatabase): Promise<{
  checked: number;
  mismatches: number;
}> {
  logger.info({}, 'Starting nightly inventory reconciliation');

  // Compute ledger sums: STOCK_IN, TRANSFER_IN, OPENING, RESERVATION_RELEASE → positive
  // STOCK_OUT, TRANSFER_OUT, RESERVATION → negative
  const ledgerSums = await db.execute<{
    tenant_id: number;
    item_id: number;
    warehouse_id: number;
    ledger_sum: string;
  }>(sql`
    SELECT
      tenant_id,
      item_id,
      warehouse_id,
      SUM(
        CASE
          WHEN movement_type IN ('STOCK_IN', 'TRANSFER_IN', 'OPENING', 'RESERVATION_RELEASE', 'ADJUSTMENT')
            THEN quantity
          WHEN movement_type IN ('STOCK_OUT', 'TRANSFER_OUT', 'RESERVATION')
            THEN -quantity
          ELSE 0
        END
      ) AS ledger_sum
    FROM inventory_ledger
    GROUP BY tenant_id, item_id, warehouse_id
  `);

  const rows = ledgerSums as Array<{
    tenant_id: number;
    item_id: number;
    warehouse_id: number;
    ledger_sum: string;
  }>;

  let checked = 0;
  let mismatches = 0;

  for (const row of rows) {
    checked++;
    const [projection] = await db
      .select({ availableQty: projectionStockLevel.availableQty })
      .from(projectionStockLevel)
      .where(
        and(
          eq(projectionStockLevel.tenantId, row.tenant_id),
          eq(projectionStockLevel.itemId, row.item_id),
          eq(projectionStockLevel.warehouseId, row.warehouse_id)
        )
      );

    const ledgerVal = parseFloat(row.ledger_sum ?? '0');
    const projectionVal = parseFloat(projection?.availableQty ?? '0');
    const variance = ledgerVal - projectionVal;

    if (Math.abs(variance) > 0.001) {
      mismatches++;

      // Upsert reconciliation error (don't duplicate unresolved ones)
      const existing = await db
        .select({ id: reconciliationErrors.id })
        .from(reconciliationErrors)
        .where(
          and(
            eq(reconciliationErrors.tenantId, row.tenant_id),
            eq(reconciliationErrors.itemId, row.item_id),
            eq(reconciliationErrors.warehouseId, row.warehouse_id),
            sql`${reconciliationErrors.resolvedAt} IS NULL`
          )
        );

      if (existing.length === 0) {
        await db.insert(reconciliationErrors).values({
          tenantId: row.tenant_id,
          itemId: row.item_id,
          warehouseId: row.warehouse_id,
          ledgerSum: String(ledgerVal),
          projectionQty: String(projectionVal),
          variance: String(variance),
        });

        logger.warn(
          {
            tenantId: row.tenant_id,
            itemId: row.item_id,
            warehouseId: row.warehouse_id,
            ledgerSum: ledgerVal,
            projectionQty: projectionVal,
            variance,
          },
          'Inventory reconciliation mismatch detected'
        );
      }
    }
  }

  logger.info({ checked, mismatches }, 'Inventory reconciliation complete');
  return { checked, mismatches };
}
