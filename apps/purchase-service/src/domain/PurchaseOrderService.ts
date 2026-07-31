import { and, eq, sql, desc, lt, getTableColumns, inArray } from 'drizzle-orm';
import {
  purchaseOrders,
  purchaseOrderLines,
  purchaseOrderHistory,
  purchaseOrderAmendments,
  suppliers,
  items,
  projectionSupplierBalance,
  outboxEvents,
  organizationSettings,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError, VendorCreditLimitExceededError } from '@erp/types';
import { GSTCalculator } from '@erp/utils';
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
  poType?: 'STANDARD' | 'BLANKET' | 'RATE_CONTRACT' | undefined;
  contractValidFrom?: Date | undefined;
  contractValidTill?: Date | undefined;
  requisitionId?: number | undefined;
}

export class PurchaseOrderService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreatePOParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      // Was `params.sellerStateCode ?? params.placeOfSupply` — when a caller omitted
      // sellerStateCode (the frontend PO form never collected it), that fallback made
      // `sellerStateCode === placeOfSupply` trivially true, silently forcing CGST+SGST
      // on every PO regardless of whether the supplier is actually in another state.
      // Fall back to the supplier's own registered address first — genuinely correct in
      // the common case — before ever falling back to placeOfSupply.
      const [supplierForState] = await trx
        .select({ billingAddress: suppliers.billingAddress })
        .from(suppliers)
        .where(and(eq(suppliers.id, params.supplierId), eq(suppliers.tenantId, params.tenantId)));
      const resolvedSellerStateCode =
        params.sellerStateCode ??
        supplierForState?.billingAddress?.stateCode ??
        params.placeOfSupply;

      // Previously unchecked anywhere — a DISCONTINUED or soft-deleted item could still be
      // ordered from a supplier, undermining the whole point of discontinuing/deleting it.
      const poItemIds = [...new Set(params.lines.map((l) => l.itemId))];
      if (poItemIds.length > 0) {
        const itemRows = await trx
          .select({ id: items.id, status: items.status, deletedAt: items.deletedAt })
          .from(items)
          .where(and(inArray(items.id, poItemIds), eq(items.tenantId, params.tenantId)));
        const itemById = new Map(itemRows.map((r) => [r.id, r]));
        for (const itemId of poItemIds) {
          const item = itemById.get(itemId);
          if (!item || item.deletedAt || item.status === 'DISCONTINUED') {
            throw new BusinessError(
              'ITEM_NOT_TRANSACTABLE',
              `Item ${itemId} is discontinued or deleted and cannot be ordered`
            );
          }
        }
      }

      const computedLines = params.lines.map((l, i) => {
        const gst = GSTCalculator.computeLine({
          unitPrice: l.unitPrice,
          quantity: l.orderedQty,
          discountPct: l.discountPct ?? 0,
          discountAmount: l.discountAmount ?? 0,
          gstRate: l.gstRate,
          sellerStateCode: resolvedSellerStateCode,
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
          sellerStateCode: resolvedSellerStateCode,
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
          poType: params.poType ?? 'STANDARD',
          contractValidFrom: params.contractValidFrom,
          contractValidTill: params.contractValidTill,
          requisitionId: params.requisitionId,
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
        .set({
          status: 'SUBMITTED',
          submittedAt: new Date(),
          updatedBy: userId,
          updatedAt: new Date(),
        })
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

  async approve(
    id: number,
    tenantId: number,
    userId: number,
    poNumber: string,
    overrideCreditLimit = false,
    // Purchase audit 2026-07-21: tiered approval — already validated at the route layer
    // (caller holds PO_APPROVE_HIGH_VALUE) before this is set true, same convention as
    // overrideCreditLimit above.
    hasHighValueApproval = false
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [po] = await trx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
      if (!po) throw new NotFoundError('PurchaseOrder', id);
      if (!['SUBMITTED', 'PENDING_APPROVAL'].includes(po.status))
        throw new BusinessError('INVALID_STATUS', `Cannot approve PO in status ${po.status}`);

      if (!hasHighValueApproval) {
        const [org] = await trx
          .select({ purchaseApprovalThreshold: organizationSettings.purchaseApprovalThreshold })
          .from(organizationSettings)
          .where(eq(organizationSettings.tenantId, tenantId));
        const threshold = org?.purchaseApprovalThreshold
          ? parseFloat(String(org.purchaseApprovalThreshold))
          : null;
        if (threshold !== null && parseFloat(String(po.grandTotal)) > threshold) {
          throw new BusinessError(
            'HIGH_VALUE_APPROVAL_REQUIRED',
            `PO total ${po.grandTotal} exceeds the ${threshold} approval threshold — requires an approver with PO_APPROVE_HIGH_VALUE`,
            { grandTotal: po.grandTotal, threshold }
          );
        }
      }

      if (!overrideCreditLimit) {
        const [supplier] = await trx
          .select({
            creditLimit: suppliers.creditLimit,
            creditLimitEnabled: suppliers.creditLimitEnabled,
          })
          .from(suppliers)
          .where(and(eq(suppliers.id, po.supplierId), eq(suppliers.tenantId, tenantId)));

        if (supplier?.creditLimitEnabled) {
          const [balance] = await trx
            .select({ currentBalance: projectionSupplierBalance.currentBalance })
            .from(projectionSupplierBalance)
            .where(
              and(
                eq(projectionSupplierBalance.tenantId, tenantId),
                eq(projectionSupplierBalance.supplierId, po.supplierId)
              )
            );

          const limit = parseFloat(String(supplier.creditLimit));
          const currentBalance = parseFloat(String(balance?.currentBalance ?? 0));
          const newBalance = currentBalance + parseFloat(String(po.grandTotal));

          if (limit > 0 && newBalance > limit) {
            throw new VendorCreditLimitExceededError(po.supplierId, limit, newBalance);
          }
        }
      }

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

  async amend(
    id: number,
    tenantId: number,
    userId: number,
    amendments: Record<string, unknown>,
    reason: string
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [po] = await trx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
      if (!po) throw new NotFoundError('PurchaseOrder', id);
      if (po.status !== 'APPROVED')
        throw new BusinessError('INVALID_STATUS', `Cannot amend PO in status ${po.status}`);

      await trx.insert(purchaseOrderAmendments).values({
        purchaseOrderId: id,
        tenantId,
        amendments,
        reason,
        performedBy: userId,
      });

      await trx
        .update(purchaseOrders)
        .set({
          updatedBy: userId,
          updatedAt: new Date(),
          version: sql`${purchaseOrders.version} + 1`,
        })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));

      await trx.insert(purchaseOrderHistory).values({
        purchaseOrderId: id,
        tenantId,
        action: 'PO_AMENDED',
        fromStatus: 'APPROVED',
        toStatus: 'APPROVED',
        performedBy: userId,
        notes: reason,
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'PO_AMENDED',
        aggregateType: 'PurchaseOrder',
        aggregateId: id,
        tenantId,
        payload: { poId: id, amendments, reason },
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
      .select({ ...getTableColumns(purchaseOrders), supplierName: suppliers.displayName })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(purchaseOrders.supplierId, suppliers.id))
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
    if (!po) throw new NotFoundError('PurchaseOrder', id);

    const lines = await this.db
      .select({ ...getTableColumns(purchaseOrderLines), itemName: items.name })
      .from(purchaseOrderLines)
      .leftJoin(items, eq(purchaseOrderLines.itemId, items.id))
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

  async update(
    id: number,
    tenantId: number,
    userId: number,
    params: Partial<CreatePOParams>
  ): Promise<void> {
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
