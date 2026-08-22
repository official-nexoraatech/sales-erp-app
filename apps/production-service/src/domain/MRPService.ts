import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  items,
  boms,
  bomLines,
  productionOrders,
  purchaseOrders,
  purchaseOrderLines,
  projectionStockLevel,
  purchaseRequisitions,
  purchaseRequisitionLines,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError } from '@erp/types';

export interface DemandLine {
  itemId: number;
  variantId?: number | undefined;
  requiredQty: number;
}

export interface ShortageLine {
  itemId: number;
  itemName: string;
  itemCode: string | null;
  variantId?: number | undefined;
  grossQty: number;
  onHandQty: number;
  onOrderQty: number;
  netQty: number;
}

export interface MRPResult {
  toProduce: ShortageLine[];
  toPurchase: ShortageLine[];
}

export interface CreateRequisitionFromShortagesParams {
  tenantId: number;
  branchId: number;
  lines: Array<{
    itemId: number;
    qty: number;
    unitId?: number | undefined;
    estimatedUnitPrice?: number | undefined;
  }>;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | undefined;
  requiredByDate?: Date | undefined;
  requestedBy: number;
}

interface Accumulated {
  variantId?: number | undefined;
  grossQty: number;
  onHandQty: number;
  onOrderQty: number;
  netQty: number;
}

// Manufacturing vertical — MRP: nets planned demand for a finished item through its (possibly
// multi-level) BOM against on-hand stock, open Purchase Orders, and open Production Orders — the
// standard "low-level-code" MRP netting pattern (BOMService.explode() flattens unconditionally;
// this stops descending as soon as a level is fully covered by stock/open orders). Stateless —
// no persisted "MRP run" entity, matching ReorderService's own compute-and-return pattern
// (getReorderRequired()) rather than inventing a new domain concept for this.
const MAX_MRP_DEPTH = 20;

export class MRPService {
  constructor(private db: ErpDatabase) {}

