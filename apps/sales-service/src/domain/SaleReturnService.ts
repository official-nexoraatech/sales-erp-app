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
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { ulid } from 'ulid';

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

  async create(params: CreateSaleReturnParams): Promise<{ returnId: number; creditNoteId: number }> {
    return this.db.transaction(async (trx) => {
      const [invoice] = await trx
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, params.invoiceId), eq(invoices.tenantId, params.tenantId)));
      if (!invoice) throw new NotFoundError('Invoice not found');
      if (!['CONFIRMED', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status))
        throw new BusinessError('INVALID_INVOICE_STATUS', `Cannot return invoice in status ${invoice.status}`);

      // Fetch original lines to compute return amounts with matching GST
      let totalAmount = 0;
      let cgstTotal = 0, sgstTotal = 0, igstTotal = 0, subtotal = 0;
      const returnLineValues = [];

      for (const rl of params.lines) {
        const [origLine] = await trx
          .select()
          .from(invoiceLines)
          .where(and(eq(invoiceLines.id, rl.invoiceLineId), eq(invoiceLines.invoiceId, params.invoiceId)));
        if (!origLine) throw new NotFoundError(`Invoice line ${rl.invoiceLineId} not found`);

        const origQty = parseFloat(String(origLine.quantity));
        if (rl.returnQty > origQty)
          throw new BusinessError('RETURN_QTY_EXCEEDED', `Return qty ${rl.returnQty} exceeds original qty ${origQty} for line ${rl.invoiceLineId}`);
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
          await trx
            .update(items)
            .set({
              availableQty: sql`${items.availableQty} + ${rl.returnQty}`,
              version: sql`${items.version} + 1`,
            })
            .where(and(eq(items.id, rl.itemId), eq(items.tenantId, params.tenantId)));
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
      if (!returnRow) throw new BusinessError('RETURN_CREATE_FAILED', 'Failed to create sale return');

      await trx.insert(saleReturnLines).values(
        returnLineValues.map((l) => ({ ...l, returnId: returnRow.id }))
      );

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
        .where(and(
          eq(projectionCustomerBalance.tenantId, params.tenantId),
          eq(projectionCustomerBalance.customerId, params.customerId)
        ));

      // Outbox events
      await trx.insert(outboxEvents).values([
        {
          eventId: ulid(),
          eventType: 'SALE_RETURN_APPROVED',
          aggregateType: 'SaleReturn',
          aggregateId: returnRow.id,
          tenantId: params.tenantId,
          payload: { returnId: returnRow.id, invoiceId: params.invoiceId, totalAmount },
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
    userId: number
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [cn] = await trx
        .select()
        .from(creditNotes)
        .where(and(eq(creditNotes.id, creditNoteId), eq(creditNotes.tenantId, tenantId)));
      if (!cn) throw new NotFoundError('Credit note not found');
      if (!['OPEN', 'PARTIALLY_USED'].includes(cn.status))
        throw new BusinessError('CREDIT_NOTE_EXHAUSTED', 'Credit note has no remaining balance');

      const [invoice] = await trx
        .select({ balanceDue: invoices.balanceDue, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
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
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
