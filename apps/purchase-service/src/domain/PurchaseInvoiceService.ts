import { and, eq, desc, inArray } from 'drizzle-orm';
import { purchaseInvoices, purchaseInvoiceLines, grns, grnLines } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';

// Purchase audit 2026-07-21 gap-fix: this service is a reconciliation/audit layer only. This
// system posts AP/GST at GRN approval (2-way PO<->GRN match, see GRNService.approve) — that
// posting trigger is deliberately UNCHANGED by this service. Recording or approving a Purchase
// Invoice here never touches accounting/GST ledgers or SupplierPaymentService; it only
// captures what the supplier's actual bill says versus what the GRN recorded, and flags
// qty/rate variance for a human to review before/alongside paying the supplier.
export interface InvoiceLineInput {
  grnLineId: number;
  invoicedQty: number;
  invoicedRate: number;
}

export interface CreatePurchaseInvoiceParams {
  tenantId: number;
  branchId: number;
  supplierInvoiceNumber: string;
  supplierId: number;
  purchaseOrderId: number;
  grnId: number;
  invoiceDate: Date;
  lines: InvoiceLineInput[];
  notes?: string | undefined;
  createdBy: number;
}

const VARIANCE_TOLERANCE = 0.005; // ignore floating-point noise, not a real business tolerance

export class PurchaseInvoiceService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreatePurchaseInvoiceParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      const [grn] = await trx
        .select()
        .from(grns)
        .where(and(eq(grns.id, params.grnId), eq(grns.tenantId, params.tenantId)));
      if (!grn) throw new NotFoundError('GRN', params.grnId);
      if (grn.status !== 'APPROVED')
        throw new BusinessError(
          'INVALID_GRN_STATUS',
          'Can only invoice-match against an APPROVED GRN'
        );

      const grnLineRows = await trx.select().from(grnLines).where(eq(grnLines.grnId, params.grnId));
      const grnLineById = new Map(grnLineRows.map((l) => [l.id, l]));

      let subtotal = 0;
      let varianceAmount = 0;
      let hasVariance = false;
      const computedLines = params.lines.map((l) => {
        const grnLine = grnLineById.get(l.grnLineId);
        if (!grnLine)
          throw new BusinessError(
            'GRN_LINE_NOT_FOUND',
            `GRN line ${l.grnLineId} not found on GRN ${params.grnId}`
          );

        const grnQty = parseFloat(String(grnLine.receivedQty));
        const grnRate = parseFloat(String(grnLine.grnRate));
        const qtyVariance = l.invoicedQty - grnQty;
        const rateVariance = l.invoicedRate - grnRate;
        if (
          Math.abs(qtyVariance) > VARIANCE_TOLERANCE ||
          Math.abs(rateVariance) > VARIANCE_TOLERANCE
        )
          hasVariance = true;

        const lineTotal = l.invoicedQty * l.invoicedRate;
        const grnLineTotal = grnQty * grnRate;
        subtotal += lineTotal;
        varianceAmount += lineTotal - grnLineTotal;

        return {
          grnLineId: l.grnLineId,
          itemId: grnLine.itemId,
          invoicedQty: l.invoicedQty,
          invoicedRate: l.invoicedRate,
          qtyVariance,
          rateVariance,
          lineTotal,
        };
      });

      const [row] = await trx
        .insert(purchaseInvoices)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          invoiceNumber: `PINV-${params.tenantId}-${Date.now()}`,
          supplierInvoiceNumber: params.supplierInvoiceNumber,
          supplierId: params.supplierId,
          purchaseOrderId: params.purchaseOrderId,
          grnId: params.grnId,
          invoiceDate: params.invoiceDate,
          status: hasVariance ? 'VARIANCE' : 'MATCHED',
          subtotal: String(subtotal),
          grandTotal: String(subtotal),
          varianceAmount: String(varianceAmount),
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning({ id: purchaseInvoices.id });

      if (!row)
        throw new BusinessError('INVOICE_CREATE_FAILED', 'Failed to create purchase invoice');

      await trx.insert(purchaseInvoiceLines).values(
        computedLines.map((l) => ({
          invoiceId: row.id,
          tenantId: params.tenantId,
          grnLineId: l.grnLineId,
          itemId: l.itemId,
          invoicedQty: String(l.invoicedQty),
          invoicedRate: String(l.invoicedRate),
          qtyVariance: String(l.qtyVariance),
          rateVariance: String(l.rateVariance),
          lineTotal: String(l.lineTotal),
        }))
      );

      return row.id;
    });
  }

  async approve(id: number, tenantId: number, userId: number): Promise<void> {
    const [invoice] = await this.db
      .select()
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.tenantId, tenantId)));
    if (!invoice) throw new NotFoundError('PurchaseInvoice', id);
    if (invoice.status === 'APPROVED')
      throw new BusinessError('ALREADY_APPROVED', 'Purchase invoice is already approved');

    await this.db
      .update(purchaseInvoices)
      .set({ status: 'APPROVED', approvedBy: userId, approvedAt: new Date() })
      .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.tenantId, tenantId)));
  }

  async list(tenantId: number, status?: string, branchIds?: number[]) {
    const conditions = [eq(purchaseInvoices.tenantId, tenantId)];
    if (status) conditions.push(eq(purchaseInvoices.status, status as never));
    if (branchIds) conditions.push(inArray(purchaseInvoices.branchId, branchIds));
    return this.db
      .select()
      .from(purchaseInvoices)
      .where(and(...conditions))
      .orderBy(desc(purchaseInvoices.createdAt));
  }

  async getWithLines(id: number, tenantId: number) {
    const [invoice] = await this.db
      .select()
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.tenantId, tenantId)));
    if (!invoice) throw new NotFoundError('PurchaseInvoice', id);

    const lines = await this.db
      .select()
      .from(purchaseInvoiceLines)
      .where(eq(purchaseInvoiceLines.invoiceId, id));

    return { ...invoice, lines };
  }
}