  async computeRequirements(
    tenantId: number,
    demandLines: DemandLine[],
    warehouseId?: number
  ): Promise<MRPResult> {
    if (demandLines.length === 0) {
      throw new BusinessError('MRP_NO_DEMAND', 'At least one demand line is required');
    }

    const itemIds = [...new Set(demandLines.map((d) => d.itemId))];
    const itemRows = await this.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)));
    const foundIds = new Set(itemRows.map((r) => r.id));
    const missingItemId = itemIds.find((id) => !foundIds.has(id));
    if (missingItemId !== undefined) {
      throw new BusinessError('ITEM_NOT_FOUND', `Item ${missingItemId} not found`);
    }

    const toProduce = new Map<string, Accumulated>();
    const toPurchase = new Map<string, Accumulated>();

    for (const line of demandLines) {
      await this.net(
        tenantId,
        line.itemId,
        line.variantId,
        line.requiredQty,
        warehouseId,
        toProduce,
        toPurchase,
        0
      );
    }

    const [produceRows, purchaseRows] = await Promise.all([
      this.enrich(tenantId, toProduce),
      this.enrich(tenantId, toPurchase),
    ]);

    return { toProduce: produceRows, toPurchase: purchaseRows };
  }

  private async net(
    tenantId: number,
    itemId: number,
    variantId: number | undefined,
    grossQty: number,
    warehouseId: number | undefined,
    toProduce: Map<string, Accumulated>,
    toPurchase: Map<string, Accumulated>,
    depth: number
  ): Promise<void> {
    if (depth >= MAX_MRP_DEPTH) {
      throw new BusinessError(
        'MRP_TOO_DEEP',
        `MRP explosion exceeds ${MAX_MRP_DEPTH} levels while netting item ${itemId} — likely a BOM cycle`
      );
    }

    const onHandQty = await this.getOnHand(tenantId, itemId, warehouseId);

    const [activeBom] = await this.db
      .select({ id: boms.id, outputQty: boms.outputQty })
      .from(boms)
      .where(
        and(eq(boms.tenantId, tenantId), eq(boms.finishedItemId, itemId), eq(boms.isActive, true))
      );

    const onOrderQty = activeBom
      ? await this.getOpenProductionOrderQty(tenantId, itemId)
      : await this.getOpenPurchaseOrderQty(tenantId, itemId);

    const netQty = Math.max(0, Math.round((grossQty - onHandQty - onOrderQty) * 1000) / 1000);
    if (netQty <= 0) return;

    const key = `${itemId}:${variantId ?? ''}`;
    const target = activeBom ? toProduce : toPurchase;
    const existing = target.get(key);
    target.set(key, {
      variantId,
      grossQty: Math.round(((existing?.grossQty ?? 0) + grossQty) * 1000) / 1000,
      onHandQty: existing ? existing.onHandQty : onHandQty,
      onOrderQty: existing ? existing.onOrderQty : onOrderQty,
      netQty: Math.round(((existing?.netQty ?? 0) + netQty) * 1000) / 1000,
    });

    if (!activeBom) return;

    const lines = await this.db.select().from(bomLines).where(eq(bomLines.bomId, activeBom.id));
    const bomOutputQty = parseFloat(String(activeBom.outputQty));
    const scaleFactor = bomOutputQty > 0 ? netQty / bomOutputQty : 0;

    for (const l of lines) {
      const quantityPerOutput = parseFloat(String(l.quantityPerOutput));
      const scrapPercent = parseFloat(String(l.scrapPercent ?? '0'));
      const childGrossQty = quantityPerOutput * scaleFactor * (1 + scrapPercent / 100);
      await this.net(
        tenantId,
        l.componentItemId,
        l.componentVariantId ?? undefined,
        childGrossQty,
        warehouseId,
        toProduce,
        toPurchase,
        depth + 1
      );
    }
  }

  private async getOnHand(tenantId: number, itemId: number, warehouseId?: number): Promise<number> {
    if (warehouseId !== undefined) {
      const [row] = await this.db
        .select({ availableQty: projectionStockLevel.availableQty })
        .from(projectionStockLevel)
        .where(
          and(
            eq(projectionStockLevel.tenantId, tenantId),
            eq(projectionStockLevel.itemId, itemId),
            eq(projectionStockLevel.warehouseId, warehouseId)
          )
        );
      return row ? parseFloat(String(row.availableQty)) : 0;
    }
    const [row] = await this.db
      .select({ availableQty: items.availableQty })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.tenantId, tenantId)));
    return row ? parseFloat(String(row.availableQty)) : 0;
  }

  private async getOpenProductionOrderQty(tenantId: number, itemId: number): Promise<number> {
    const rows = await this.db
      .select({
        orderedQty: productionOrders.orderedQty,
        receivedQty: productionOrders.receivedQty,
      })
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.tenantId, tenantId),
          eq(productionOrders.outputItemId, itemId),
          sql`${productionOrders.status} NOT IN ('COMPLETED', 'CANCELLED')`
        )
      );
    return rows.reduce(
      (sum, r) =>
        sum + Math.max(0, parseFloat(String(r.orderedQty)) - parseFloat(String(r.receivedQty))),
      0
    );
  }

  private async getOpenPurchaseOrderQty(tenantId: number, itemId: number): Promise<number> {
    const rows = await this.db
      .select({
        orderedQty: purchaseOrderLines.orderedQty,
        receivedQty: purchaseOrderLines.receivedQty,
      })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
      .where(
        and(
          eq(purchaseOrderLines.tenantId, tenantId),
          eq(purchaseOrderLines.itemId, itemId),
          sql`${purchaseOrders.status} NOT IN ('RECEIVED', 'CLOSED', 'CANCELLED')`
        )
      );
    return rows.reduce(
      (sum, r) =>
        sum + Math.max(0, parseFloat(String(r.orderedQty)) - parseFloat(String(r.receivedQty))),
      0
    );
  }

  private async enrich(tenantId: number, map: Map<string, Accumulated>): Promise<ShortageLine[]> {
    if (map.size === 0) return [];
    const itemIds = [...new Set([...map.keys()].map((k) => Number(k.split(':')[0])))];
    const rows = await this.db
      .select({ id: items.id, name: items.name, itemCode: items.itemCode })
      .from(items)
      .where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)));
    const byId = new Map(rows.map((r) => [r.id, r]));

    return [...map.entries()].map(([key, acc]) => {
      const itemId = Number(key.split(':')[0]);
      const item = byId.get(itemId);
      return {
        itemId,
        itemName: item?.name ?? 'Unknown',
        itemCode: item?.itemCode ?? null,
        ...(acc.variantId !== undefined ? { variantId: acc.variantId } : {}),
        grossQty: acc.grossQty,
        onHandQty: acc.onHandQty,
        onOrderQty: acc.onOrderQty,
        netQty: acc.netQty,
      };
    });
  }

  async createRequisitionFromShortages(
    params: CreateRequisitionFromShortagesParams
  ): Promise<number> {
    if (params.lines.length === 0) {
      throw new BusinessError('MRP_NO_SHORTAGE_LINES', 'At least one shortage line is required');
    }

    const itemIds = [...new Set(params.lines.map((l) => l.itemId))];
    const itemRows = await this.db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.tenantId, params.tenantId), inArray(items.id, itemIds)));
    const foundIds = new Set(itemRows.map((r) => r.id));
    const missingItemId = itemIds.find((id) => !foundIds.has(id));
    if (missingItemId !== undefined) {
      throw new BusinessError('ITEM_NOT_FOUND', `Item ${missingItemId} not found`);
    }

    return this.db.transaction(async (trx) => {
      const estimatedTotal = params.lines.reduce(
        (sum, l) => sum + l.qty * (l.estimatedUnitPrice ?? 0),
        0
      );

      const [row] = await trx
        .insert(purchaseRequisitions)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          requisitionNumber: `REQ-MRP-${params.tenantId}-${Date.now()}`,
          priority: params.priority ?? 'MEDIUM',
          status: 'DRAFT',
          requiredByDate: params.requiredByDate,
          estimatedTotal: String(estimatedTotal),
          notes: 'Auto-created from MRP run',
          requestedBy: params.requestedBy,
        })
        .returning({ id: purchaseRequisitions.id });
      if (!row) {
        throw new BusinessError(
          'REQUISITION_CREATE_FAILED',
          'Failed to create requisition from MRP shortages'
        );
      }

      await trx.insert(purchaseRequisitionLines).values(
        params.lines.map((l, i) => ({
          requisitionId: row.id,
          tenantId: params.tenantId,
          lineNumber: i + 1,
          itemId: l.itemId,
          requestedQty: String(l.qty),
          unitId: l.unitId,
          estimatedUnitPrice: String(l.estimatedUnitPrice ?? 0),
        }))
      );

      return row.id;
    });
  }
}
