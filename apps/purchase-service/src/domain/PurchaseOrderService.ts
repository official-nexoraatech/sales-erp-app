import { and, eq, sql, desc, lt } from 'drizzle-orm';
import {
  purchaseOrders,
  purchaseOrderLines,
  purchaseOrderHistory,
  outboxEvents,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { GSTCalculator } from './GSTCalculator.js';
import { ulid } from 'ulid';

export interface POLineInput {
  itemId: number;
  variantId?: number | undefined;
  description?: string | undefined;
  orderedQty: number;
  unitId?: number | undefined;
  unitPrice: number;
  discountPct?: number | undefined;
  discountAmount?: number | undefined;
  gstRate: number;
  hsnCode?: string | undefined;
}

export interface CreatePOParams {
  tenantId: number;
  branchId: number;
  warehouseId: number;
  supplierId: number;
  poDate: Date;
  expectedDeliveryDate?: Date | undefined;
  placeOfSupply: string;
  sellerStateCode?: string | undefined;
  lines: POLineInput[];
  notes?: string | undefined;
  termsAndConditions?: string | undefined;
  createdBy: number;
}

export class PurchaseOrderService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreatePOParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      const computedLines = params.lines.map((l, i) => {
        const gst = GSTCalculator.computeLine({
          unitPrice: l.unitPrice,
          quantity: l.orderedQty,
          discountPct: l.discountPct ?? 0,
          discountAmount: l.discountAmount ?? 0,
          gstRate: l.gstRate,
          sellerStateCode: params.sellerStateCode ?? params.placeOfSupply,
          placeOfSupply: params.placeOfSupply,
        });
        return { ...l, ...gst, lineNumber: i + 1 };
      });
      const totals = GSTCalculator.sumTotals(computedLines);

      const [row] = await trx
        .insert(purchaseOrders)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          warehouseId: params.warehouseId,
          supplierId: params.supplierId,
          status: 'DRAFT',
          poDate: params.poDate,
          expectedDeliveryDate: params.expectedDeliveryDate,
          placeOfSupply: params.placeOfSupply,
          sellerStateCode: params.sellerStateCode,
          subtotal: String(totals.subtotal),
          discountAmount: String(totals.discountAmount),
          taxableAmount: String(totals.taxableAmount),
          cgstAmount: String(totals.cgstAmount),
          sgstAmount: String(totals.sgstAmount),
          igstAmount: String(totals.igstAmount),
          grandTotal: String(totals.grandTotal),
          notes: params.notes,
          termsAndConditions: params.termsAndConditions,
          createdBy: params.createdBy,
        })
        .returning({ id: purchaseOrders.id });

      if (!row) throw new BusinessError('PO_CREATE_FAILED', 'Failed to create purchase order');
      const poId = row.id;

      await trx.insert(purchaseOrderLines).values(
        computedLines.map((l) => ({
          purchaseOrderId: poId,
          tenantId: params.tenantId,
          lineNumber: l.lineNumber,
          itemId: l.itemId,
          variantId: l.variantId,
          description: l.description,
          orderedQty: String(l.orderedQty),
          unitId: l.unitId,
          unitPrice: String(l.unitPrice),
          discountPct: String(l.discountPct ?? 0),
          discountAmount: String(l.discountAmount ?? 0),
          taxableAmount: String(l.taxableAmount),
          gstRate: String(l.gstRate),
          cgstRate: String(l.cgstRate),
          sgstRate: String(l.sgstRate),
          igstRate: String(l.igstRate),
          cgstAmount: String(l.cgstAmount),
          sgstAmount: String(l.sgstAmount),
          igstAmount: String(l.igstAmount),
          lineTotal: String(l.lineTotal),
          hsnCode: l.hsnCode,
        }))
      );

      await trx.insert(purchaseOrderHistory).values({
        purchaseOrderId: poId,
        tenantId: params.tenantId,
        action: 'PO_CREATED',
        toStatus: 'DRAFT',
        performedBy: params.createdBy,
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'PO_CREATED',
        aggregateType: 'PurchaseOrder',
        aggregateId: poId,
        tenantId: params.tenantId,
        payload: { poId, supplierId: params.supplierId, grandTotal: totals.grandTotal },
        published: false,
      });

      return poId;
    });
  }

  async submit(id: number, tenantId: number, userId: number): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [po] = await trx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
      if (!po) throw new NotFoundError('PurchaseOrder', id);
      if (po.status !== 'DRAFT')
        throw new BusinessError('INVALID_STATUS', `Cannot submit PO in status ${po.status}`);

      await trx
        .update(purchaseOrders)
        .set({ status: 'SUBMITTED', submittedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));

      await trx.insert(purchaseOrderHistory).values({
        purchaseOrderId: id,
        tenantId,
        action: 'PO_SUBMITTED',
        fromStatus: 'DRAFT',
        toStatus: 'SUBMITTED',
        performedBy: userId,
      });
    });
  }

  async approve(id: number, tenantId: number, userId: number, poNumber: string): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [po] = await trx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
      if (!po) throw new NotFoundError('PurchaseOrder', id);
      if (!['SUBMITTED', 'PENDING_APPROVAL'].includes(po.status))
        throw new BusinessError('INVALID_STATUS', `Cannot approve PO in status ${po.status}`);

      await trx
        .update(purchaseOrders)
        .set({
          status: 'APPROVED',
          poNumber,
          approvedAt: new Date(),
          approvedBy: userId,
          updatedBy: userId,
          updatedAt: new Date(),
          version: sql`${purchaseOrders.version} + 1`,
        })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));

      await trx.insert(purchaseOrderHistory).values({
        purchaseOrderId: id,
        tenantId,
        action: 'PO_APPROVED',
        fromStatus: po.status,
        toStatus: 'APPROVED',
        performedBy: userId,
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'PO_APPROVED',
        aggregateType: 'PurchaseOrder',
        aggregateId: id,
        tenantId,
        payload: { poId: id, poNumber, supplierId: po.supplierId, grandTotal: po.grandTotal },
        published: false,
      });
    });
  }

  async cancel(id: number, tenantId: number, userId: number, reason: string): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [po] = await trx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
      if (!po) throw new NotFoundError('PurchaseOrder', id);
      if (['RECEIVED', 'CLOSED', 'CANCELLED'].includes(po.status))
        throw new BusinessError('INVALID_STATUS', `Cannot cancel PO in status ${po.status}`);

      await trx
        .update(purchaseOrders)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));

      await trx.insert(purchaseOrderHistory).values({
        purchaseOrderId: id,
        tenantId,
        action: 'PO_CANCELLED',
        fromStatus: po.status,
        toStatus: 'CANCELLED',
        performedBy: userId,
        notes: reason,
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'PO_CANCELLED',
        aggregateType: 'PurchaseOrder',
        aggregateId: id,
        tenantId,
        payload: { poId: id, supplierId: po.supplierId, reason },
        published: false,
      });
    });
  }

  async duplicate(id: number, tenantId: number, userId: number): Promise<number> {
    const [original] = await this.db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
    if (!original) throw new NotFoundError('PurchaseOrder', id);

    const originalLines = await this.db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, id));

    const [newPO] = await this.db
      .insert(purchaseOrders)
      .values({
        tenantId,
        branchId: original.branchId,
        warehouseId: original.warehouseId,
        supplierId: original.supplierId,
        status: 'DRAFT',
        poDate: new Date(),
        expectedDeliveryDate: original.expectedDeliveryDate,
        placeOfSupply: original.placeOfSupply,
        sellerStateCode: original.sellerStateCode,
        subtotal: original.subtotal,
        discountAmount: original.discountAmount,
        taxableAmount: original.taxableAmount,
        cgstAmount: original.cgstAmount,
        sgstAmount: original.sgstAmount,
        igstAmount: original.igstAmount,
        grandTotal: original.grandTotal,
        notes: original.notes,
        termsAndConditions: original.termsAndConditions,
        createdBy: userId,
      })
      .returning({ id: purchaseOrders.id });

    if (!newPO) throw new BusinessError('DUPLICATE_FAILED', 'Failed to duplicate purchase order');

    await this.db.insert(purchaseOrderLines).values(
      originalLines.map((l) => ({
        purchaseOrderId: newPO.id,
        tenantId,
        lineNumber: l.lineNumber,
        itemId: l.itemId,
        variantId: l.variantId,
        description: l.description,
        orderedQty: l.orderedQty,
        unitId: l.unitId,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct,
        discountAmount: l.discountAmount,
        taxableAmount: l.taxableAmount,
        gstRate: l.gstRate,
        cgstRate: l.cgstRate,
        sgstRate: l.sgstRate,
        igstRate: l.igstRate,
        cgstAmount: l.cgstAmount,
        sgstAmount: l.sgstAmount,
        igstAmount: l.igstAmount,
        lineTotal: l.lineTotal,
        hsnCode: l.hsnCode,
      }))
    );

    return newPO.id;
  }

  async getWithLines(id: number, tenantId: number) {
    const [po] = await this.db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
    if (!po) throw new NotFoundError('PurchaseOrder', id);

    const lines = await this.db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, id));

    return { ...po, lines };
  }

  async getPendingDelivery(tenantId: number) {
    const now = new Date();
    return this.db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.tenantId, tenantId),
          sql`${purchaseOrders.status} IN ('APPROVED', 'PARTIALLY_RECEIVED')`,
          lt(purchaseOrders.expectedDeliveryDate, now)
        )
      )
      .orderBy(desc(purchaseOrders.expectedDeliveryDate));
  }

  async update(id: number, tenantId: number, userId: number, params: Partial<CreatePOParams>): Promise<void> {
    const [po] = await this.db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    if (po.status !== 'DRAFT')
      throw new BusinessError('INVALID_STATUS', `Cannot edit PO in status ${po.status}`);

    await this.db
      .update(purchaseOrders)
      .set({
        notes: params.notes ?? po.notes,
        expectedDeliveryDate: params.expectedDeliveryDate ?? po.expectedDeliveryDate,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
  }
}
