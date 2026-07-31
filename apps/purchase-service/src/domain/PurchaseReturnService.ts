import { and, eq, sql } from 'drizzle-orm';
import {
  purchaseReturns,
  purchaseReturnLines,
  debitNotes,
  grns,
  grnLines,
  purchaseOrders,
  suppliers,
  items,
  projectionSupplierBalance,
  projectionStockLevel,
  outboxEvents,
  inventoryLedger,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { ulid } from 'ulid';
import { GSTCalculator } from '@erp/utils';
import { ValuationService } from './ValuationService.js';

export interface ReturnLineInput {
  grnLineId: number;
  itemId: number;
  variantId?: number | undefined;
  returnQty: number;
  unitPrice: number;
  gstRate: number;
}

export interface CreatePurchaseReturnParams {
  tenantId: number;
  branchId: number;
  grnId: number;
  supplierId: number;
  warehouseId: number;
  returnDate: Date;
  reason: 'QUALITY_ISSUE' | 'WRONG_ITEM' | 'EXCESS_QUANTITY' | 'DAMAGED' | 'OTHER';
  returnNotes?: string | undefined;
  lines: ReturnLineInput[];
  createdBy: number;
}

export class PurchaseReturnService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreatePurchaseReturnParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      const [grn] = await trx
        .select()
        .from(grns)
        .where(and(eq(grns.id, params.grnId), eq(grns.tenantId, params.tenantId)));
      if (!grn) throw new NotFoundError('GRN', params.grnId);
      if (grn.status !== 'APPROVED')
        throw new BusinessError('INVALID_GRN_STATUS', 'Can only return against APPROVED GRNs');

      // Needed for correct CGST/SGST vs IGST split below — same source PO the GRN was
      // received against carries the seller state / place of supply used at receipt time.
      const [po] = await trx
        .select({
          placeOfSupply: purchaseOrders.placeOfSupply,
          sellerStateCode: purchaseOrders.sellerStateCode,
        })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.id, grn.purchaseOrderId),
            eq(purchaseOrders.tenantId, params.tenantId)
          )
        );

      // ES-23 [H8]: previously there was no quantity validation at all — a return
      // could be created for any returnQty regardless of what the GRN line actually
      // received. Validate against receivedQty minus prior APPROVED returns on the
      // same grnLineId, mirroring SaleReturnService's equivalent guard.
      for (const l of params.lines) {
        const [grnLine] = await trx
          .select({ receivedQty: grnLines.receivedQty })
          .from(grnLines)
          .where(and(eq(grnLines.id, l.grnLineId), eq(grnLines.tenantId, params.tenantId)));
        if (!grnLine) throw new NotFoundError('GRNLine', l.grnLineId);
        const receivedQty = parseFloat(String(grnLine.receivedQty));

        const [priorReturns] = await trx
          .select({
            alreadyReturned: sql<string>`COALESCE(SUM(${purchaseReturnLines.returnQty}), 0)`,
          })
          .from(purchaseReturnLines)
          .innerJoin(purchaseReturns, eq(purchaseReturnLines.purchaseReturnId, purchaseReturns.id))
          .where(
            and(
              eq(purchaseReturnLines.grnLineId, l.grnLineId),
              eq(purchaseReturns.tenantId, params.tenantId),
              eq(purchaseReturns.status, 'APPROVED')
            )
          );
        const alreadyReturnedQty = parseFloat(String(priorReturns?.alreadyReturned ?? '0'));

        if (l.returnQty + alreadyReturnedQty > receivedQty + 0.001) {
          throw new BusinessError(
            'RETURN_QTY_EXCEEDED',
            `Return qty ${l.returnQty} (+ ${alreadyReturnedQty} already returned) exceeds received qty ${receivedQty} for GRN line ${l.grnLineId}`
          );
        }
      }

      const computedLines = params.lines.map((l, i) => {
        // Was hardcoded to always-intrastate (CGST+SGST) regardless of the PO's actual
        // seller state vs place of supply — genuinely interstate returns were taxed wrong.
        // Reuse the same GSTCalculator the GRN itself was received with.
        const gst = GSTCalculator.computeLine({
          unitPrice: l.unitPrice,
          quantity: l.returnQty,
          discountPct: 0,
          discountAmount: 0,
          gstRate: l.gstRate,
          sellerStateCode: po?.sellerStateCode ?? po?.placeOfSupply ?? '',
          placeOfSupply: po?.placeOfSupply ?? '',
        });
        return {
          ...l,
          lineNumber: i + 1,
          taxableAmount: gst.taxableAmount,
          cgstAmount: gst.cgstAmount,
          sgstAmount: gst.sgstAmount,
          igstAmount: gst.igstAmount,
          lineTotal: gst.lineTotal,
        };
      });

      const grandTotal = computedLines.reduce((s, l) => s + l.lineTotal, 0);
      const returnNumber = `PR-${params.tenantId}-${Date.now()}`;

      const [row] = await trx
        .insert(purchaseReturns)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          returnNumber,
          grnId: params.grnId,
          supplierId: params.supplierId,
          warehouseId: params.warehouseId,
          status: 'DRAFT',
          returnDate: params.returnDate,
          reason: params.reason,
          returnNotes: params.returnNotes,
          grandTotal: String(grandTotal),
          createdBy: params.createdBy,
        })
        .returning({ id: purchaseReturns.id });

      if (!row) throw new BusinessError('RETURN_CREATE_FAILED', 'Failed to create purchase return');
      const returnId = row.id;

      await trx.insert(purchaseReturnLines).values(
        computedLines.map((l) => ({
          purchaseReturnId: returnId,
          tenantId: params.tenantId,
          grnLineId: l.grnLineId,
          lineNumber: l.lineNumber,
          itemId: l.itemId,
          variantId: l.variantId,
          returnQty: String(l.returnQty),
          unitPrice: String(l.unitPrice),
          gstRate: String(l.gstRate),
          taxableAmount: String(l.taxableAmount),
          cgstAmount: String(l.cgstAmount),
          sgstAmount: String(l.sgstAmount),
          igstAmount: String(l.igstAmount),
          lineTotal: String(l.lineTotal),
        }))
      );

      return returnId;
    });
  }

  async approve(id: number, tenantId: number, userId: number): Promise<number> {
    return this.db.transaction(async (trx) => {
      const [ret] = await trx
        .select()
        .from(purchaseReturns)
        .where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.tenantId, tenantId)));
      if (!ret) throw new NotFoundError('PurchaseReturn', id);
      if (ret.status !== 'DRAFT')
        throw new BusinessError('INVALID_STATUS', `Cannot approve return in status ${ret.status}`);

      const lines = await trx
        .select()
        .from(purchaseReturnLines)
        .where(eq(purchaseReturnLines.purchaseReturnId, id));

      // Deduct stock from warehouse — goods are physically leaving to go back to the
      // supplier, so this is a STOCK_OUT movement (not STOCK_IN — a purchase return
      // reduces our inventory; STOCK_IN is for goods arriving, e.g. GRN or sales returns).
      for (const line of lines) {
        const qty = parseFloat(String(line.returnQty));
        const result = await trx
          .update(items)
          .set({
            availableQty: sql`${items.availableQty} - ${qty}`,
            version: sql`${items.version} + 1`,
          })
          .where(
            and(
              eq(items.id, line.itemId),
              eq(items.tenantId, tenantId),
              sql`${items.availableQty} >= ${qty}`
            )
          )
          .returning({ id: items.id, availableQty: items.availableQty });

        if (result.length === 0) {
          throw new BusinessError(
            'INSUFFICIENT_STOCK',
            `Insufficient stock for item ${line.itemId} to process return`
          );
        }

        const afterQty = parseFloat(String(result[0]!.availableQty ?? '0'));
        const beforeQty = afterQty + qty;

        // Previously purchase-service had no STOCK_OUT valuation path at all — a purchase
        // return decremented availableQty and wrote a ledger row but never touched
        // waccCost/currentStockValue/FIFO layers, so book stock value stayed overstated
        // forever after any return to a supplier (and a FIFO item's phantom layer stayed
        // available to be wrongly consumed by a later sale).
        const totalCogs = await ValuationService.consumeForStockOut(trx, {
          tenantId,
          itemId: line.itemId,
          variantId: line.variantId ?? undefined,
          warehouseId: ret.warehouseId,
          quantity: qty,
        });
        const cogsPerUnit = qty > 0 ? Math.round((totalCogs / qty) * 100) / 100 : 0;

        await trx.insert(inventoryLedger).values({
          tenantId,
          itemId: line.itemId,
          variantId: line.variantId ?? undefined,
          warehouseId: ret.warehouseId,
          movementType: 'STOCK_OUT',
          quantity: String(qty),
          quantityBefore: String(beforeQty),
          quantityAfter: String(afterQty),
          referenceType: 'PURCHASE_RETURN',
          referenceId: id,
          referenceLineId: line.id,
          unitCost: String(line.unitPrice ?? '0'),
          cogsPerUnit: String(cogsPerUnit),
          createdBy: userId,
        });

        // Same per-warehouse projection_stock_level gap GRN receipts had (fixed
        // 2026-07-17) — a purchase return never decremented it, leaving the Stock Levels
        // page and Physical Verification's snapshot phantom-high for the returning warehouse.
        await trx
          .insert(projectionStockLevel)
          .values({
            tenantId,
            itemId: line.itemId,
            variantId: line.variantId ?? undefined,
            warehouseId: ret.warehouseId,
            availableQty: '0',
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
              availableQty: sql`GREATEST(0, projection_stock_level.available_qty - ${qty})`,
              lastMovementAt: new Date(),
              updatedAt: new Date(),
            },
          });
      }

      // Auto-generate debit note
      const debitNoteNumber = `DN-${tenantId}-${Date.now()}`;
      const grandTotal = parseFloat(String(ret.grandTotal));

      const [dnRow] = await trx
        .insert(debitNotes)
        .values({
          tenantId,
          debitNoteNumber,
          purchaseReturnId: id,
          supplierId: ret.supplierId,
          status: 'OPEN',
          amount: String(grandTotal),
          appliedAmount: '0',
          balanceAmount: String(grandTotal),
          issueDate: new Date(),
          createdBy: userId,
        })
        .returning({ id: debitNotes.id });

      if (!dnRow)
        throw new BusinessError('DEBIT_NOTE_CREATE_FAILED', 'Failed to create debit note');

      // Update purchase return
      await trx
        .update(purchaseReturns)
        .set({
          status: 'APPROVED',
          debitNoteId: dnRow.id,
          approvedAt: new Date(),
          approvedBy: userId,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.tenantId, tenantId)));

      // Update supplier balance — returns reduce payable
      await trx
        .update(projectionSupplierBalance)
        .set({
          currentBalance: sql`${projectionSupplierBalance.currentBalance} - ${grandTotal}`,
          totalReturns: sql`${projectionSupplierBalance.totalReturns} + ${grandTotal}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectionSupplierBalance.tenantId, tenantId),
            eq(projectionSupplierBalance.supplierId, ret.supplierId)
          )
        );

      // gst-service's handlePurchaseReturnApproved and (once wired) accounting-service's
      // consumer both need the same full breakdown GRN_APPROVED already carries — this
      // payload previously only had {returnId, debitNoteId, debitNoteNumber, supplierId,
      // grandTotal}, so every field the consumers read (incl. a field-name mismatch:
      // consumer expected `returnNumber`, producer never sent one) came back undefined,
      // silently recording every purchase-return GST ledger entry as ₹0.
      const taxTotals = lines.reduce(
        (acc, l) => ({
          taxableAmount: acc.taxableAmount + parseFloat(String(l.taxableAmount)),
          cgstAmount: acc.cgstAmount + parseFloat(String(l.cgstAmount)),
          sgstAmount: acc.sgstAmount + parseFloat(String(l.sgstAmount)),
          igstAmount: acc.igstAmount + parseFloat(String(l.igstAmount)),
        }),
        { taxableAmount: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0 }
      );

      const [supplier] = await trx
        .select({ displayName: suppliers.displayName, gstin: suppliers.gstin })
        .from(suppliers)
        .where(and(eq(suppliers.id, ret.supplierId), eq(suppliers.tenantId, tenantId)));

      const [grnForPo] = await trx
        .select({ purchaseOrderId: grns.purchaseOrderId })
        .from(grns)
        .where(and(eq(grns.id, ret.grnId), eq(grns.tenantId, tenantId)));

      const [po] = grnForPo
        ? await trx
            .select({
              placeOfSupply: purchaseOrders.placeOfSupply,
              sellerStateCode: purchaseOrders.sellerStateCode,
            })
            .from(purchaseOrders)
            .where(
              and(
                eq(purchaseOrders.id, grnForPo.purchaseOrderId),
                eq(purchaseOrders.tenantId, tenantId)
              )
            )
        : [];

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'PURCHASE_RETURN_APPROVED',
        aggregateType: 'PurchaseReturn',
        aggregateId: id,
        tenantId,
        payload: {
          returnId: id,
          returnNumber: ret.returnNumber,
          returnDate: ret.returnDate,
          debitNoteId: dnRow.id,
          debitNoteNumber,
          supplierId: ret.supplierId,
          supplierName: supplier?.displayName ?? null,
          supplierGstin: supplier?.gstin ?? null,
          placeOfSupply: po?.placeOfSupply ?? null,
          sellerStateCode: po?.sellerStateCode ?? po?.placeOfSupply ?? null,
          taxableAmount: String(taxTotals.taxableAmount),
          cgstAmount: String(taxTotals.cgstAmount),
          sgstAmount: String(taxTotals.sgstAmount),
          igstAmount: String(taxTotals.igstAmount),
          cessAmount: '0',
          isInterstate: taxTotals.igstAmount > 0,
          grandTotal: ret.grandTotal,
        },
        published: false,
      });

      return dnRow.id;
    });
  }

  async getList(tenantId: number, page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    return this.db
      .select()
      .from(purchaseReturns)
      .where(eq(purchaseReturns.tenantId, tenantId))
      .limit(pageSize)
      .offset(offset);
  }
}
