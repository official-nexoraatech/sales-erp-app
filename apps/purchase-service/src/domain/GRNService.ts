import { and, eq, sql } from 'drizzle-orm';
import {
  grns,
  grnLines,
  grnHistory,
  purchaseOrders,
  purchaseOrderLines,
  items,
  suppliers,
  outboxEvents,
  projectionSupplierBalance,
  inventoryLedger,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { GSTCalculator } from './GSTCalculator.js';
import { ValuationService } from './ValuationService.js';
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
  cessRate?: number | undefined;
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

      // RCM (ES-10): an unregistered supplier doesn't charge GST — buyer self-assesses
      // and pays it directly to the government instead of to the supplier.
      const [supplier] = await trx
        .select({ isRegistered: suppliers.isRegistered })
        .from(suppliers)
        .where(and(eq(suppliers.id, params.supplierId), eq(suppliers.tenantId, params.tenantId)));
      const rcmApplicable = supplier ? !supplier.isRegistered : false;

      // 3-Way Match: load PO lines and detect price variance
      // FOR UPDATE (ES-23 [M1]): locks these PO lines for the duration of this
      // transaction so a second, concurrent create() against the same PO blocks
      // here rather than reading the same stale receivedQty snapshot used below.
      const poLines = await trx
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.purchaseOrderId, params.purchaseOrderId))
        .for('update');

      let hasPriceVariance = false;

      // Over-receipt guard: received qty (across all lines in this GRN referencing the
      // same PO line) must not exceed what's still outstanding on the PO line.
      const newlyReceivedByPoLine = new Map<number, number>();
      for (const l of params.lines) {
        newlyReceivedByPoLine.set(
          l.purchaseOrderLineId,
          (newlyReceivedByPoLine.get(l.purchaseOrderLineId) ?? 0) + l.receivedQty
        );
      }
      for (const [poLineId, newlyReceived] of newlyReceivedByPoLine) {
        const poLine = poLines.find((p) => p.id === poLineId);
        if (!poLine) throw new NotFoundError('PurchaseOrderLine', poLineId);
        const orderedQty = parseFloat(String(poLine.orderedQty));
        const alreadyReceived = parseFloat(String(poLine.receivedQty));
        const remainingQty = orderedQty - alreadyReceived;
        if (newlyReceived > remainingQty + 0.001) {
          throw new BusinessError(
            'PURCHASE_QTY_MISMATCH',
            `Received qty ${newlyReceived} exceeds remaining PO qty ${remainingQty} for PO line ${poLineId}`,
            { purchaseOrderLineId: poLineId, orderedQty, alreadyReceived, receivedQty: newlyReceived }
          );
        }
      }

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
          cessRate: l.cessRate ?? 0,
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
      const cessAmount = computedLines.reduce((s, l) => s + l.cessAmount, 0);
      // RCM: the unregistered supplier's invoice excludes GST — grandTotal (amount
      // payable to the supplier) is taxable-only. The self-assessed tax is still
      // recorded on cgstAmount/sgstAmount/igstAmount/cessAmount below (for the GST
      // ledger + RCM register) but is paid to the government, not the supplier.
      const grandTotal = rcmApplicable
        ? taxableAmount
        : taxableAmount + cgstAmount + sgstAmount + igstAmount + cessAmount;

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
          cessAmount: String(cessAmount),
          grandTotal: String(grandTotal),
          hasPriceVariance,
          rcmApplicable,
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
          cessRate: String(l.cessRate),
          cessAmount: String(l.cessAmount),
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
      // ES-03: previously missing — GRN approval updated available_qty but never wrote
      // to inventory_ledger, leaving GRN receipts out of the stock audit trail.
      for (const line of lines) {
        const qty = parseFloat(String(line.receivedQty));
        const result = await trx
          .update(items)
          .set({
            availableQty: sql`${items.availableQty} + ${qty}`,
            version: sql`${items.version} + 1`,
          })
          .where(and(eq(items.id, line.itemId), eq(items.tenantId, tenantId)))
          .returning({ availableQty: items.availableQty });

        const afterQty = parseFloat(String(result[0]?.availableQty ?? '0'));
        const beforeQty = afterQty - qty;
        const lineWarehouseId = line.warehouseId ?? grn.warehouseId;
        const unitCost = parseFloat(String(line.grnRate ?? '0'));
        const [ledgerRow] = await trx
          .insert(inventoryLedger)
          .values({
            tenantId,
            itemId: line.itemId,
            variantId: line.variantId ?? undefined,
            warehouseId: lineWarehouseId,
            movementType: 'STOCK_IN',
            quantity: String(qty),
            quantityBefore: String(beforeQty),
            quantityAfter: String(afterQty),
            referenceType: 'GRN',
            referenceId: id,
            referenceLineId: line.id,
            unitCost: String(unitCost),
            createdBy: userId,
          })
          .returning({ id: inventoryLedger.id });

        // ES-13: recalculate WACC / create a FIFO cost layer for this receipt
        await ValuationService.applyStockIn(trx, {
          tenantId,
          itemId: line.itemId,
          variantId: line.variantId ?? undefined,
          warehouseId: lineWarehouseId,
          quantity: qty,
          unitCost,
          qtyBeforeStockIn: beforeQty,
          sourceLedgerId: ledgerRow!.id,
          receivedAt: grn.grnDate,
        });
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
      // ES-23 [M1]: atomic, guarded increment — the ceiling check happens in the
      // WHERE clause against the row's CURRENT receivedQty, not a value read earlier
      // in this function, so this is the real backstop against over-receipt even if
      // two DRAFT GRNs against the same PO line both individually passed create()'s
      // (necessarily optimistic, pre-approval) check.
      for (const [poLineId, receivedQty] of linesByPoLine) {
        const poLineResult = await trx
          .update(purchaseOrderLines)
          .set({ receivedQty: sql`${purchaseOrderLines.receivedQty} + ${receivedQty}` })
          .where(
            and(
              eq(purchaseOrderLines.id, poLineId),
              sql`${purchaseOrderLines.receivedQty} + ${receivedQty} <= ${purchaseOrderLines.orderedQty} + 0.001`
            )
          )
          .returning({ id: purchaseOrderLines.id });

        if (poLineResult.length === 0) {
          throw new BusinessError(
            'PURCHASE_QTY_MISMATCH',
            `Approving this GRN would push PO line ${poLineId}'s received qty past its ordered qty`,
            { purchaseOrderLineId: poLineId, receivedQty }
          );
        }
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

      // ES-10: previously this payload only carried {grnId, grnNumber, purchaseOrderId,
      // supplierId, grandTotal, warehouseId} — both GRNGstConsumer (gst-service) and
      // GRNAccountingConsumer (accounting-service) read taxableAmount/cgstAmount/
      // sgstAmount/igstAmount/supplierGstin/placeOfSupply etc from the payload, so every
      // GST ledger entry and every ITC journal line for every GRN was silently recorded
      // as zero. Fixed by carrying the full breakdown already computed on `grn`/`po`.
      const [supplier] = await trx
        .select({ displayName: suppliers.displayName, gstin: suppliers.gstin })
        .from(suppliers)
        .where(and(eq(suppliers.id, grn.supplierId), eq(suppliers.tenantId, tenantId)));

      const isInterstate = parseFloat(String(grn.igstAmount)) > 0;

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
          grnDate: grn.grnDate,
          purchaseOrderId: grn.purchaseOrderId,
          supplierId: grn.supplierId,
          supplierName: supplier?.displayName ?? null,
          supplierGstin: supplier?.gstin ?? null,
          placeOfSupply: po?.placeOfSupply ?? null,
          sellerStateCode: po?.sellerStateCode ?? po?.placeOfSupply ?? null,
          taxableAmount: grn.taxableAmount,
          // RCM: no GST is owed to the supplier — accounting must not book a "GST payable
          // to supplier" line, and the self-assessed tax is posted separately below.
          cgstAmount: grn.rcmApplicable ? '0' : grn.cgstAmount,
          sgstAmount: grn.rcmApplicable ? '0' : grn.sgstAmount,
          igstAmount: grn.rcmApplicable ? '0' : grn.igstAmount,
          cessAmount: grn.rcmApplicable ? '0' : grn.cessAmount,
          grandTotal: grn.grandTotal,
          isInterstate,
          itcEligible: true,
          rcmApplicable: grn.rcmApplicable,
          warehouseId: grn.warehouseId,
          branchId: grn.branchId,
        },
        published: false,
      });

      // RCM (ES-10): buyer self-assesses GST on unregistered-vendor purchases and pays
      // it directly to the government. Post the liability + input credit separately.
      if (grn.rcmApplicable) {
        const rcmTaxAmount =
          parseFloat(String(grn.cgstAmount)) +
          parseFloat(String(grn.sgstAmount)) +
          parseFloat(String(grn.igstAmount)) +
          parseFloat(String(grn.cessAmount));

        if (rcmTaxAmount > 0) {
          await trx.insert(outboxEvents).values({
            eventId: ulid(),
            eventType: 'RCM_LIABILITY_POSTED',
            aggregateType: 'GRN',
            aggregateId: id,
            tenantId,
            payload: {
              grnId: id,
              grnNumber,
              supplierId: grn.supplierId,
              rcmTaxAmount: String(rcmTaxAmount),
            },
            published: false,
          });
        }
      }

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
