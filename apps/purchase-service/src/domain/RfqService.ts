import { and, eq, desc, getTableColumns, inArray } from 'drizzle-orm';
import {
  rfqs,
  rfqLines,
  rfqSuppliers,
  supplierQuotations,
  supplierQuotationLines,
  items,
  suppliers,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { PurchaseOrderService, type POLineInput } from './PurchaseOrderService.js';

export interface RfqLineInput {
  itemId: number;
  description?: string | undefined;
  qty: number;
  unitId?: number | undefined;
}

export interface CreateRfqParams {
  tenantId: number;
  branchId: number;
  dueDate?: Date | undefined;
  lines: RfqLineInput[];
  supplierIds: number[];
  notes?: string | undefined;
  requisitionId?: number | undefined;
  createdBy: number;
}

export interface QuotationLineInput {
  rfqLineId: number;
  itemId: number;
  qty: number;
  unitPrice: number;
  gstRate?: number | undefined;
  deliveryDays?: number | undefined;
}

export interface RecordQuotationParams {
  tenantId: number;
  rfqId: number;
  supplierId: number;
  quotationNumber?: string | undefined;
  validTill?: Date | undefined;
  lines: QuotationLineInput[];
  notes?: string | undefined;
  createdBy: number;
}

export interface SelectQuotationParams {
  branchId: number;
  warehouseId: number;
  poDate: Date;
  placeOfSupply: string;
  sellerStateCode?: string | undefined;
  hsnByItem?: Record<number, string> | undefined;
}

export class RfqService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateRfqParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      const [row] = await trx
        .insert(rfqs)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          rfqNumber: `RFQ-${params.tenantId}-${Date.now()}`,
          requisitionId: params.requisitionId,
          status: params.supplierIds.length > 0 ? 'SENT' : 'DRAFT',
          dueDate: params.dueDate,
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning({ id: rfqs.id });

      if (!row) throw new BusinessError('RFQ_CREATE_FAILED', 'Failed to create RFQ');

      await trx.insert(rfqLines).values(
        params.lines.map((l, i) => ({
          rfqId: row.id,
          tenantId: params.tenantId,
          lineNumber: i + 1,
          itemId: l.itemId,
          description: l.description,
          qty: String(l.qty),
          unitId: l.unitId,
        }))
      );

      if (params.supplierIds.length > 0) {
        await trx.insert(rfqSuppliers).values(
          params.supplierIds.map((supplierId) => ({
            rfqId: row.id,
            tenantId: params.tenantId,
            supplierId,
          }))
        );
      }

      return row.id;
    });
  }

  async recordQuotation(params: RecordQuotationParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      const [rfq] = await trx
        .select()
        .from(rfqs)
        .where(and(eq(rfqs.id, params.rfqId), eq(rfqs.tenantId, params.tenantId)));
      if (!rfq) throw new NotFoundError('Rfq', params.rfqId);
      if (rfq.status === 'CLOSED' || rfq.status === 'CANCELLED')
        throw new BusinessError(
          'INVALID_STATUS',
          `Cannot record a quotation for a ${rfq.status} RFQ`
        );

      const grandTotal = params.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);

      const [row] = await trx
        .insert(supplierQuotations)
        .values({
          tenantId: params.tenantId,
          rfqId: params.rfqId,
          supplierId: params.supplierId,
          quotationNumber: params.quotationNumber,
          validTill: params.validTill,
          grandTotal: String(grandTotal),
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning({ id: supplierQuotations.id });

      if (!row) throw new BusinessError('QUOTATION_CREATE_FAILED', 'Failed to record quotation');

      await trx.insert(supplierQuotationLines).values(
        params.lines.map((l) => ({
          quotationId: row.id,
          tenantId: params.tenantId,
          rfqLineId: l.rfqLineId,
          itemId: l.itemId,
          qty: String(l.qty),
          unitPrice: String(l.unitPrice),
          gstRate: String(l.gstRate ?? 0),
          deliveryDays: l.deliveryDays,
          lineTotal: String(l.qty * l.unitPrice),
        }))
      );

      await trx
        .update(rfqSuppliers)
        .set({ status: 'RESPONDED' })
        .where(
          and(eq(rfqSuppliers.rfqId, params.rfqId), eq(rfqSuppliers.supplierId, params.supplierId))
        );

      return row.id;
    });
  }

  /** Comparison view: every quotation received for an RFQ, with its lines, sorted cheapest first. */
  async compare(rfqId: number, tenantId: number) {
    const [rfq] = await this.db
      .select()
      .from(rfqs)
      .where(and(eq(rfqs.id, rfqId), eq(rfqs.tenantId, tenantId)));
    if (!rfq) throw new NotFoundError('Rfq', rfqId);

    const rfqLineRows = await this.db
      .select({ ...getTableColumns(rfqLines), itemName: items.name })
      .from(rfqLines)
      .leftJoin(items, eq(rfqLines.itemId, items.id))
      .where(eq(rfqLines.rfqId, rfqId));

    const quotations = await this.db
      .select({ ...getTableColumns(supplierQuotations), supplierName: suppliers.displayName })
      .from(supplierQuotations)
      .leftJoin(suppliers, eq(supplierQuotations.supplierId, suppliers.id))
      .where(and(eq(supplierQuotations.rfqId, rfqId), eq(supplierQuotations.tenantId, tenantId)))
      .orderBy(supplierQuotations.grandTotal);

    const quotationIds = quotations.map((q) => q.id);
    const lines =
      quotationIds.length > 0
        ? await this.db
            .select()
            .from(supplierQuotationLines)
            .where(
              and(
                eq(supplierQuotationLines.tenantId, tenantId),
                inArray(supplierQuotationLines.quotationId, quotationIds)
              )
            )
        : [];
    const linesByQuotation = new Map<number, typeof lines>();
    for (const l of lines) {
      const arr = linesByQuotation.get(l.quotationId) ?? [];
      arr.push(l);
      linesByQuotation.set(l.quotationId, arr);
    }

    return {
      rfq,
      rfqLines: rfqLineRows,
      quotations: quotations.map((q) => ({ ...q, lines: linesByQuotation.get(q.id) ?? [] })),
    };
  }

  async selectQuotation(
    quotationId: number,
    tenantId: number,
    userId: number,
    params: SelectQuotationParams
  ): Promise<number> {
    const [quotation] = await this.db
      .select()
      .from(supplierQuotations)
      .where(
        and(eq(supplierQuotations.id, quotationId), eq(supplierQuotations.tenantId, tenantId))
      );
    if (!quotation) throw new NotFoundError('SupplierQuotation', quotationId);
    if (quotation.status === 'SELECTED')
      throw new BusinessError('ALREADY_SELECTED', 'This quotation has already been selected');

    const lines = await this.db
      .select()
      .from(supplierQuotationLines)
      .where(eq(supplierQuotationLines.quotationId, quotationId));
    if (lines.length === 0)
      throw new BusinessError('QUOTATION_EMPTY', 'Quotation has no lines to convert');

    const poLines: POLineInput[] = lines.map((l) => ({
      itemId: l.itemId,
      orderedQty: parseFloat(String(l.qty)),
      unitPrice: parseFloat(String(l.unitPrice)),
      gstRate: parseFloat(String(l.gstRate)),
      hsnCode: params.hsnByItem?.[l.itemId],
    }));

    const svc = new PurchaseOrderService(this.db);
    const poId = await svc.create({
      tenantId,
      branchId: params.branchId,
      warehouseId: params.warehouseId,
      supplierId: quotation.supplierId,
      poDate: params.poDate,
      placeOfSupply: params.placeOfSupply,
      sellerStateCode: params.sellerStateCode,
      lines: poLines,
      createdBy: userId,
    });

    await this.db
      .update(supplierQuotations)
      .set({ status: 'SELECTED', convertedToPoId: poId })
      .where(
        and(eq(supplierQuotations.id, quotationId), eq(supplierQuotations.tenantId, tenantId))
      );

    // Every other quotation on the same RFQ is implicitly not the winner — reject them so
    // the comparison view doesn't leave stale SUBMITTED rows next to the SELECTED one.
    await this.db
      .update(supplierQuotations)
      .set({ status: 'REJECTED' })
      .where(
        and(
          eq(supplierQuotations.rfqId, quotation.rfqId),
          eq(supplierQuotations.tenantId, tenantId),
          eq(supplierQuotations.status, 'SUBMITTED')
        )
      );

    await this.db
      .update(rfqs)
      .set({ status: 'CLOSED', updatedAt: new Date() })
      .where(and(eq(rfqs.id, quotation.rfqId), eq(rfqs.tenantId, tenantId)));

    return poId;
  }

  async list(tenantId: number, status?: string, branchIds?: number[]) {
    const conditions = [eq(rfqs.tenantId, tenantId)];
    if (status) conditions.push(eq(rfqs.status, status as never));
    if (branchIds) conditions.push(inArray(rfqs.branchId, branchIds));
    return this.db
      .select()
      .from(rfqs)
      .where(and(...conditions))
      .orderBy(desc(rfqs.createdAt));
  }
}
