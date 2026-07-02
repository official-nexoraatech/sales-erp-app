import { and, eq, sql } from 'drizzle-orm';
import {
  grns,
  grnLines,
  grnHistory,
  purchaseOrders,
  purchaseOrderLines,
  items,
  outboxEvents,
  projectionSupplierBalance,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { GSTCalculator } from './GSTCalculator.js';
import { ulid } from 'ulid';

const PRICE_VARIANCE_THRESHOLD = 0.05; // 5%

export interface GRNLineInput {
  purchaseOrderLineId: number;
  itemId: number;
  variantId?: number | undefined;
  description?: string | undefined;
  receivedQty: number;
  unitId?: number | undefined;
  grnRate: number;
  gstRate: number;
  hsnCode?: string | undefined;
  warehouseId?: number | undefined;
}

export interface CreateGRNParams {
  tenantId: number;
  branchId: number;
  warehouseId: number;
  purchaseOrderId: number;
  supplierId: number;
  grnDate: Date;
  supplierInvoiceNumber?: string | undefined;
  supplierInvoiceDate?: Date | undefined;
  lines: GRNLineInput[];
  notes?: string | undefined;
  createdBy: number;
}

export class GRNService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateGRNParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      // Validate PO exists and is in receivable state
      const [po] = await trx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, params.purchaseOrderId), eq(purchaseOrders.tenantId, params.tenantId)));
      if (!po) throw new NotFoundError('PurchaseOrder', params.purchaseOrderId);
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status))
        throw new BusinessError('INVALID_PO_STATUS', `PO must be APPROVED or PARTIALLY_RECEIVED to create GRN`);

      // 3-Way Match: load PO lines and detect price variance
      const poLines = await trx
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.purchaseOrderId, params.purchaseOrderId));

      let hasPriceVariance = false;

      const computedLines = params.lines.map((l, i) => {
        const poLine = poLines.find((p) => p.id === l.purchaseOrderLineId);
        const poRate = poLine ? parseFloat(String(poLine.unitPrice)) : 0;
        const variancePct = poRate > 0 ? Math.abs(l.grnRate - poRate) / poRate : 0;

        if (variancePct > PRICE_VARIANCE_THRESHOLD) {
          hasPriceVariance = true;
        }

        const gst = GSTCalculator.computeLine({
          unitPrice: l.grnRate,
          quantity: l.receivedQty,
          discountPct: 0,
          discountAmount: 0,
          gstRate: l.gstRate,
          sellerStateCode: po.sellerStateCode ?? po.placeOfSupply,
          placeOfSupply: po.placeOfSupply,
        });

        return {
          ...l,
          ...gst,
          lineNumber: i + 1,
          poRate,
          priceVariancePct: variancePct * 100,
          effectiveUnitCost: l.grnRate,
        };
      });

      const subtotal = computedLines.reduce((s, l) => s + l.subtotal, 0);
      const taxableAmount = computedLines.reduce((s, l) => s + l.taxableAmount, 0);
      const cgstAmount = computedLines.reduce((s, l) => s + l.cgstAmount, 0);
      const sgstAmount = computedLines.reduce((s, l) => s + l.sgstAmount, 0);
      const igstAmount = computedLines.reduce((s, l) => s + l.igstAmount, 0);
      const grandTotal = taxableAmount + cgstAmount + sgstAmount + igstAmount;

      const grnStatus = hasPriceVariance ? 'PENDING_APPROVAL' : 'DRAFT';

      const [row] = await trx
        .insert(grns)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          warehouseId: params.warehouseId,
          purchaseOrderId: params.purchaseOrderId,
          supplierId: params.supplierId,
          status: grnStatus,
          grnDate: params.grnDate,
          supplierInvoiceNumber: params.supplierInvoiceNumber,
          supplierInvoiceDate: params.supplierInvoiceDate,
          subtotal: String(subtotal),
          taxableAmount: String(taxableAmount),
          cgstAmount: String(cgstAmount),
          sgstAmount: String(sgstAmount),
          igstAmount: String(igstAmount),
          grandTotal: String(grandTotal),
          hasPriceVariance,
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning({ id: grns.id });

      if (!row) throw new BusinessError('GRN_CREATE_FAILED', 'Failed to create GRN');
      const grnId = row.id;

      await trx.insert(grnLines).values(
        computedLines.map((l) => ({
          grnId,
          tenantId: params.tenantId,
          purchaseOrderLineId: l.purchaseOrderLineId,
          lineNumber: l.lineNumber,
          itemId: l.itemId,
          variantId: l.variantId,
          description: l.description,
          orderedQty: String(
            poLines.find((p) => p.id === l.purchaseOrderLineId)?.orderedQty ?? l.receivedQty
          ),
          receivedQty: String(l.receivedQty),
          unitId: l.unitId,
          poRate: String(l.poRate),
          grnRate: String(l.grnRate),
          priceVariancePct: String(l.priceVariancePct),
          gstRate: String(l.gstRate),
          cgstRate: String(l.cgstRate),
          sgstRate: String(l.sgstRate),
          igstRate: String(l.igstRate),
          taxableAmount: String(l.taxableAmount),
          cgstAmount: String(l.cgstAmount),
          sgstAmount: String(l.sgstAmount),
          igstAmount: String(l.igstAmount),
          lineTotal: String(l.lineTotal),
          effectiveUnitCost: String(l.effectiveUnitCost),
          hsnCode: l.hsnCode,
          warehouseId: l.warehouseId ?? params.warehouseId,
        }))
      );

      await trx.insert(grnHistory).values({
        grnId,
        tenantId: params.tenantId,
        action: hasPriceVariance ? 'GRN_PRICE_VARIANCE_DETECTED' : 'GRN_CREATED',
        toStatus: grnStatus,
        performedBy: params.createdBy,
        notes: hasPriceVariance ? `Price variance >5% detected — pending approval` : undefined,
      });

      return grnId;
    });
  }

  async approve(id: number, tenantId: number, userId: number, grnNumber: string): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [grn] = await trx
        .select()
        .from(grns)
        .where(and(eq(grns.id, id), eq(grns.tenantId, tenantId)));
      if (!grn) throw new NotFoundError('GRN', id);
      if (!['DRAFT', 'PENDING_APPROVAL'].includes(grn.status))
        throw new BusinessError('INVALID_STATUS', `Cannot approve GRN in status ${grn.status}`);

      const lines = await trx.select().from(grnLines).where(eq(grnLines.grnId, id));

      // Step 4: Add stock to warehouse (call Phase 3 addStock pattern)
      for (const line of lines) {
        const qty = parseFloat(String(line.receivedQty));
        await trx
          .update(items)
          .set({
            availableQty: sql`${items.availableQty} + ${qty}`,
            version: sql`${items.version} + 1`,
          })
          .where(and(eq(items.id, line.itemId), eq(items.tenantId, tenantId)));
      }

      // Step 3: Update PO received quantities
      const linesByPoLine = new Map<number, number>();
      for (const line of lines) {
        if (line.purchaseOrderLineId) {
          linesByPoLine.set(
            line.purchaseOrderLineId,
            (linesByPoLine.get(line.purchaseOrderLineId) ?? 0) + parseFloat(String(line.receivedQty))
          );
        }
      }
      for (const [poLineId, receivedQty] of linesByPoLine) {
        await trx
          .update(purchaseOrderLines)
          .set({ receivedQty: sql`${purchaseOrderLines.receivedQty} + ${receivedQty}` })
          .where(eq(purchaseOrderLines.id, poLineId));
      }

      // Update PO status
      const [po] = await trx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, grn.purchaseOrderId), eq(purchaseOrders.tenantId, tenantId)));

      if (po) {
        const allPOLines = await trx
          .select()
          .from(purchaseOrderLines)
          .where(eq(purchaseOrderLines.purchaseOrderId, grn.purchaseOrderId));

        const allFullyReceived = allPOLines.every(
          (l) => parseFloat(String(l.receivedQty)) >= parseFloat(String(l.orderedQty))
        );

        const newPoStatus = allFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
        const receivedDelta = parseFloat(String(grn.grandTotal));

        await trx
          .update(purchaseOrders)
          .set({
            status: newPoStatus,
            receivedAmount: sql`${purchaseOrders.receivedAmount} + ${receivedDelta}`,
            updatedAt: new Date(),
          })
          .where(and(eq(purchaseOrders.id, grn.purchaseOrderId), eq(purchaseOrders.tenantId, tenantId)));
      }

      // Update GRN status
      await trx
        .update(grns)
        .set({
          status: 'APPROVED',
          grnNumber,
          approvedAt: new Date(),
          approvedBy: userId,
          updatedBy: userId,
          updatedAt: new Date(),
          version: sql`${grns.version} + 1`,
        })
        .where(and(eq(grns.id, id), eq(grns.tenantId, tenantId)));

      // Update supplier balance projection
      const grnTotal = parseFloat(String(grn.grandTotal));
      await trx
        .insert(projectionSupplierBalance)
        .values({
          tenantId,
          supplierId: grn.supplierId,
          currentBalance: String(grnTotal),
          totalPurchased: String(grnTotal),
          totalPaid: '0',
          totalReturns: '0',
          overdueAmount: '0',
          lastGrnAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [projectionSupplierBalance.tenantId, projectionSupplierBalance.supplierId],
          set: {
            currentBalance: sql`${projectionSupplierBalance.currentBalance} + ${grnTotal}`,
            totalPurchased: sql`${projectionSupplierBalance.totalPurchased} + ${grnTotal}`,
            lastGrnAt: new Date(),
            updatedAt: new Date(),
          },
        });

      // Step 6 (IRREVERSIBLE): Write GRN_APPROVED to outbox
      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'GRN_APPROVED',
        aggregateType: 'GRN',
        aggregateId: id,
        tenantId,
        payload: {
          grnId: id,
          grnNumber,
          purchaseOrderId: grn.purchaseOrderId,
          supplierId: grn.supplierId,
          grandTotal: grn.grandTotal,
          warehouseId: grn.warehouseId,
        },
        published: false,
      });

      await trx.insert(grnHistory).values({
        grnId: id,
        tenantId,
        action: 'GRN_APPROVED',
        fromStatus: grn.status,
        toStatus: 'APPROVED',
        performedBy: userId,
      });
    });
  }

  async reject(id: number, tenantId: number, userId: number, reason: string): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [grn] = await trx
        .select()
        .from(grns)
        .where(and(eq(grns.id, id), eq(grns.tenantId, tenantId)));
      if (!grn) throw new NotFoundError('GRN', id);
      if (!['DRAFT', 'PENDING_APPROVAL'].includes(grn.status))
        throw new BusinessError('INVALID_STATUS', `Cannot reject GRN in status ${grn.status}`);

      await trx
        .update(grns)
        .set({ status: 'REJECTED', rejectionReason: reason, updatedBy: userId, updatedAt: new Date() })
        .where(and(eq(grns.id, id), eq(grns.tenantId, tenantId)));

      await trx.insert(grnHistory).values({
        grnId: id,
        tenantId,
        action: 'GRN_REJECTED',
        fromStatus: grn.status,
        toStatus: 'REJECTED',
        performedBy: userId,
        notes: reason,
      });

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'GRN_REJECTED',
        aggregateType: 'GRN',
        aggregateId: id,
        tenantId,
        payload: { grnId: id, supplierId: grn.supplierId, reason },
        published: false,
      });
    });
  }

  async getWithLines(id: number, tenantId: number) {
    const [grn] = await this.db
      .select()
      .from(grns)
      .where(and(eq(grns.id, id), eq(grns.tenantId, tenantId)));
    if (!grn) throw new NotFoundError('GRN', id);

    const lines = await this.db.select().from(grnLines).where(eq(grnLines.grnId, id));
    return { ...grn, lines };
  }
}
