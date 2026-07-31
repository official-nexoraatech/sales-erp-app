import { and, eq, lt, inArray, getTableColumns } from 'drizzle-orm';
import { quotations, quotationLines, outboxEvents, customers, items } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { GSTCalculator } from '@erp/utils';
import { ulid } from 'ulid';

export interface QuotationLineInput {
  itemId: number;
  variantId?: number;
  description?: string;
  quantity: number;
  unitId?: number;
  unitPrice: number;
  discountPct?: number;
  discountAmount?: number;
  gstRate: number;
  hsnCode?: string;
}

export interface CreateQuotationParams {
  tenantId: number;
  branchId: number;
  customerId: number;
  quotationNumber: string;
  placeOfSupply: string;
  sellerStateCode: string;
  validUntil: Date;
  lines: QuotationLineInput[];
  notes?: string;
  termsAndConditions?: string;
  createdBy: number;
}

export class QuotationService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateQuotationParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      // H-3 fix: QuotationService.create() never looked up the customer row at all, so a
      // blocked or inactive customer could still receive a new quotation.
      if (params.customerId > 0) {
        const [customer] = await trx
          .select({ status: customers.status })
          .from(customers)
          .where(and(eq(customers.id, params.customerId), eq(customers.tenantId, params.tenantId)));
        if (!customer) throw new NotFoundError('Customer not found');
        if (customer.status === 'BLOCKED') {
          throw new BusinessError(
            'CUSTOMER_BLOCKED',
            `Customer ${params.customerId} is blocked and cannot receive a quotation`
          );
        }
        if (customer.status === 'INACTIVE') {
          throw new BusinessError(
            'CUSTOMER_INACTIVE',
            `Customer ${params.customerId} is inactive and cannot receive a quotation`
          );
        }
      }

      const computedLines = params.lines.map((l, i) => {
        const gst = GSTCalculator.computeLine({
          unitPrice: l.unitPrice,
          quantity: l.quantity,
          discountPct: l.discountPct ?? 0,
          discountAmount: l.discountAmount ?? 0,
          gstRate: l.gstRate,
          sellerStateCode: params.sellerStateCode,
          placeOfSupply: params.placeOfSupply,
        });
        return { ...l, ...gst, lineNumber: i + 1 };
      });

      // computedLines already carries every GSTLineResult field (subtotal/discountAmount/
      // taxableAmount/etc.) via the ...gst spread above — no need to reconstruct a
      // discount-input-plus-result shape the way the old per-service sumTotals required.
      const totals = GSTCalculator.sumTotals(computedLines);

      const [row] = await trx
        .insert(quotations)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          quotationNumber: params.quotationNumber,
          customerId: params.customerId,
          status: 'DRAFT',
          placeOfSupply: params.placeOfSupply,
          validUntil: params.validUntil,
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
        .returning({ id: quotations.id });

      if (!row) throw new BusinessError('QUOTATION_CREATE_FAILED', 'Failed to create quotation');
      const quotationId = row.id;

      await trx.insert(quotationLines).values(
        computedLines.map((l) => ({
          quotationId,
          tenantId: params.tenantId,
          lineNumber: l.lineNumber,
          itemId: l.itemId,
          variantId: l.variantId,
          description: l.description,
          quantity: String(l.quantity),
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

      return quotationId;
    });
  }

  async send(id: number, tenantId: number, userId: number): Promise<void> {
    const [q] = await this.db
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)));
    if (!q) throw new NotFoundError('Quotation not found');
    if (!['DRAFT', 'SENT'].includes(q.status))
      throw new BusinessError('INVALID_STATUS', `Cannot send quotation in status ${q.status}`);

    await this.db
      .update(quotations)
      .set({ status: 'SENT', sentAt: new Date(), updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)));
  }

  async accept(id: number, tenantId: number, userId: number): Promise<void> {
    const [q] = await this.db
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)));
    if (!q) throw new NotFoundError('Quotation not found');
    if (!['SENT', 'VIEWED'].includes(q.status))
      throw new BusinessError('INVALID_STATUS', `Cannot accept quotation in status ${q.status}`);
    // M-10 fix: accept() didn't check validUntil itself — it relied entirely on the separate
    // expireStale() cron sweep, leaving a same-day race where an already-expired quotation
    // could still be accepted before that job next runs.
    if (new Date(q.validUntil) < new Date())
      throw new BusinessError(
        'QUOTATION_EXPIRED',
        'This quotation has expired and can no longer be accepted'
      );

    await this.db
      .update(quotations)
      .set({ status: 'ACCEPTED', updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)));
  }

  async reject(id: number, tenantId: number, userId: number): Promise<void> {
    const [q] = await this.db
      .select()
      .from(quotations)
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)));
    if (!q) throw new NotFoundError('Quotation not found');
    if (!['SENT', 'VIEWED'].includes(q.status))
      throw new BusinessError('INVALID_STATUS', `Cannot reject quotation in status ${q.status}`);

    await this.db
      .update(quotations)
      .set({ status: 'REJECTED', updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)));
  }

  async convert(id: number, tenantId: number, userId: number): Promise<{ quotationId: number }> {
    return this.db.transaction(async (trx) => {
      const [q] = await trx
        .select()
        .from(quotations)
        .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)));
      if (!q) throw new NotFoundError('Quotation not found');
      if (q.status !== 'ACCEPTED')
        throw new BusinessError(
          'INVALID_STATUS',
          `Cannot convert quotation in status ${q.status} — must be ACCEPTED`
        );

      await trx
        .update(quotations)
        .set({
          status: 'CONVERTED',
          convertedAt: new Date(),
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)));

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'QUOTATION_CONVERTED',
        aggregateType: 'Quotation',
        aggregateId: id,
        tenantId,
        payload: {
          quotationId: id,
          customerId: q.customerId,
          grandTotal: q.grandTotal,
          convertedBy: userId,
        },
        published: false,
      });

      return { quotationId: id };
    });
  }

  async expireStale(db: ErpDatabase): Promise<number> {
    const rows = await db
      .update(quotations)
      .set({ status: 'EXPIRED', updatedAt: new Date() })
      .where(
        and(
          inArray(quotations.status, ['DRAFT', 'SENT', 'VIEWED']),
          lt(quotations.validUntil, new Date())
        )
      )
      .returning({ id: quotations.id });
    return rows.length;
  }

  async getWithLines(id: number, tenantId: number) {
    const [q] = await this.db
      .select({ ...getTableColumns(quotations), customerName: customers.displayName })
      .from(quotations)
      .leftJoin(customers, eq(quotations.customerId, customers.id))
      .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenantId)));
    if (!q) throw new NotFoundError('Quotation not found');

    const lines = await this.db
      .select({ ...getTableColumns(quotationLines), itemName: items.name })
      .from(quotationLines)
      .leftJoin(items, eq(quotationLines.itemId, items.id))
      .where(eq(quotationLines.quotationId, id));

    return { ...q, lines };
  }
}
