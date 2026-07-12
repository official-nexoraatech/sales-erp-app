import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import {
  items,
  projectionStockLevel,
  inventoryFifoLayers,
  inventoryWarehouseValuation,
} from '@erp/db';
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

export interface ValuationRow {
  itemId: number;
  costingMethod: 'FIFO' | 'WACC';
  availableQty: string | number;
  waccCost: string | number;
  currentStockValue: string | number;
  warehouseQty: string | number;
}

export interface ValuationLine {
  qty: number;
  unitCost: number;
  totalValue: number;
  estimated?: boolean;
}

// PG-032: pure — unit-tested directly without a DB/Fastify harness (see valuation-line.test.ts).
// No warehouseId → unchanged tenant-wide ratio (byte-for-byte identical to pre-PG-032 behaviour).
// warehouseId + FIFO → true weighted cost from that warehouse's fifo layers (fifoCostByItem).
// warehouseId + WACC → true per-warehouse cost from inventory_warehouse_valuation (waccCostByItem).
// Either lookup missing (not yet backfilled/no movement recorded) → falls back to the tenant-wide
// ratio estimate with `estimated: true`, rather than erroring.
export function computeValuationLine(
  row: ValuationRow,
  warehouseId: number | undefined,
  fifoCostByItem: Map<number, number>,
  waccCostByItem: Map<number, number>
): ValuationLine {
  const overallQty = parseFloat(String(row.availableQty));
  const overallValue = parseFloat(String(row.currentStockValue));
  const qty = parseFloat(String(row.warehouseQty));
  const ratioEstimateCost =
    overallQty > 0 ? overallValue / overallQty : parseFloat(String(row.waccCost));

  let unitCost = ratioEstimateCost;
  let estimated = false;

  if (warehouseId !== undefined) {
    const trueCost =
      row.costingMethod === 'FIFO'
        ? fifoCostByItem.get(row.itemId)
        : waccCostByItem.get(row.itemId);
    if (trueCost !== undefined) {
      unitCost = trueCost;
    } else {
      estimated = true;
    }
  }

  const lineValue = Math.round(qty * unitCost * 100) / 100;
  return {
    qty,
    unitCost: Math.round(unitCost * 100) / 100,
    totalValue: lineValue,
    ...(estimated ? { estimated: true } : {}),
  };
}

// GET /inventory/valuation — Stock Valuation Report (ES-13, warehouse-scoped costing PG-032)
// Note: items.available_qty / current_stock_value / wacc_cost are tenant-wide running totals —
// the source of truth when no warehouseId is passed. When warehouseId is passed, qty comes from
// the warehouse-level projection (real) and unit cost comes from a costing-method-aware true
// per-warehouse source (FIFO layers / inventory_warehouse_valuation) — see computeValuationLine().
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

      // PG-032: fetched once per request (not per item) to avoid N+1 queries — both maps are
      // small (bounded by items actually stocked in this one warehouse).
      const fifoCostByItem = new Map<number, number>();
      const waccCostByItem = new Map<number, number>();

      if (query.warehouseId) {
        const fifoAgg = await ctx.db.raw
          .select({
            itemId: inventoryFifoLayers.itemId,
            totalQty: sql<string>`SUM(${inventoryFifoLayers.remainingQty})`,
            totalValue: sql<string>`SUM(${inventoryFifoLayers.remainingQty} * ${inventoryFifoLayers.unitCost})`,
          })
          .from(inventoryFifoLayers)
          .where(
            and(
              eq(inventoryFifoLayers.tenantId, tenantId),
              eq(inventoryFifoLayers.warehouseId, query.warehouseId),
              sql`${inventoryFifoLayers.remainingQty} > 0`
            )
          )
          .groupBy(inventoryFifoLayers.itemId);
        for (const agg of fifoAgg) {
          const qty = parseFloat(String(agg.totalQty));
          if (qty > 0) fifoCostByItem.set(agg.itemId, parseFloat(String(agg.totalValue)) / qty);
        }

        // Grouped by item (not by variant, matching the rest of this report which is item-level
        // only) — an item split across multiple variant rows in this warehouse has its per-variant
        // stockValue/waccCost combined into one implied weighted cost via SUM(stock_value)/SUM(qty),
        // where each row's own implied qty is stock_value/wacc_cost (see upsertWarehouseWaccOnStockIn
        // in ValuationService.ts for why there's no separate qty column to sum directly).
        const waccRows = await ctx.db.raw
          .select({
            itemId: inventoryWarehouseValuation.itemId,
            waccCost: inventoryWarehouseValuation.waccCost,
            stockValue: inventoryWarehouseValuation.stockValue,
          })
          .from(inventoryWarehouseValuation)
          .where(
            and(
              eq(inventoryWarehouseValuation.tenantId, tenantId),
              eq(inventoryWarehouseValuation.warehouseId, query.warehouseId)
            )
          );
        const waccAgg = new Map<number, { totalValue: number; totalQty: number }>();
        for (const wr of waccRows) {
          const cost = parseFloat(String(wr.waccCost));
          const value = parseFloat(String(wr.stockValue));
          const qty = cost > 0 ? value / cost : 0;
          const acc = waccAgg.get(wr.itemId) ?? { totalValue: 0, totalQty: 0 };
          acc.totalValue += value;
          acc.totalQty += qty;
          waccAgg.set(wr.itemId, acc);
        }
        for (const [itemId, acc] of waccAgg) {
          if (acc.totalQty > 0) waccCostByItem.set(itemId, acc.totalValue / acc.totalQty);
        }
      }

      let totalValue = 0;
      const data = rows.map((r) => {
        const line = computeValuationLine(r, query.warehouseId, fifoCostByItem, waccCostByItem);
        totalValue += line.totalValue;
        return {
          itemId: r.itemId,
          itemCode: r.itemCode,
          itemName: r.itemName,
          costingMethod: r.costingMethod,
          ...line,
        };
      });

      return reply.code(200).send({
        data,
        meta: {
          asOf: query.asOf ?? null,
          warehouseId: query.warehouseId ?? null,
          totalStockValue: Math.round(totalValue * 100) / 100,
        },
      });
    }
  );
}
