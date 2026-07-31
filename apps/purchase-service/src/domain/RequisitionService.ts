import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { purchaseRequisitions, purchaseRequisitionLines, items } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { PurchaseOrderService, type POLineInput } from './PurchaseOrderService.js';

export interface RequisitionLineInput {
  itemId: number;
  description?: string | undefined;
  requestedQty: number;
  unitId?: number | undefined;
  estimatedUnitPrice?: number | undefined;
}

export interface CreateRequisitionParams {
  tenantId: number;
  branchId: number;
  department?: string | undefined;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | undefined;
  requiredByDate?: Date | undefined;
  lines: RequisitionLineInput[];
  notes?: string | undefined;
  requestedBy: number;
}

// PO conversion needs GST/pricing/supplier context the requisition itself never captures
// (it's a pre-procurement "we need this" record, not priced) — caller supplies those, same
// as any normal PO creation, while item/qty come from the requisition's own lines.
export interface ConvertLineOverride {
  itemId: number;
  unitPrice: number;
  gstRate: number;
  hsnCode?: string | undefined;
}

export interface ConvertToPOParams {
  supplierId: number;
  branchId: number;
  warehouseId: number;
  poDate: Date;
  placeOfSupply: string;
  sellerStateCode?: string | undefined;
  lineOverrides: ConvertLineOverride[];
}

