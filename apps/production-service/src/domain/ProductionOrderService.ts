import { and, eq, sql, desc, asc, gte, inArray, getTableColumns } from 'drizzle-orm';
import {
  productionOrders,
  productionOrderMaterials,
  productionOrderQualityChecks,
  productionOrderHistory,
  productionOrderOperations,
  routings,
  routingOperations,
  inventoryLedger,
  projectionStockLevel,
  items,
  workCenters,
  outboxEvents,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { ValuationService } from '@erp/sdk';
import { ulid } from 'ulid';
import { BOMService } from './BOMService.js';

export interface ProductionOrderMaterialInput {
  itemId: number;
  variantId?: number | undefined;
  requiredQty: number;
  unitCost: number;
  warehouseId: number;
}

export interface CreateProductionOrderParams {
  tenantId: number;
  orderNumber: string;
  branchId: number;
  warehouseId: number;
  outputItemId: number;
  outputVariantId?: number | undefined;
  workCenterId?: number | undefined;
  orderedQty: number;
  laborCost: number;
  overheadCost: number;
  orderDate: Date;
  expectedDate?: Date | undefined;
  // Either pass materials explicitly, or pass bomId to auto-populate them from a BOM's explode()
  // (scaled to orderedQty) — see BOMService. bomId takes precedence when both are provided.
  materials?: ProductionOrderMaterialInput[] | undefined;
  bomId?: number | undefined;
  // Routing extension — when provided, one production_order_operations row is instantiated per
  // routing_operations row (in sequence), tracked independently of the routing definition itself.
  routingId?: number | undefined;
  notes?: string | undefined;
  createdBy: number;
}

export interface QualityCheckEntry {
  pieceNumber: number;
  result: 'PASS' | 'FAIL' | 'REWORK';
  defectNotes?: string | undefined;
}

export interface CompleteProductionOrderParams {
  tenantId: number;
  receivedQty: number;
  rejectedQty: number;
  scrapQty: number;
  userId: number;
}

// Manufacturing vertical — standalone Production Order: in-house manufacturing. Deliberately
// mirrors JobWorkOrderService's proven structure (status lifecycle, materials issue/complete/
// cancel, ValuationService-backed stock postings, BOM auto-populate, quality checks, history/
// outbox) rather than sharing a base class with it — the two are genuinely different documents
// (no supplierId here; GST job-work provisions treat outsourced material movement differently
// from in-house production), and this codebase doesn't abstract order-type services elsewhere.
export class ProductionOrderService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateProductionOrderParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      const [outputItem] = await trx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.id, params.outputItemId), eq(items.tenantId, params.tenantId)));
      if (!outputItem) throw new NotFoundError('Item', params.outputItemId);

      if (params.workCenterId !== undefined) {
        const [workCenter] = await trx
          .select({ id: workCenters.id })
          .from(workCenters)
          .where(
            and(eq(workCenters.id, params.workCenterId), eq(workCenters.tenantId, params.tenantId))
          );
        if (!workCenter) throw new NotFoundError('WorkCenter', params.workCenterId);
      }

      let routingOps: (typeof routingOperations.$inferSelect)[] = [];
      if (params.routingId !== undefined) {
        const [routing] = await trx
          .select({ id: routings.id })
          .from(routings)
          .where(and(eq(routings.id, params.routingId), eq(routings.tenantId, params.tenantId)));
        if (!routing) throw new NotFoundError('Routing', params.routingId);
        routingOps = await trx
          .select()
          .from(routingOperations)
          .where(eq(routingOperations.routingId, params.routingId))
          .orderBy(asc(routingOperations.sequenceNo));
      }

      const materials =
        params.bomId !== undefined
          ? await this.materialsFromBom(
              trx,
              params.tenantId,
              params.bomId,
              params.orderedQty,
              params.warehouseId
            )
          : (params.materials ?? []);

      const materialsCost = materials.reduce((sum, m) => sum + m.requiredQty * m.unitCost, 0);

      const [row] = await trx
        .insert(productionOrders)
        .values({
          tenantId: params.tenantId,
          orderNumber: params.orderNumber,
          status: 'DRAFT',
          branchId: params.branchId,
          warehouseId: params.warehouseId,
          outputItemId: params.outputItemId,
          outputVariantId: params.outputVariantId,
          workCenterId: params.workCenterId,
          routingId: params.routingId,
          orderedQty: String(params.orderedQty),
          laborCost: String(params.laborCost),
          overheadCost: String(params.overheadCost),
          materialsCost: String(materialsCost),
          orderDate: params.orderDate,
          expectedDate: params.expectedDate,
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning({ id: productionOrders.id });

      if (!row)
        throw new BusinessError(
          'PRODUCTION_ORDER_CREATE_FAILED',
          'Failed to create production order'
        );
      const orderId = row.id;

      if (materials.length > 0) {
        await trx.insert(productionOrderMaterials).values(
          materials.map((m) => ({
            productionOrderId: orderId,
            tenantId: params.tenantId,
            itemId: m.itemId,
            variantId: m.variantId,
            requiredQty: String(m.requiredQty),
            unitCost: String(m.unitCost),
            totalCost: String(m.requiredQty * m.unitCost),
            warehouseId: m.warehouseId,
          }))
        );
      }

      if (routingOps.length > 0) {
        await trx.insert(productionOrderOperations).values(
          routingOps.map((op) => ({
            productionOrderId: orderId,
            tenantId: params.tenantId,
            routingOperationId: op.id,
            sequenceNo: op.sequenceNo,
            operationName: op.operationName,
            workCenterId: op.workCenterId,
            standardTimeMinutes: op.standardTimeMinutes,
            status: 'PENDING' as const,
          }))
        );
      }

      await trx.insert(productionOrderHistory).values({
        productionOrderId: orderId,
        tenantId: params.tenantId,
        action: 'PRODUCTION_ORDER_CREATED',
        toStatus: 'DRAFT',
        performedBy: params.createdBy,
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'PRODUCTION_ORDER_CREATED',
        aggregateType: 'PRODUCTION_ORDER',
        aggregateId: orderId,
        tenantId: params.tenantId,
        payload: { orderId, outputItemId: params.outputItemId },
        published: false,
      });

      return orderId;
    });
  }

  async issueMaterials(id: number, tenantId: number, userId: number): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [order] = await trx
        .select()
        .from(productionOrders)
        .where(and(eq(productionOrders.id, id), eq(productionOrders.tenantId, tenantId)));
      if (!order) throw new NotFoundError('ProductionOrder', id);
      if (order.status !== 'DRAFT')
        throw new BusinessError(
          'INVALID_STATUS',
          `Cannot issue materials for order in status ${order.status}`
        );

      const materials = await trx
        .select()
        .from(productionOrderMaterials)
        .where(eq(productionOrderMaterials.productionOrderId, id));

      for (const mat of materials) {
        const qty = parseFloat(String(mat.requiredQty));
        const result = await trx
          .update(items)
          .set({
            availableQty: sql`${items.availableQty} - ${qty}`,
            version: sql`${items.version} + 1`,
          })
          .where(
            and(
              eq(items.id, mat.itemId),
              eq(items.tenantId, tenantId),
              sql`${items.availableQty} >= ${qty}`
            )
          )
          .returning({ availableQty: items.availableQty });

        if (result.length === 0) {
          throw new BusinessError(
            'INSUFFICIENT_STOCK',
            `Insufficient stock for item ${mat.itemId}`,
            {
              itemId: mat.itemId,
              required: qty,
            }
          );
        }

        const afterQty = parseFloat(String(result[0]!.availableQty));
        const beforeQty = afterQty + qty;

        const totalCogs = await ValuationService.consumeForStockOut(trx, {
          tenantId,
          itemId: mat.itemId,
          variantId: mat.variantId ?? undefined,
          warehouseId: mat.warehouseId,
          quantity: qty,
        });
        const cogsPerUnit = qty > 0 ? Math.round((totalCogs / qty) * 100) / 100 : 0;

        await trx.insert(inventoryLedger).values({
          tenantId,
          itemId: mat.itemId,
          variantId: mat.variantId ?? undefined,
          warehouseId: mat.warehouseId,
          movementType: 'STOCK_OUT',
          quantity: String(qty),
          quantityBefore: String(beforeQty),
          quantityAfter: String(afterQty),
          referenceType: 'PRODUCTION_ORDER',
          referenceId: id,
          unitCost: mat.unitCost,
          cogsPerUnit: String(cogsPerUnit),
          notes: `Material issued for production order #${id}`,
          createdBy: userId,
        });

        await ProductionOrderService.upsertProjection(
          trx,
          tenantId,
          mat.itemId,
          mat.variantId ?? undefined,
          mat.warehouseId,
          -qty
        );

        await trx
          .update(productionOrderMaterials)
          .set({ issuedQty: String(qty) })
          .where(eq(productionOrderMaterials.id, mat.id));
      }

      await trx
        .update(productionOrders)
        .set({
          status: 'MATERIAL_ISSUED',
          issuedAt: new Date(),
          updatedBy: userId,
          updatedAt: new Date(),
          version: sql`${productionOrders.version} + 1`,
        })
        .where(and(eq(productionOrders.id, id), eq(productionOrders.tenantId, tenantId)));

      await trx.insert(productionOrderHistory).values({
        productionOrderId: id,
        tenantId,
        action: 'MATERIALS_ISSUED',
        fromStatus: 'DRAFT',
        toStatus: 'MATERIAL_ISSUED',
        performedBy: userId,
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'PRODUCTION_ORDER_MATERIALS_ISSUED',
        aggregateType: 'PRODUCTION_ORDER',
        aggregateId: id,
        tenantId,
        payload: { orderId: id, materialsCount: materials.length },
        published: false,
      });
    });
  }

  // Routing extension — marks one instantiated operation IN_PROGRESS. Deliberately independent
  // of the order's own status machine (DRAFT/MATERIAL_ISSUED/...) — operations track shop-floor
  // progress through the routing's steps, not the order's higher-level lifecycle; an order can
  // sit in MATERIAL_ISSUED for its entire routing walk before the operator calls
  // startQualityCheck()/complete() explicitly.
  async startOperation(operationId: number, tenantId: number): Promise<void> {
    const [op] = await this.db
      .select()
      .from(productionOrderOperations)
      .where(
        and(
          eq(productionOrderOperations.id, operationId),
          eq(productionOrderOperations.tenantId, tenantId)
        )
      );
    if (!op) throw new NotFoundError('ProductionOrderOperation', operationId);
    if (op.status !== 'PENDING')
      throw new BusinessError(
        'INVALID_OPERATION_STATUS',
        `Cannot start operation in status ${op.status}`
      );

    await this.db
      .update(productionOrderOperations)
      .set({ status: 'IN_PROGRESS', startedAt: new Date() })
      .where(eq(productionOrderOperations.id, operationId));
  }

  async completeOperation(
    operationId: number,
    tenantId: number,
    actualTimeMinutes: number
  ): Promise<void> {
    const [op] = await this.db
      .select()
      .from(productionOrderOperations)
      .where(
        and(
          eq(productionOrderOperations.id, operationId),
          eq(productionOrderOperations.tenantId, tenantId)
        )
      );
    if (!op) throw new NotFoundError('ProductionOrderOperation', operationId);
    if (op.status !== 'IN_PROGRESS')
      throw new BusinessError(
        'INVALID_OPERATION_STATUS',
        `Cannot complete operation in status ${op.status}`
      );

    await this.db
      .update(productionOrderOperations)
      .set({
        status: 'COMPLETED',
        actualTimeMinutes: String(actualTimeMinutes),
        completedAt: new Date(),
      })
      .where(eq(productionOrderOperations.id, operationId));
  }

  async startQualityCheck(id: number, tenantId: number, userId: number): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [order] = await trx
        .select()
        .from(productionOrders)
        .where(and(eq(productionOrders.id, id), eq(productionOrders.tenantId, tenantId)));
      if (!order) throw new NotFoundError('ProductionOrder', id);
      if (!['MATERIAL_ISSUED', 'IN_PROGRESS'].includes(order.status))
        throw new BusinessError(
          'INVALID_STATUS',
          `Cannot start QC for order in status ${order.status}`
        );

      await trx
        .update(productionOrders)
        .set({
          status: 'QUALITY_CHECK',
          updatedBy: userId,
          updatedAt: new Date(),
          version: sql`${productionOrders.version} + 1`,
        })
        .where(and(eq(productionOrders.id, id), eq(productionOrders.tenantId, tenantId)));

      await trx.insert(productionOrderHistory).values({
        productionOrderId: id,
        tenantId,
        action: 'QUALITY_CHECK_STARTED',
        fromStatus: order.status,
        toStatus: 'QUALITY_CHECK',
        performedBy: userId,
      });
    });
  }

  async submitQualityChecks(
    id: number,
    tenantId: number,
    userId: number,
    entries: QualityCheckEntry[]
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [order] = await trx
        .select()
        .from(productionOrders)
        .where(and(eq(productionOrders.id, id), eq(productionOrders.tenantId, tenantId)));
      if (!order) throw new NotFoundError('ProductionOrder', id);
      if (order.status !== 'QUALITY_CHECK')
        throw new BusinessError('INVALID_STATUS', 'Quality check must be in QUALITY_CHECK status');

      await trx.insert(productionOrderQualityChecks).values(
        entries.map((e) => ({
          productionOrderId: id,
          tenantId,
          pieceNumber: e.pieceNumber,
          result: e.result,
          defectNotes: e.defectNotes,
          inspectedBy: userId,
        }))
      );
    });
  }

  async complete(
    id: number,
    tenantId: number,
    params: CompleteProductionOrderParams
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [order] = await trx
        .select()
        .from(productionOrders)
        .where(and(eq(productionOrders.id, id), eq(productionOrders.tenantId, tenantId)));
      if (!order) throw new NotFoundError('ProductionOrder', id);
      if (!['QUALITY_CHECK', 'MATERIAL_ISSUED', 'IN_PROGRESS'].includes(order.status))
        throw new BusinessError(
          'INVALID_STATUS',
          `Cannot complete order in status ${order.status}`
        );

      const materialsCost = parseFloat(String(order.materialsCost));
      const laborCost = parseFloat(String(order.laborCost));
      const overheadCost = parseFloat(String(order.overheadCost));
      const finishedGoodsCost =
        params.receivedQty > 0
          ? (materialsCost + laborCost + overheadCost) / params.receivedQty
          : 0;

      if (params.receivedQty > 0) {
        const stockInResult = await trx
          .update(items)
          .set({
            availableQty: sql`${items.availableQty} + ${params.receivedQty}`,
            version: sql`${items.version} + 1`,
          })
          .where(and(eq(items.id, order.outputItemId), eq(items.tenantId, tenantId)))
          .returning({ availableQty: items.availableQty });

        if (stockInResult.length === 0) {
          throw new NotFoundError('Item', order.outputItemId);
        }

        const afterQty = parseFloat(String(stockInResult[0]!.availableQty));
        const beforeQty = afterQty - params.receivedQty;

        const [ledgerRow] = await trx
          .insert(inventoryLedger)
          .values({
            tenantId,
            itemId: order.outputItemId,
            variantId: order.outputVariantId ?? undefined,
            warehouseId: order.warehouseId,
            movementType: 'STOCK_IN',
            quantity: String(params.receivedQty),
            quantityBefore: String(beforeQty),
            quantityAfter: String(afterQty),
            referenceType: 'PRODUCTION_ORDER',
            referenceId: id,
            unitCost: String(finishedGoodsCost),
            notes: `Finished goods received from production order #${id}`,
            createdBy: params.userId,
          })
          .returning({ id: inventoryLedger.id });

        await ValuationService.applyStockIn(trx, {
          tenantId,
          itemId: order.outputItemId,
          variantId: order.outputVariantId ?? undefined,
          warehouseId: order.warehouseId,
          quantity: params.receivedQty,
          unitCost: finishedGoodsCost,
          qtyBeforeStockIn: beforeQty,
          sourceLedgerId: ledgerRow!.id,
        });

        await ProductionOrderService.upsertProjection(
          trx,
          tenantId,
          order.outputItemId,
          order.outputVariantId ?? undefined,
          order.warehouseId,
          params.receivedQty
        );
      }

      if (params.rejectedQty > 0) {
        await trx.insert(inventoryLedger).values({
          tenantId,
          itemId: order.outputItemId,
          variantId: order.outputVariantId ?? undefined,
          warehouseId: order.warehouseId,
          movementType: 'ADJUSTMENT',
          quantity: String(params.rejectedQty),
          quantityBefore: '0',
          quantityAfter: '0',
          referenceType: 'PRODUCTION_ORDER_DAMAGE',
          referenceId: id,
          notes: `Rejected pieces from production order #${id}`,
          createdBy: params.userId,
        });
      }

      if (params.scrapQty > 0) {
        await trx.insert(inventoryLedger).values({
          tenantId,
          itemId: order.outputItemId,
          variantId: order.outputVariantId ?? undefined,
          warehouseId: order.warehouseId,
          movementType: 'ADJUSTMENT',
          quantity: String(params.scrapQty),
          quantityBefore: '0',
          quantityAfter: '0',
          referenceType: 'PRODUCTION_ORDER_SCRAP',
          referenceId: id,
          notes: `Scrap from production order #${id}`,
          createdBy: params.userId,
        });
      }

      await trx
        .update(productionOrders)
        .set({
          status: 'COMPLETED',
          receivedQty: String(params.receivedQty),
          rejectedQty: String(params.rejectedQty),
          scrapQty: String(params.scrapQty),
          finishedGoodsCost: String(finishedGoodsCost),
          completedAt: new Date(),
          updatedBy: params.userId,
          updatedAt: new Date(),
          version: sql`${productionOrders.version} + 1`,
        })
        .where(and(eq(productionOrders.id, id), eq(productionOrders.tenantId, tenantId)));

      await trx.insert(productionOrderHistory).values({
        productionOrderId: id,
        tenantId,
        action: 'PRODUCTION_ORDER_COMPLETED',
        fromStatus: order.status,
        toStatus: 'COMPLETED',
        performedBy: params.userId,
        notes: `Received: ${params.receivedQty}, Rejected: ${params.rejectedQty}, Scrap: ${params.scrapQty}`,
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'PRODUCTION_ORDER_COMPLETED',
        aggregateType: 'PRODUCTION_ORDER',
        aggregateId: id,
        tenantId,
        payload: {
          orderId: id,
          outputItemId: order.outputItemId,
          receivedQty: params.receivedQty,
          rejectedQty: params.rejectedQty,
          finishedGoodsCost,
        },
        published: false,
      });
    });
  }

  async cancel(id: number, tenantId: number, userId: number, reason: string): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [order] = await trx
        .select()
        .from(productionOrders)
        .where(and(eq(productionOrders.id, id), eq(productionOrders.tenantId, tenantId)));
      if (!order) throw new NotFoundError('ProductionOrder', id);
      if (['COMPLETED', 'CANCELLED'].includes(order.status))
        throw new BusinessError('INVALID_STATUS', `Cannot cancel order in status ${order.status}`);

      if (order.status !== 'DRAFT') {
        const materials = await trx
          .select()
          .from(productionOrderMaterials)
          .where(eq(productionOrderMaterials.productionOrderId, id));

        for (const mat of materials) {
          const issuedQty = parseFloat(String(mat.issuedQty));
          if (issuedQty > 0) {
            await trx
              .update(items)
              .set({
                availableQty: sql`${items.availableQty} + ${issuedQty}`,
                version: sql`${items.version} + 1`,
              })
              .where(and(eq(items.id, mat.itemId), eq(items.tenantId, tenantId)));

            await trx.insert(inventoryLedger).values({
              tenantId,
              itemId: mat.itemId,
              variantId: mat.variantId ?? undefined,
              warehouseId: mat.warehouseId,
              movementType: 'STOCK_IN',
              quantity: String(issuedQty),
              quantityBefore: '0',
              quantityAfter: '0',
              referenceType: 'PRODUCTION_ORDER_CANCEL',
              referenceId: id,
              notes: `Material returned — production order #${id} cancelled`,
              createdBy: userId,
            });
          }
        }
      }

      await trx
        .update(productionOrders)
        .set({
          status: 'CANCELLED',
          cancellationReason: reason,
          cancelledAt: new Date(),
          updatedBy: userId,
          updatedAt: new Date(),
          version: sql`${productionOrders.version} + 1`,
        })
        .where(and(eq(productionOrders.id, id), eq(productionOrders.tenantId, tenantId)));

      await trx.insert(productionOrderHistory).values({
        productionOrderId: id,
        tenantId,
        action: 'PRODUCTION_ORDER_CANCELLED',
        fromStatus: order.status,
        toStatus: 'CANCELLED',
        performedBy: userId,
        notes: reason,
      });
    });
  }

  async getWithDetails(id: number, tenantId: number): Promise<unknown> {
    const [order] = await this.db
      .select({
        ...getTableColumns(productionOrders),
        outputItemName: items.name,
      })
      .from(productionOrders)
      .leftJoin(
        items,
        and(eq(productionOrders.outputItemId, items.id), eq(items.tenantId, tenantId))
      )
      .where(and(eq(productionOrders.id, id), eq(productionOrders.tenantId, tenantId)));
    if (!order) throw new NotFoundError('ProductionOrder', id);

    const materials = await this.db
      .select({
        ...getTableColumns(productionOrderMaterials),
        itemName: items.name,
      })
      .from(productionOrderMaterials)
      .leftJoin(items, eq(productionOrderMaterials.itemId, items.id))
      .where(eq(productionOrderMaterials.productionOrderId, id));

    const qualityChecks = await this.db
      .select()
      .from(productionOrderQualityChecks)
      .where(
        and(
          eq(productionOrderQualityChecks.productionOrderId, id),
          eq(productionOrderQualityChecks.tenantId, tenantId)
        )
      );

    const history = await this.db
      .select()
      .from(productionOrderHistory)
      .where(
        and(
          eq(productionOrderHistory.productionOrderId, id),
          eq(productionOrderHistory.tenantId, tenantId)
        )
      )
      .orderBy(desc(productionOrderHistory.createdAt));

    const operations = await this.db
      .select()
      .from(productionOrderOperations)
      .where(
        and(
          eq(productionOrderOperations.productionOrderId, id),
          eq(productionOrderOperations.tenantId, tenantId)
        )
      )
      .orderBy(asc(productionOrderOperations.sequenceNo));

    return { ...order, materials, qualityChecks, history, operations };
  }

  async list(
    tenantId: number,
    filters: { status?: string; page: number; pageSize: number }
  ): Promise<unknown[]> {
    const conditions = [eq(productionOrders.tenantId, tenantId)];
    if (filters.status) conditions.push(eq(productionOrders.status, filters.status as never));

    return this.db
      .select({
        ...getTableColumns(productionOrders),
        outputItemName: items.name,
      })
      .from(productionOrders)
      .leftJoin(
        items,
        and(eq(productionOrders.outputItemId, items.id), eq(items.tenantId, tenantId))
      )
      .where(and(...conditions))
      .orderBy(desc(productionOrders.orderDate), desc(productionOrders.id))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);
  }

  async getDashboardStats(
    tenantId: number
  ): Promise<{ pending: number; overdue: number; completedToday: number }> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const inProgress = await this.db
      .select({ id: productionOrders.id, expectedDate: productionOrders.expectedDate })
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.tenantId, tenantId),
          sql`${productionOrders.status} IN ('MATERIAL_ISSUED', 'IN_PROGRESS', 'QUALITY_CHECK')`
        )
      );

    const overdue = inProgress.filter(
      (o) => o.expectedDate && new Date(o.expectedDate) < now
    ).length;

    const completedToday = await this.db
      .select({ id: productionOrders.id })
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.tenantId, tenantId),
          eq(productionOrders.status, 'COMPLETED'),
          gte(productionOrders.completedAt, todayStart)
        )
      );

    return { pending: inProgress.length, overdue, completedToday: completedToday.length };
  }

  private static async upsertProjection(
    trx: ErpDatabase,
    tenantId: number,
    itemId: number,
    variantId: number | undefined,
    warehouseId: number,
    availableDelta: number
  ): Promise<void> {
    await trx
      .insert(projectionStockLevel)
      .values({
        tenantId,
        itemId,
        variantId,
        warehouseId,
        availableQty: String(Math.max(0, availableDelta)),
        reservedQty: '0',
        lastMovementAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          projectionStockLevel.tenantId,
          projectionStockLevel.itemId,
          projectionStockLevel.warehouseId,
          projectionStockLevel.variantId,
        ],
        set: {
          availableQty: sql`projection_stock_level.available_qty + ${availableDelta}`,
          lastMovementAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  private async materialsFromBom(
    trx: ErpDatabase,
    tenantId: number,
    bomId: number,
    orderedQty: number,
    warehouseId: number
  ): Promise<ProductionOrderMaterialInput[]> {
    const bomService = new BOMService(trx);
    const lines = await bomService.explode(bomId, tenantId, orderedQty);
    if (lines.length === 0) return [];

    const itemIds = lines.map((l) => l.componentItemId);
    const itemRows = await trx
      .select({ id: items.id, purchasePrice: items.purchasePrice })
      .from(items)
      .where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)));
    const priceById = new Map(itemRows.map((r) => [r.id, parseFloat(String(r.purchasePrice))]));

    return lines.map((l) => ({
      itemId: l.componentItemId,
      variantId: l.componentVariantId,
      requiredQty: l.requiredQty,
      unitCost: priceById.get(l.componentItemId) ?? 0,
      warehouseId,
    }));
  }
}
