import { and, eq } from 'drizzle-orm';
import { deliveryChallans, deliveryChallanLines, invoices } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';

export interface ChallanLineInput {
  itemId: number;
  variantId?: number;
  description?: string;
  quantity: number;
  unitId?: number;
  unitPrice?: number;
  hsnCode?: string;
}

export interface CreateChallanParams {
  tenantId: number;
  branchId: number;
  warehouseId: number;
  customerId: number;
  challanNumber: string;
  challanDate: Date;
  deliveryAddress?: object;
  lines: ChallanLineInput[];
  notes?: string;
  createdBy: number;
}

export class DeliveryChallanService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateChallanParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      const subtotal = params.lines.reduce(
        (s, l) => s + (l.unitPrice ?? 0) * l.quantity, 0
      );

      const [row] = await trx
        .insert(deliveryChallans)
        .values({
          tenantId: params.tenantId,
          branchId: params.branchId,
          warehouseId: params.warehouseId,
          challanNumber: params.challanNumber,
          customerId: params.customerId,
          status: 'DRAFT',
          challanDate: params.challanDate,
          deliveryAddress: params.deliveryAddress,
          subtotal: String(round2(subtotal)),
          notes: params.notes,
          createdBy: params.createdBy,
        })
        .returning({ id: deliveryChallans.id });

      if (!row) throw new BusinessError('CHALLAN_CREATE_FAILED', 'Failed to create delivery challan');

      await trx.insert(deliveryChallanLines).values(
        params.lines.map((l, i) => ({
          challanId: row.id,
          tenantId: params.tenantId,
          lineNumber: i + 1,
          itemId: l.itemId,
          variantId: l.variantId,
          description: l.description,
          quantity: String(l.quantity),
          unitId: l.unitId,
          unitPrice: l.unitPrice !== undefined ? String(l.unitPrice) : undefined,
          hsnCode: l.hsnCode,
        }))
      );

      return row.id;
    });
  }

  async dispatch(id: number, tenantId: number, userId: number): Promise<void> {
    const [challan] = await this.db
      .select()
      .from(deliveryChallans)
      .where(and(eq(deliveryChallans.id, id), eq(deliveryChallans.tenantId, tenantId)));
    if (!challan) throw new NotFoundError('Delivery challan not found');
    if (challan.status !== 'DRAFT')
      throw new BusinessError('INVALID_STATUS', `Cannot dispatch challan in status ${challan.status}`);

    await this.db
      .update(deliveryChallans)
      .set({ status: 'DISPATCHED', dispatchedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(deliveryChallans.id, id), eq(deliveryChallans.tenantId, tenantId)));
  }

  async convertToInvoice(id: number, tenantId: number): Promise<{ challanId: number; lines: typeof deliveryChallanLines.$inferSelect[] }> {
    const [challan] = await this.db
      .select()
      .from(deliveryChallans)
      .where(and(eq(deliveryChallans.id, id), eq(deliveryChallans.tenantId, tenantId)));
    if (!challan) throw new NotFoundError('Delivery challan not found');
    if (challan.status === 'CONVERTED')
      throw new BusinessError('ALREADY_CONVERTED', 'Challan already converted to invoice');
    if (challan.status === 'CANCELLED')
      throw new BusinessError('INVALID_STATUS', 'Cannot convert cancelled challan');

    const lines = await this.db
      .select()
      .from(deliveryChallanLines)
      .where(eq(deliveryChallanLines.challanId, id));

    return { challanId: id, lines };
  }

  async markConverted(id: number, tenantId: number, invoiceId: number, userId: number): Promise<void> {
    await this.db
      .update(deliveryChallans)
      .set({ status: 'CONVERTED', convertedInvoiceId: invoiceId, convertedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(deliveryChallans.id, id), eq(deliveryChallans.tenantId, tenantId)));
  }

  async getWithLines(id: number, tenantId: number) {
    const [challan] = await this.db
      .select()
      .from(deliveryChallans)
      .where(and(eq(deliveryChallans.id, id), eq(deliveryChallans.tenantId, tenantId)));
    if (!challan) throw new NotFoundError('Delivery challan not found');
    const lines = await this.db
      .select()
      .from(deliveryChallanLines)
      .where(eq(deliveryChallanLines.challanId, id));
    return { ...challan, lines };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
