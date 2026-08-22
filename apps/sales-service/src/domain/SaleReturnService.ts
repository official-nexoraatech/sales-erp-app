import { and, eq, sql } from 'drizzle-orm';
import {
  saleReturns,
  saleReturnLines,
  creditNotes,
  invoices,
  invoiceLines,
  items,
  outboxEvents,
  projectionCustomerBalance,
  projectionStockLevel,
  inventoryLedger,
  customers,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { ulid } from 'ulid';
import { ValuationService } from '@erp/sdk';

export interface SaleReturnLineInput {
  invoiceLineId: number;
  itemId: number;
  variantId?: number;
  returnQty: number;
}

export interface CreateSaleReturnParams {
  tenantId: number;
  branchId: number;
  returnNumber: string;
  invoiceId: number;
  customerId: number;
  returnDate: Date;
  reason: 'DEFECTIVE' | 'WRONG_ITEM' | 'CUSTOMER_CHANGE_MIND' | 'QUALITY_ISSUE' | 'OTHER';
  isPhysicalReturn: boolean;
  warehouseId?: number;
  lines: SaleReturnLineInput[];
  notes?: string;
  creditNoteNumber: string;
  createdBy: number;
}

export class SaleReturnService {
  constructor(private db: ErpDatabase) {}

  async create(
    params: CreateSaleReturnParams
  ): Promise<{ returnId: number; creditNoteId: number }> {
    return this.db.transaction(async (trx) => {
      const [invoice] = await trx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, params.invoiceId), eq(invoices.tenantId, params.tenantId)));
      if (!invoice) throw new NotFoundError('Invoice not found');
      if (!['CONFIRMED', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status))
        throw new BusinessError(
          'INVALID_INVOICE_STATUS',
          `Cannot return invoice in status ${invoice.status}`
        );

      // Fetch original lines to compute return amounts with matching GST
      let totalAmount = 0;
      let cgstTotal = 0,
        sgstTotal = 0,
        igstTotal = 0,
        subtotal = 0;
      const returnLineValues = [];
      const stockRestorations: Array<{
        itemId: number;
        variantId?: number | undefined;
        invoiceLineId: number;
        warehouseId: number;
        quantity: number;
        quantityBefore: number;
        quantityAfter: number;
        reversalUnitCost: number;
      }> = [];

      for (const rl of params.lines) {
        const [origLine] = await trx
          .select()
          .from(invoiceLines)
          .where(
            and(eq(invoiceLines.id, rl.invoiceLineId), eq(invoiceLines.invoiceId, params.invoiceId))
          );
        if (!origLine) throw new NotFoundError(`Invoice line ${rl.invoiceLineId} not found`);

        const origQty = parseFloat(String(origLine.quantity));

        // ES-23 [H7]: validate against cumulative prior APPROVED returns for this invoice
        // line, not just the original quantity — otherwise multiple separate returns can
        // together exceed what was ever sold.
        const [priorReturns] = await trx
          .select({ alreadyReturned: sql<string>`COALESCE(SUM(${saleReturnLines.returnQty}), 0)` })
          .from(saleReturnLines)
          .innerJoin(saleReturns, eq(saleReturnLines.returnId, saleReturns.id))
          .where(
            and(
              eq(saleReturnLines.invoiceLineId, rl.invoiceLineId),
              eq(saleReturns.tenantId, params.tenantId),
              eq(saleReturns.status, 'APPROVED')
            )
          );
        const alreadyReturnedQty = parseFloat(String(priorReturns?.alreadyReturned ?? '0'));

        if (rl.returnQty + alreadyReturnedQty > origQty)
          throw new BusinessError(
            'RETURN_QTY_EXCEEDED',
            `Return qty ${rl.returnQty} (+ ${alreadyReturnedQty} already returned) exceeds original qty ${origQty} for line ${rl.invoiceLineId}`
          );
        const ratio = rl.returnQty / origQty;
        const unitPrice = parseFloat(String(origLine.unitPrice));
        const cgstAmt = round2(parseFloat(String(origLine.cgstAmount)) * ratio);
        const sgstAmt = round2(parseFloat(String(origLine.sgstAmount)) * ratio);
        const igstAmt = round2(parseFloat(String(origLine.igstAmount)) * ratio);
        const taxableAmt = round2(parseFloat(String(origLine.taxableAmount)) * ratio);
        const lineTotal = round2(taxableAmt + cgstAmt + sgstAmt + igstAmt);

        subtotal = round2(subtotal + unitPrice * rl.returnQty);
        cgstTotal = round2(cgstTotal + cgstAmt);
        sgstTotal = round2(sgstTotal + sgstAmt);
        igstTotal = round2(igstTotal + igstAmt);
        totalAmount = round2(totalAmount + lineTotal);

        returnLineValues.push({
          invoiceLineId: rl.invoiceLineId,
          itemId: rl.itemId,
          variantId: rl.variantId,
          returnQty: String(rl.returnQty),
          unitPrice: String(unitPrice),
          cgstAmount: String(cgstAmt),
          sgstAmount: String(sgstAmt),
          igstAmount: String(igstAmt),
          lineTotal: String(lineTotal),
          tenantId: params.tenantId,
        });

        // Restore stock if physical return
        if (params.isPhysicalReturn && params.warehouseId) {
          const [itemResult] = await trx
            .update(items)
            .set({
              availableQty: sql`${items.availableQty} + ${rl.returnQty}`,
              version: sql`${items.version} + 1`,
            })
            .where(and(eq(items.id, rl.itemId), eq(items.tenantId, params.tenantId)))
            .returning({ availableQty: items.availableQty });

          const afterQty = parseFloat(String(itemResult?.availableQty ?? '0'));

          // Restore the value that the original sale's STOCK_OUT removed — previously this
          // path restored quantity only, leaving currentStockValue/waccCost unchanged, which
          // silently understates WACC going forward (same qty divides into an unchanged, now
          // too-small value) and leaves FIFO items with no layer to re-consume from later.
          const [originalOut] = await trx
            .select({ cogsPerUnit: inventoryLedger.cogsPerUnit })
            .from(inventoryLedger)
            .where(
              and(
                eq(inventoryLedger.tenantId, params.tenantId),
                eq(inventoryLedger.referenceType, 'INVOICE'),
                eq(inventoryLedger.referenceId, params.invoiceId),
                eq(inventoryLedger.referenceLineId, rl.invoiceLineId),
                eq(inventoryLedger.movementType, 'STOCK_OUT')
              )
            );

          stockRestorations.push({
            itemId: rl.itemId,
            variantId: rl.variantId,
            invoiceLineId: rl.invoiceLineId,
            warehouseId: params.warehouseId,
            quantity: rl.returnQty,
            quantityBefore: afterQty - rl.returnQty,
            quantityAfter: afterQty,
            reversalUnitCost: parseFloat(String(originalOut?.cogsPerUnit ?? '0')),
          });
        }
      }

      // Insert sale return header
      const [returnRow] = await trx
        .insert(saleReturns)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          returnNumber: params.returnNumber,
          invoiceId: params.invoiceId,
          customerId: params.customerId,
          status: 'DRAFT',
          returnDate: params.returnDate,
          reason: params.reason,
          isPhysicalReturn: params.isPhysicalReturn,
          warehouseId: params.warehouseId,
          subtotal: String(subtotal),
          cgstAmount: String(cgstTotal),
          sgstAmount: String(sgstTotal),
          igstAmount: String(igstTotal),
          totalAmount: String(totalAmount),
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning({ id: saleReturns.id });
      if (!returnRow)
        throw new BusinessError('RETURN_CREATE_FAILED', 'Failed to create sale return');

      await trx
        .insert(saleReturnLines)
        .values(returnLineValues.map((l) => ({ ...l, returnId: returnRow.id })));

      // Write STOCK_IN inventory ledger rows for stock restored above, and value/project them
      for (const r of stockRestorations) {
        const [ledgerRow] = await trx
          .insert(inventoryLedger)
          .values({
            tenantId: params.tenantId,
            itemId: r.itemId,
            variantId: r.variantId ?? undefined,
            warehouseId: r.warehouseId,
            movementType: 'STOCK_IN' as const,
            quantity: String(r.quantity),
            quantityBefore: String(r.quantityBefore),
            quantityAfter: String(r.quantityAfter),
            referenceType: 'SALE_RETURN',
            referenceId: returnRow.id,
            referenceLineId: r.invoiceLineId,
            unitCost: '0',
            createdBy: params.createdBy,
          })
          .returning({ id: inventoryLedger.id });

        if (r.reversalUnitCost > 0) {
          await ValuationService.applyStockIn(trx, {
            tenantId: params.tenantId,
            itemId: r.itemId,
            variantId: r.variantId ?? undefined,
            warehouseId: r.warehouseId,
            quantity: r.quantity,
            unitCost: r.reversalUnitCost,
            qtyBeforeStockIn: r.quantityBefore,
            sourceLedgerId: ledgerRow!.id,
          });
        }

        // Same per-warehouse projection_stock_level gap as GRN/invoice-confirm had —
        // a physical sale return never incremented it, leaving the Stock Levels page and
        // Physical Verification's snapshot under-reporting the returning warehouse's stock.
        await trx
          .insert(projectionStockLevel)
          .values({
            tenantId: params.tenantId,
            itemId: r.itemId,
            variantId: r.variantId ?? undefined,
            warehouseId: r.warehouseId,
            availableQty: String(Math.max(0, r.quantity)),
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
              availableQty: sql`projection_stock_level.available_qty + ${r.quantity}`,
              lastMovementAt: new Date(),
              updatedAt: new Date(),
            },
          });
      }

      // Auto-create credit note
      const [cnRow] = await trx
        .insert(creditNotes)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          creditNoteNumber: params.creditNoteNumber,
          customerId: params.customerId,
          saleReturnId: returnRow.id,
          originalInvoiceId: params.invoiceId,
          status: 'OPEN',
          amount: String(totalAmount),
          usedAmount: '0',
          remainingAmount: String(totalAmount),
          createdBy: params.createdBy,
        })
        .returning({ id: creditNotes.id });
      if (!cnRow) throw new BusinessError('CREDIT_NOTE_FAILED', 'Failed to create credit note');

      // Link credit note to return
      await trx
        .update(saleReturns)
        .set({ status: 'APPROVED', creditNoteId: cnRow.id })
        .where(eq(saleReturns.id, returnRow.id));

      // Update customer balance projection
      await trx
        .update(projectionCustomerBalance)
        .set({
          currentBalance: sql`${projectionCustomerBalance.currentBalance} - ${totalAmount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectionCustomerBalance.tenantId, params.tenantId),
            eq(projectionCustomerBalance.customerId, params.customerId)
          )
        );

      // G7 fix: SaleReturnGstConsumer.ts's own payload interface has always declared
      // customerGstin/customerName, and its handler already reads them (`p.customerGstin`/
      // `p.customerName`) — but this producer never fetched or sent either, so every credit
      // note's gst_ledger row got gstinOfCounterparty=null regardless of whether the
      // customer was B2B or B2C, which silently routed 100% of credit notes into GSTR-1's
      // CDNUR bucket (unregistered) instead of correctly splitting CDNR (registered) vs
      // CDNUR — the same outbox-payload-truncation shape as the other GST producer fixes.
      const [customer] = await trx
        .select({ displayName: customers.displayName, gstin: customers.gstin })
        .from(customers)
        .where(and(eq(customers.id, params.customerId), eq(customers.tenantId, params.tenantId)));

      // Outbox events
      await trx.insert(outboxEvents).values([
        {
          eventId: ulid(),
          eventType: 'SALE_RETURN_APPROVED',
          aggregateType: 'SaleReturn',
          aggregateId: returnRow.id,
          tenantId: params.tenantId,
          // Financial-correctness audit — two independent consumers listen to this event,
          // and both had a near-total payload mismatch:
          // 1. SaleReturnAccountingConsumer.ts (accounting-service) read `p.grandTotal`,
          //    never sent — every sale return posted ₹0 instead of reversing revenue.
          // 2. SaleReturnGstConsumer.ts (gst-service) expected creditNoteNumber (used as
          //    gst_ledger.document_number, a NOT NULL column — with no fallback, this
          //    consumer likely crash-looped on every sale return) plus
          //    taxableAmount/cgstAmount/sgstAmount/igstAmount (none sent, so every GST-ledger
          //    credit-note entry that did get through would still be a $0 line).
          // Now sends everything both consumers actually declare: the renamed grandTotal,
          // returnNumber/customerId (declared but never received), and the GST breakdown +
          // isInterstate computed the same way InvoiceService.ts's already-fixed equivalent
          // does (directly from igstAmount, not from a sellerStateCode this table doesn't
          // even have a column for — the placeOfSupply/sellerStateCode comparison the GST
          // consumer used to fall back to was the exact same always-true bug already fixed
          // for invoices).
          payload: {
            returnId: returnRow.id,
            returnNumber: params.returnNumber,
            invoiceId: params.invoiceId,
            customerId: params.customerId,
            customerName: customer?.displayName ?? null,
            customerGstin: customer?.gstin ?? null,
            grandTotal: totalAmount,
            creditNoteNumber: params.creditNoteNumber,
            creditNoteDate: params.returnDate.toISOString(),
            taxableAmount: subtotal,
            cgstAmount: cgstTotal,
            sgstAmount: sgstTotal,
            igstAmount: igstTotal,
            isInterstate: igstTotal > 0,
            placeOfSupply: invoice.placeOfSupply,
            branchId: params.branchId,
          },
          published: false,
        },
        {
          eventId: ulid(),
          eventType: 'CREDIT_NOTE_CREATED',
          aggregateType: 'CreditNote',
          aggregateId: cnRow.id,
          tenantId: params.tenantId,
          payload: { creditNoteId: cnRow.id, customerId: params.customerId, amount: totalAmount },
          published: false,
        },
      ]);

      return { returnId: returnRow.id, creditNoteId: cnRow.id };
    });
  }

  async applyCreditNote(
    creditNoteId: number,
    invoiceId: number,
    tenantId: number,
    _userId: number
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [cn] = await trx
        .select()
        .from(creditNotes)
        .where(and(eq(creditNotes.id, creditNoteId), eq(creditNotes.tenantId, tenantId)));
      if (!cn) throw new NotFoundError('Credit note not found');
      if (!['OPEN', 'PARTIALLY_USED'].includes(cn.status))
        throw new BusinessError('CREDIT_NOTE_EXHAUSTED', 'Credit note has no remaining balance');

      // FOR UPDATE (ES-23 [C5]): applyCreditNote and PaymentService.allocate both
      // read-then-write invoices.balanceDue; without this lock, a payment allocation
      // and a credit-note application racing on the same invoice can each compute
      // applyAmt/newBalance from the same stale snapshot.
      const [invoice] = await trx
        .select({ balanceDue: invoices.balanceDue, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
        .for('update');
      if (!invoice) throw new NotFoundError('Invoice not found');

      const remaining = parseFloat(String(cn.remainingAmount));
      const balanceDue = parseFloat(String(invoice.balanceDue));
      const applyAmt = Math.min(remaining, balanceDue);

      await trx
        .update(creditNotes)
        .set({
          usedAmount: sql`${creditNotes.usedAmount} + ${applyAmt}`,
          remainingAmount: String(round2(remaining - applyAmt)),
          status: remaining - applyAmt <= 0.01 ? 'FULLY_USED' : 'PARTIALLY_USED',
          updatedAt: new Date(),
        })
        .where(eq(creditNotes.id, creditNoteId));

      const newBalance = round2(balanceDue - applyAmt);
      await trx
        .update(invoices)
        .set({
          paidAmount: sql`${invoices.paidAmount} + ${applyAmt}`,
          balanceDue: String(newBalance),
          status: newBalance <= 0.01 ? 'PAID' : 'PARTIALLY_PAID',
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
    });
  }

  // C-6 fix: the route this replaces set status='REFUNDED' directly with no status guard and
  // no transaction/lock — unlike applyCreditNote just above, which was already hardened
  // (ES-23 [C5]) against exactly this class of race. Two concurrent refund requests against
  // the same credit note could both succeed, a real double-refund financial-loss vector.
  async refundCreditNote(creditNoteId: number, tenantId: number, _userId: number): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [cn] = await trx
        .select()
        .from(creditNotes)
        .where(and(eq(creditNotes.id, creditNoteId), eq(creditNotes.tenantId, tenantId)))
        .for('update');
      if (!cn) throw new NotFoundError('Credit note not found');
      if (!['OPEN', 'PARTIALLY_USED'].includes(cn.status))
        throw new BusinessError(
          'CREDIT_NOTE_EXHAUSTED',
          'Credit note has no remaining balance to refund'
        );

      await trx
        .update(creditNotes)
        .set({
          status: 'REFUNDED',
          usedAmount: creditNotes.amount,
          remainingAmount: '0',
          updatedAt: new Date(),
        })
        .where(and(eq(creditNotes.id, creditNoteId), eq(creditNotes.tenantId, tenantId)));
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