export class RequisitionService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateRequisitionParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      const estimatedTotal = params.lines.reduce(
        (sum, l) => sum + l.requestedQty * (l.estimatedUnitPrice ?? 0),
        0
      );

      const [row] = await trx
        .insert(purchaseRequisitions)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          requisitionNumber: `REQ-${params.tenantId}-${Date.now()}`,
          department: params.department,
          priority: params.priority ?? 'MEDIUM',
          status: 'DRAFT',
          requiredByDate: params.requiredByDate,
          estimatedTotal: String(estimatedTotal),
          notes: params.notes,
          requestedBy: params.requestedBy,
        })
        .returning({ id: purchaseRequisitions.id });

      if (!row)
        throw new BusinessError('REQUISITION_CREATE_FAILED', 'Failed to create requisition');

      await trx.insert(purchaseRequisitionLines).values(
        params.lines.map((l, i) => ({
          requisitionId: row.id,
          tenantId: params.tenantId,
          lineNumber: i + 1,
          itemId: l.itemId,
          description: l.description,
          requestedQty: String(l.requestedQty),
          unitId: l.unitId,
          estimatedUnitPrice: String(l.estimatedUnitPrice ?? 0),
        }))
      );

      return row.id;
    });
  }

  async submit(id: number, tenantId: number, userId: number): Promise<void> {
    const [req] = await this.db
      .select()
      .from(purchaseRequisitions)
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.tenantId, tenantId)));
    if (!req) throw new NotFoundError('PurchaseRequisition', id);
    if (req.status !== 'DRAFT')
      throw new BusinessError(
        'INVALID_STATUS',
        `Cannot submit requisition in status ${req.status}`
      );

    await this.db
      .update(purchaseRequisitions)
      .set({
        status: 'SUBMITTED',
        updatedAt: new Date(),
        version: sql`${purchaseRequisitions.version} + 1`,
      })
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.tenantId, tenantId)));
    void userId;
  }

  async approve(id: number, tenantId: number, userId: number): Promise<void> {
    const [req] = await this.db
      .select()
      .from(purchaseRequisitions)
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.tenantId, tenantId)));
    if (!req) throw new NotFoundError('PurchaseRequisition', id);
    if (req.status !== 'SUBMITTED')
      throw new BusinessError(
        'INVALID_STATUS',
        `Cannot approve requisition in status ${req.status}`
      );

    await this.db
      .update(purchaseRequisitions)
      .set({
        status: 'APPROVED',
        approvedBy: userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
        version: sql`${purchaseRequisitions.version} + 1`,
      })
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.tenantId, tenantId)));
  }

  async reject(id: number, tenantId: number, userId: number, reason: string): Promise<void> {
    const [req] = await this.db
      .select()
      .from(purchaseRequisitions)
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.tenantId, tenantId)));
    if (!req) throw new NotFoundError('PurchaseRequisition', id);
    if (req.status !== 'SUBMITTED')
      throw new BusinessError(
        'INVALID_STATUS',
        `Cannot reject requisition in status ${req.status}`
      );

    await this.db
      .update(purchaseRequisitions)
      .set({
        status: 'REJECTED',
        rejectionReason: reason,
        approvedBy: userId,
        approvedAt: new Date(),
        updatedAt: new Date(),
        version: sql`${purchaseRequisitions.version} + 1`,
      })
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.tenantId, tenantId)));
  }

  async convertToPO(
    id: number,
    tenantId: number,
    userId: number,
    params: ConvertToPOParams
  ): Promise<number> {
    const [req] = await this.db
      .select()
      .from(purchaseRequisitions)
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.tenantId, tenantId)));
    if (!req) throw new NotFoundError('PurchaseRequisition', id);
    if (req.status !== 'APPROVED')
      throw new BusinessError(
        'INVALID_STATUS',
        `Cannot convert requisition in status ${req.status}`
      );

    const lines = await this.db
      .select()
      .from(purchaseRequisitionLines)
      .where(eq(purchaseRequisitionLines.requisitionId, id));
    if (lines.length === 0)
      throw new BusinessError('REQUISITION_EMPTY', 'Requisition has no lines to convert');

    const overrideByItem = new Map(params.lineOverrides.map((o) => [o.itemId, o]));
    const poLines: POLineInput[] = lines.map((l) => {
      const override = overrideByItem.get(l.itemId);
      if (!override)
        throw new BusinessError(
          'MISSING_LINE_OVERRIDE',
          `No price/GST override supplied for requisition item ${l.itemId}`
        );
      return {
        itemId: l.itemId,
        description: l.description ?? undefined,
        orderedQty: parseFloat(String(l.requestedQty)),
        unitId: l.unitId ?? undefined,
        unitPrice: override.unitPrice,
        gstRate: override.gstRate,
        hsnCode: override.hsnCode,
      };
    });

    const svc = new PurchaseOrderService(this.db);
    const poId = await svc.create({
      tenantId,
      branchId: params.branchId,
      warehouseId: params.warehouseId,
      supplierId: params.supplierId,
      poDate: params.poDate,
      placeOfSupply: params.placeOfSupply,
      sellerStateCode: params.sellerStateCode,
      lines: poLines,
      requisitionId: id,
      createdBy: userId,
    });

    await this.db
      .update(purchaseRequisitions)
      .set({
        status: 'CONVERTED',
        convertedToPoId: poId,
        updatedAt: new Date(),
        version: sql`${purchaseRequisitions.version} + 1`,
      })
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.tenantId, tenantId)));

    return poId;
  }

  async list(tenantId: number, status?: string, branchIds?: number[]) {
    const conditions = [eq(purchaseRequisitions.tenantId, tenantId)];
    if (status) conditions.push(eq(purchaseRequisitions.status, status as never));
    if (branchIds) conditions.push(inArray(purchaseRequisitions.branchId, branchIds));
    return this.db
      .select()
      .from(purchaseRequisitions)
      .where(and(...conditions))
      .orderBy(desc(purchaseRequisitions.createdAt));
  }

  async getWithLines(id: number, tenantId: number) {
    const [req] = await this.db
      .select()
      .from(purchaseRequisitions)
      .where(and(eq(purchaseRequisitions.id, id), eq(purchaseRequisitions.tenantId, tenantId)));
    if (!req) throw new NotFoundError('PurchaseRequisition', id);

    const lines = await this.db
      .select({
        id: purchaseRequisitionLines.id,
        lineNumber: purchaseRequisitionLines.lineNumber,
        itemId: purchaseRequisitionLines.itemId,
        itemName: items.name,
        description: purchaseRequisitionLines.description,
        requestedQty: purchaseRequisitionLines.requestedQty,
        unitId: purchaseRequisitionLines.unitId,
        estimatedUnitPrice: purchaseRequisitionLines.estimatedUnitPrice,
      })
      .from(purchaseRequisitionLines)
      .leftJoin(items, eq(purchaseRequisitionLines.itemId, items.id))
      .where(eq(purchaseRequisitionLines.requisitionId, id));

    return { ...req, lines };
  }
}
