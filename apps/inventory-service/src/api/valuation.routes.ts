import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { items, projectionStockLevel } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const ValuationQuery = z.object({
  warehouseId: z.coerce.number().int().positive().optional(),
  // Accepted for API compatibility; valuation reflects current state only —
  // items.current_stock_value/wacc_cost are running totals, not date-versioned,
  // so a true historical "as of" reconstruction isn't supported by this schema.
  asOf: z.string().optional(),
});

// GET /inventory/valuation — Stock Valuation Report (ES-13)
// Note: items.available_qty / current_stock_value / wacc_cost are tracked
// per-item (across all warehouses), not per-warehouse — matches how the rest of
// this codebase tracks live stock counters (see InventoryLedgerService). When
// warehouseId is passed, qty is taken from the warehouse-level projection and
// value is estimated proportionally from the item's overall average cost.
export async function valuationRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/inventory/valuation',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)] },
    async (request, reply) => {
      const ctx = ctxFactory.create({
        tenantId: request.auth.tenantId,
        userId: request.auth.userId,
        correlationId: request.id,
      });
      const query = ValuationQuery.parse(request.query);
      const tenantId = request.auth.tenantId;

      const rows = await ctx.db.raw
        .select({
          itemId: items.id,
          itemCode: items.itemCode,
          itemName: items.name,
          costingMethod: items.costingMethod,
          availableQty: items.availableQty,
          waccCost: items.waccCost,
          currentStockValue: items.currentStockValue,
          warehouseQty: query.warehouseId
            ? sql<string>`COALESCE((
                SELECT SUM(${projectionStockLevel.availableQty})
                FROM ${projectionStockLevel}
                WHERE ${projectionStockLevel.itemId} = ${items.id}
                  AND ${projectionStockLevel.tenantId} = ${tenantId}
                  AND ${projectionStockLevel.warehouseId} = ${query.warehouseId}
              ), 0)`
            : sql<string>`${items.availableQty}`,
        })
        .from(items)
        .where(and(eq(items.tenantId, tenantId), eq(items.trackInventory, true)));

      let totalValue = 0;
      const data = rows.map((r) => {
        const overallQty = parseFloat(String(r.availableQty));
        const overallValue = parseFloat(String(r.currentStockValue));
        const qty = parseFloat(String(r.warehouseQty));
        const unitCost = overallQty > 0 ? overallValue / overallQty : parseFloat(String(r.waccCost));
        const lineValue = Math.round(qty * unitCost * 100) / 100;
        totalValue += lineValue;
        return {
          itemId: r.itemId,
          itemCode: r.itemCode,
          itemName: r.itemName,
          costingMethod: r.costingMethod,
          qty,
          unitCost: Math.round(unitCost * 100) / 100,
          totalValue: lineValue,
        };
      });

      return reply.code(200).send({
        data,
        meta: { asOf: query.asOf ?? null, warehouseId: query.warehouseId ?? null, totalStockValue: Math.round(totalValue * 100) / 100 },
      });
    }
  );
}
