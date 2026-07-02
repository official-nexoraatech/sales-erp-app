import { and, eq, sql, desc, gte } from 'drizzle-orm';
import {
  jobWorkOrders,
  jobWorkOrderMaterials,
  jobWorkOrderQualityChecks,
  jobWorkOrderHistory,
  inventoryLedger,
  items,
  outboxEvents,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { ulid } from 'ulid';

export interface CreateJobWorkOrderParams {
  tenantId: number;
  supplierId: number;
  branchId: number;
  warehouseId: number;
  outputItemId: number;
  outputVariantId?: number | undefined;
  orderedQty: number;
  jobWorkRate: number;
  orderDate: Date;
  expectedDate?: Date | undefined;
  materials: Array<{
    itemId: number;
    variantId?: number | undefined;
    requiredQty: number;
    unitCost: number;
    warehouseId: number;
  }>;
  notes?: string | undefined;
  createdBy: number;
}

export interface QualityCheckEntry {
  pieceNumber: number;
  result: 'PASS' | 'FAIL' | 'REWORK';
  defectNotes?: string | undefined;
}

export interface CompleteJobWorkOrderParams {
  tenantId: number;
  receivedQty: number;
  rejectedQty: number;
  scrapQty: number;
  userId: number;
}

export class JobWorkOrderService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateJobWorkOrderParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      const materialsCost = params.materials.reduce(
        (sum, m) => sum + m.requiredQty * m.unitCost,
        0
      );

      const [row] = await trx
        .insert(jobWorkOrders)
        .values({
          tenantId: params.tenantId,
          status: 'DRAFT',
          supplierId: params.supplierId,
          branchId: params.branchId,
          warehouseId: params.warehouseId,
          outputItemId: params.outputItemId,
          outputVariantId: params.outputVariantId,
          orderedQty: String(params.orderedQty),
          jobWorkRate: String(params.jobWorkRate),
          jobWorkCharges: String(params.orderedQty * params.jobWorkRate),
          materialsCost: String(materialsCost),
          orderDate: params.orderDate,
          expectedDate: params.expectedDate,
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning({ id: jobWorkOrders.id });

      if (!row) throw new BusinessError('JOB_WORK_CREATE_FAILED', 'Failed to create job work order');
      const orderId = row.id;

      if (params.materials.length > 0) {
        await trx.insert(jobWorkOrderMaterials).values(
          params.materials.map((m) => ({
            jobWorkOrderId: orderId,
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

      await trx.insert(jobWorkOrderHistory).values({
        jobWorkOrderId: orderId,
        tenantId: params.tenantId,
        action: 'JOB_WORK_ORDER_CREATED',
        toStatus: 'DRAFT',
        performedBy: params.createdBy,
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'JOB_WORK_ORDER_CREATED',
        aggregateType: 'JOB_WORK_ORDER',
        aggregateId: orderId,
        tenantId: params.tenantId,
        payload: { orderId, supplierId: params.supplierId, outputItemId: params.outputItemId },
        published: false,
      });

      return orderId;
    });
  }

  async issueMaterials(id: number, tenantId: number, userId: number): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [order] = await trx
        .select()
        .from(jobWorkOrders)
        .where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.tenantId, tenantId)));
      if (!order) throw new NotFoundError('JobWorkOrder', id);
      if (order.status !== 'DRAFT')
        throw new BusinessError('INVALID_STATUS', `Cannot issue materials for order in status ${order.status}`);

      const materials = await trx
        .select()
        .from(jobWorkOrderMaterials)
        .where(eq(jobWorkOrderMaterials.jobWorkOrderId, id));

      // Deduct each material from stock atomically
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
          .returning({ id: items.id });

        if (result.length === 0) {
          throw new BusinessError(
            'INSUFFICIENT_STOCK',
            `Insufficient stock for item ${mat.itemId}`,
            { itemId: mat.itemId, required: qty }
          );
        }

        await trx.insert(inventoryLedger).values({
          tenantId,
          itemId: mat.itemId,
          variantId: mat.variantId ?? undefined,
          warehouseId: mat.warehouseId,
          movementType: 'STOCK_OUT',
          quantity: String(qty),
          quantityBefore: '0',
          quantityAfter: '0',
          referenceType: 'JOB_WORK_ORDER',
          referenceId: id,
          unitCost: mat.unitCost,
          notes: `Material issued for job work order #${id}`,
          createdBy: userId,
        });

        await trx
          .update(jobWorkOrderMaterials)
          .set({ issuedQty: String(qty) })
          .where(eq(jobWorkOrderMaterials.id, mat.id));
      }

      await trx
        .update(jobWorkOrders)
        .set({
          status: 'MATERIAL_ISSUED',
          issuedAt: new Date(),
          updatedBy: userId,
          updatedAt: new Date(),
          version: sql`${jobWorkOrders.version} + 1`,
        })
        .where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.tenantId, tenantId)));

      await trx.insert(jobWorkOrderHistory).values({
        jobWorkOrderId: id,
        tenantId,
        action: 'MATERIALS_ISSUED',
        fromStatus: 'DRAFT',
        toStatus: 'MATERIAL_ISSUED',
        performedBy: userId,
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'JOB_WORK_MATERIALS_ISSUED',
        aggregateType: 'JOB_WORK_ORDER',
        aggregateId: id,
        tenantId,
        payload: { orderId: id, materialsCount: materials.length },
        published: false,
      });
    });
  }

  async startQualityCheck(id: number, tenantId: number, userId: number): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [order] = await trx
        .select()
        .from(jobWorkOrders)
        .where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.tenantId, tenantId)));
      if (!order) throw new NotFoundError('JobWorkOrder', id);
      if (!['MATERIAL_ISSUED', 'IN_PROGRESS'].includes(order.status))
        throw new BusinessError('INVALID_STATUS', `Cannot start QC for order in status ${order.status}`);

      await trx
        .update(jobWorkOrders)
        .set({
          status: 'QUALITY_CHECK',
          updatedBy: userId,
          updatedAt: new Date(),
          version: sql`${jobWorkOrders.version} + 1`,
        })
        .where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.tenantId, tenantId)));

      await trx.insert(jobWorkOrderHistory).values({
        jobWorkOrderId: id,
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
        .from(jobWorkOrders)
        .where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.tenantId, tenantId)));
      if (!order) throw new NotFoundError('JobWorkOrder', id);
      if (order.status !== 'QUALITY_CHECK')
        throw new BusinessError('INVALID_STATUS', 'Quality check must be in QUALITY_CHECK status');

      await trx.insert(jobWorkOrderQualityChecks).values(
        entries.map((e) => ({
          jobWorkOrderId: id,
          tenantId,
          pieceNumber: e.pieceNumber,
          result: e.result,
          defectNotes: e.defectNotes,
          inspectedBy: userId,
        }))
      );
    });
  }

  async complete(id: number, tenantId: number, params: CompleteJobWorkOrderParams): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [order] = await trx
        .select()
        .from(jobWorkOrders)
        .where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.tenantId, tenantId)));
      if (!order) throw new NotFoundError('JobWorkOrder', id);
      if (!['QUALITY_CHECK', 'MATERIAL_ISSUED', 'IN_PROGRESS'].includes(order.status))
        throw new BusinessError('INVALID_STATUS', `Cannot complete order in status ${order.status}`);

      const materialsCost = parseFloat(String(order.materialsCost));
      const jobWorkCharges = parseFloat(String(order.jobWorkCharges));
      const finishedGoodsCost =
        params.receivedQty > 0
          ? (materialsCost + jobWorkCharges) / params.receivedQty
          : 0;

      // Add received finished goods to stock
      if (params.receivedQty > 0) {
        await trx
          .update(items)
          .set({
            availableQty: sql`${items.availableQty} + ${params.receivedQty}`,
            version: sql`${items.version} + 1`,
          })
          .where(and(eq(items.id, order.outputItemId), eq(items.tenantId, tenantId)));

        await trx.insert(inventoryLedger).values({
          tenantId,
          itemId: order.outputItemId,
          variantId: order.outputVariantId ?? undefined,
          warehouseId: order.warehouseId,
          movementType: 'STOCK_IN',
          quantity: String(params.receivedQty),
          quantityBefore: '0',
          quantityAfter: '0',
          referenceType: 'JOB_WORK_ORDER',
          referenceId: id,
          unitCost: String(finishedGoodsCost),
          notes: `Finished goods received from job work order #${id}`,
          createdBy: params.userId,
        });
      }

      // Rejected → DAMAGE entry in ledger (no stock impact — already deducted)
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
          referenceType: 'JOB_WORK_DAMAGE',
          referenceId: id,
          notes: `Rejected pieces from job work order #${id}`,
          createdBy: params.userId,
        });
      }

      // Scrap → SCRAP entry
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
          referenceType: 'JOB_WORK_SCRAP',
          referenceId: id,
          notes: `Scrap from job work order #${id}`,
          createdBy: params.userId,
        });
      }

      await trx
        .update(jobWorkOrders)
        .set({
          status: 'COMPLETED',
          receivedQty: String(params.receivedQty),
          rejectedQty: String(params.rejectedQty),
          scrapQty: String(params.scrapQty),
          finishedGoodsCost: String(finishedGoodsCost),
          completedAt: new Date(),
          updatedBy: params.userId,
          updatedAt: new Date(),
          version: sql`${jobWorkOrders.version} + 1`,
        })
        .where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.tenantId, tenantId)));

      await trx.insert(jobWorkOrderHistory).values({
        jobWorkOrderId: id,
        tenantId,
        action: 'JOB_WORK_COMPLETED',
        fromStatus: order.status,
        toStatus: 'COMPLETED',
        performedBy: params.userId,
        notes: `Received: ${params.receivedQty}, Rejected: ${params.rejectedQty}, Scrap: ${params.scrapQty}`,
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'JOB_WORK_ORDER_COMPLETED',
        aggregateType: 'JOB_WORK_ORDER',
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
        .from(jobWorkOrders)
        .where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.tenantId, tenantId)));
      if (!order) throw new NotFoundError('JobWorkOrder', id);
      if (['COMPLETED', 'CANCELLED'].includes(order.status))
        throw new BusinessError('INVALID_STATUS', `Cannot cancel order in status ${order.status}`);

      // If materials were issued, restore stock
      if (order.status !== 'DRAFT') {
        const materials = await trx
          .select()
          .from(jobWorkOrderMaterials)
          .where(eq(jobWorkOrderMaterials.jobWorkOrderId, id));

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
              referenceType: 'JOB_WORK_CANCEL',
              referenceId: id,
              notes: `Material returned — job work order #${id} cancelled`,
              createdBy: userId,
            });
          }
        }
      }

      await trx
        .update(jobWorkOrders)
        .set({
          status: 'CANCELLED',
          cancellationReason: reason,
          cancelledAt: new Date(),
          updatedBy: userId,
          updatedAt: new Date(),
          version: sql`${jobWorkOrders.version} + 1`,
        })
        .where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.tenantId, tenantId)));

      await trx.insert(jobWorkOrderHistory).values({
        jobWorkOrderId: id,
        tenantId,
        action: 'JOB_WORK_CANCELLED',
        fromStatus: order.status,
        toStatus: 'CANCELLED',
        performedBy: userId,
        notes: reason,
      });
    });
  }

  async getWithDetails(id: number, tenantId: number): Promise<unknown> {
    const [order] = await this.db
      .select()
      .from(jobWorkOrders)
      .where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.tenantId, tenantId)));
    if (!order) throw new NotFoundError('JobWorkOrder', id);

    const materials = await this.db
      .select()
      .from(jobWorkOrderMaterials)
      .where(eq(jobWorkOrderMaterials.jobWorkOrderId, id));

    const qualityChecks = await this.db
      .select()
      .from(jobWorkOrderQualityChecks)
      .where(and(eq(jobWorkOrderQualityChecks.jobWorkOrderId, id), eq(jobWorkOrderQualityChecks.tenantId, tenantId)));

    const history = await this.db
      .select()
      .from(jobWorkOrderHistory)
      .where(and(eq(jobWorkOrderHistory.jobWorkOrderId, id), eq(jobWorkOrderHistory.tenantId, tenantId)))
      .orderBy(desc(jobWorkOrderHistory.createdAt));

    return { ...order, materials, qualityChecks, history };
  }

  async listInProgress(tenantId: number): Promise<unknown[]> {
    const today = new Date();
    return this.db
      .select()
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.tenantId, tenantId),
          sql`${jobWorkOrders.status} IN ('MATERIAL_ISSUED', 'IN_PROGRESS', 'QUALITY_CHECK')`
        )
      )
      .orderBy(desc(jobWorkOrders.orderDate));
  }

  async list(
    tenantId: number,
    filters: { status?: string; supplierId?: number; page: number; pageSize: number }
  ): Promise<unknown[]> {
    const conditions = [eq(jobWorkOrders.tenantId, tenantId)];
    if (filters.status) conditions.push(eq(jobWorkOrders.status, filters.status as never));
    if (filters.supplierId) conditions.push(eq(jobWorkOrders.supplierId, filters.supplierId));

    return this.db
      .select()
      .from(jobWorkOrders)
      .where(and(...conditions))
      .orderBy(desc(jobWorkOrders.orderDate))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);
  }

  async getDashboardStats(tenantId: number): Promise<{
    pending: number;
    overdue: number;
    completedToday: number;
  }> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const inProgress = await this.db
      .select({ id: jobWorkOrders.id, expectedDate: jobWorkOrders.expectedDate })
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.tenantId, tenantId),
          sql`${jobWorkOrders.status} IN ('MATERIAL_ISSUED', 'IN_PROGRESS', 'QUALITY_CHECK')`
        )
      );

    const overdue = inProgress.filter(
      (o) => o.expectedDate && new Date(o.expectedDate) < now
    ).length;

    const completedToday = await this.db
      .select({ id: jobWorkOrders.id })
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.tenantId, tenantId),
          eq(jobWorkOrders.status, 'COMPLETED'),
          gte(jobWorkOrders.completedAt, todayStart)
        )
      );

    return {
      pending: inProgress.length,
      overdue,
      completedToday: completedToday.length,
    };
  }
}
