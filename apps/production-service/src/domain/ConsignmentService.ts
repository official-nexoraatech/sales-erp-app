import { and, eq, sql, desc, inArray } from 'drizzle-orm';
import {
  consignmentStocks,
  consignmentSettlements,
  items,
  outboxEvents,
} from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';
import { ulid } from 'ulid';

export interface ReceiveConsignmentParams {
  tenantId: number;
  supplierId: number;
  itemId: number;
  variantId?: number | undefined;
  warehouseId: number;
  receivedQty: number;
  agreedRate: number;
  receivedDate: Date;
  referenceNumber?: string | undefined;
  notes?: string | undefined;
  createdBy: number;
}

export class ConsignmentService {
  constructor(private db: ErpDatabase) {}

  async receive(params: ReceiveConsignmentParams): Promise<number> {
    return this.db.transaction(async (trx) => {
      const [item] = await trx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.id, params.itemId), eq(items.tenantId, params.tenantId)));
      if (!item) throw new NotFoundError('Item', params.itemId);

      // Consignment stock is NOT posted to financial_entries — it's not owned until sold
      const [row] = await trx
        .insert(consignmentStocks)
        .values({
          tenantId: params.tenantId,
          supplierId: params.supplierId,
          itemId: params.itemId,
          variantId: params.variantId,
          warehouseId: params.warehouseId,
          receivedQty: String(params.receivedQty),
          availableQty: String(params.receivedQty),
          agreedRate: String(params.agreedRate),
          receivedDate: params.receivedDate,
          referenceNumber: params.referenceNumber,
          notes: params.notes,
          status: 'ACTIVE',
          createdBy: params.createdBy,
        })
        .returning({ id: consignmentStocks.id });

      if (!row) throw new BusinessError('CONSIGNMENT_CREATE_FAILED', 'Failed to record consignment receipt');

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'CONSIGNMENT_RECEIVED',
        aggregateType: 'CONSIGNMENT_STOCK',
        aggregateId: row.id,
        tenantId: params.tenantId,
        payload: {
          consignmentId: row.id,
          supplierId: params.supplierId,
          itemId: params.itemId,
          receivedQty: params.receivedQty,
          agreedRate: params.agreedRate,
        },
        published: false,
      });

      return row.id;
    });
  }

  async recordSale(
    tenantId: number,
    itemId: number,
    variantId: number | undefined,
    soldQty: number,
    userId: number
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      // Find active consignment stock for this item (FIFO by receivedDate)
      const stocks = await trx
        .select()
        .from(consignmentStocks)
        .where(
          and(
            eq(consignmentStocks.tenantId, tenantId),
            eq(consignmentStocks.itemId, itemId),
            sql`${consignmentStocks.status} IN ('ACTIVE', 'PARTIAL')`,
            sql`${consignmentStocks.availableQty} > 0`
          )
        )
        .orderBy(consignmentStocks.receivedDate);

      let remaining = soldQty;
      for (const stock of stocks) {
        if (remaining <= 0) break;
        const available = parseFloat(String(stock.availableQty));
        const toDeduct = Math.min(remaining, available);
        const newAvailable = available - toDeduct;
        const newSoldQty = parseFloat(String(stock.soldQty)) + toDeduct;

        const newStatus = newAvailable <= 0 ? 'SETTLED' : 'PARTIAL';
        await trx
          .update(consignmentStocks)
          .set({
            availableQty: String(newAvailable),
            soldQty: String(newSoldQty),
            status: newStatus,
            updatedBy: userId,
            updatedAt: new Date(),
            version: sql`${consignmentStocks.version} + 1`,
          })
          .where(eq(consignmentStocks.id, stock.id));

        remaining -= toDeduct;
      }

      if (remaining > 0) {
        throw new BusinessError('INSUFFICIENT_CONSIGNMENT', 'Insufficient consignment stock to fulfill sale', {
          requested: soldQty,
          shortfall: remaining,
        });
      }
    });
  }

  async returnToSupplier(id: number, tenantId: number, returnQty: number, userId: number): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [stock] = await trx
        .select()
        .from(consignmentStocks)
        .where(and(eq(consignmentStocks.id, id), eq(consignmentStocks.tenantId, tenantId)));
      if (!stock) throw new NotFoundError('ConsignmentStock', id);

      const available = parseFloat(String(stock.availableQty));
      if (returnQty > available)
        throw new BusinessError('INVALID_RETURN_QTY', `Cannot return ${returnQty} — only ${available} available`);

      await trx
        .update(consignmentStocks)
        .set({
          availableQty: String(available - returnQty),
          returnedQty: sql`${consignmentStocks.returnedQty} + ${returnQty}`,
          status: available - returnQty <= 0 ? 'RETURNED' : 'PARTIAL',
          updatedBy: userId,
          updatedAt: new Date(),
          version: sql`${consignmentStocks.version} + 1`,
        })
        .where(and(eq(consignmentStocks.id, id), eq(consignmentStocks.tenantId, tenantId)));

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'CONSIGNMENT_RETURNED',
        aggregateType: 'CONSIGNMENT_STOCK',
        aggregateId: id,
        tenantId,
        payload: { consignmentId: id, returnQty, supplierId: stock.supplierId },
        published: false,
      });
    });
  }

  async settle(id: number, tenantId: number, paymentReference: string, userId: number): Promise<void> {
    await this.db.transaction(async (trx) => {
      const [settlement] = await trx
        .select()
        .from(consignmentSettlements)
        .where(and(eq(consignmentSettlements.id, id), eq(consignmentSettlements.tenantId, tenantId)));
      if (!settlement) throw new NotFoundError('ConsignmentSettlement', id);
      if (settlement.status !== 'PENDING')
        throw new BusinessError('ALREADY_SETTLED', 'Settlement is not in PENDING status');

      await trx
        .update(consignmentSettlements)
        .set({
          status: 'SETTLED',
          settledAt: new Date(),
          settledBy: userId,
          paymentReference,
          updatedAt: new Date(),
        })
        .where(and(eq(consignmentSettlements.id, id), eq(consignmentSettlements.tenantId, tenantId)));

      await trx.insert(outboxEvents).values({
        eventId: ulid(),
        eventType: 'CONSIGNMENT_SETTLED',
        aggregateType: 'CONSIGNMENT_SETTLEMENT',
        aggregateId: id,
        tenantId,
        payload: {
          settlementId: id,
          supplierId: settlement.supplierId,
          totalAmount: settlement.totalAmount,
          paymentReference,
        },
        published: false,
      });
    });
  }

  async listStock(tenantId: number, supplierId?: number): Promise<unknown[]> {
    const conditions = [
      eq(consignmentStocks.tenantId, tenantId),
      sql`${consignmentStocks.status} IN ('ACTIVE', 'PARTIAL')`,
    ];
    if (supplierId) conditions.push(eq(consignmentStocks.supplierId, supplierId));

    return this.db
      .select()
      .from(consignmentStocks)
      .where(and(...conditions))
      .orderBy(desc(consignmentStocks.receivedDate));
  }

  async listSettlements(tenantId: number, supplierId?: number): Promise<unknown[]> {
    const conditions = [eq(consignmentSettlements.tenantId, tenantId)];
    if (supplierId) conditions.push(eq(consignmentSettlements.supplierId, supplierId));

    return this.db
      .select()
      .from(consignmentSettlements)
      .where(and(...conditions))
      .orderBy(desc(consignmentSettlements.createdAt));
  }

  async createSettlement(
    tenantId: number,
    supplierId: number,
    periodFrom: Date,
    periodTo: Date,
    userId: number
  ): Promise<number> {
    return this.db.transaction(async (trx) => {
      const stocks = await trx
        .select()
        .from(consignmentStocks)
        .where(
          and(
            eq(consignmentStocks.tenantId, tenantId),
            eq(consignmentStocks.supplierId, supplierId),
            sql`${consignmentStocks.soldQty} > 0`
          )
        );

      const lineItems = stocks.map((s) => ({
        consignmentStockId: s.id,
        itemId: s.itemId,
        soldQty: parseFloat(String(s.soldQty)),
        rate: parseFloat(String(s.agreedRate)),
        amount: parseFloat(String(s.soldQty)) * parseFloat(String(s.agreedRate)),
      }));

      const totalAmount = lineItems.reduce((sum, l) => sum + l.amount, 0);
      const totalSoldQty = lineItems.reduce((sum, l) => sum + l.soldQty, 0);

      const [row] = await trx
        .insert(consignmentSettlements)
        .values({
          tenantId,
          supplierId,
          periodFrom,
          periodTo,
          totalSoldQty: String(totalSoldQty),
          totalAmount: String(totalAmount),
          status: 'PENDING',
          lineItems,
          createdBy: userId,
        })
        .returning({ id: consignmentSettlements.id });

      if (!row) throw new BusinessError('SETTLEMENT_CREATE_FAILED', 'Failed to create settlement');
      return row.id;
    });
  }
}
