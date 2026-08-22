import { and, eq } from 'drizzle-orm';
import { crmWhatsappCatalogOrders, customers, branches, items, outboxEvents } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { ulid } from 'ulid';

export interface WhatsAppOrderProductItem {
  productRetailerId: string;
  quantity: number;
  itemPrice: number;
}

export interface WhatsAppOrderParams {
  waPhoneNumber: string;
  senderName?: string | undefined;
  waOrderMessageId: string;
  catalogId?: string | undefined;
  productItems: WhatsAppOrderProductItem[];
  rawPayload: Record<string, unknown>;
}

const PRICE_TOLERANCE = 0.01;

/**
 * CRM-ROADMAP Phase 4, Feature 2 — WhatsApp Commerce.
 *
 * CRM/O2C split: validation (idempotency, head-office/GSTIN resolution, catalog/price
 * reconciliation) all stay here — every table touched (`crm_whatsapp_catalog_orders`,
 * `branches` read-only, `items` read-only) matches this split's established shared-table-read
 * precedent. What used to happen next — resolve-or-create the customer, then
 * `new QuotationService(db).create(...)` — was a genuine O2C write (a full business
 * transaction: GST calc, numbering, duplicate-phone checks), the same shape of coupling
 * `OpportunityService.markWon()` had before an earlier session redesigned it around an outbox
 * event instead of a same-transaction call into QuotationService. This method follows that
 * exact precedent: publish a `WHATSAPP_ORDER_RECEIVED` event carrying the frozen, validated
 * lines; `WhatsAppOrderConsumer.ts` (sales-service) does the actual customer/quotation creation
 * asynchronously and writes the result back onto this row. Safe because the caller
 * (inbound-webhooks.routes.ts) never used this method's return value — a webhook ack, not a
 * synchronous "here's your quote" response.
 *
 * Price reconciliation is a hard reject, never a partial honor: `product_retailer_id` is
 * expected to equal this tenant's `items.itemCode` (the natural mapping when an ERP catalog is
 * synced into Meta Commerce Manager — syncing the catalog itself is a manual admin step, out of
 * scope here). Both an unknown retailer id and a price that has drifted since the WhatsApp
 * catalog was last synced reject the WHOLE order rather than silently substituting the current
 * price or dropping the mismatched line — per this feature's own explicitly-named edge case.
 */
export class WhatsAppCommerceService {
  static async handleOrderMessage(
    db: ErpDatabase,
    tenantId: number,
    params: WhatsAppOrderParams
  ): Promise<void> {
    const [existing] = await db
      .select({ id: crmWhatsappCatalogOrders.id })
      .from(crmWhatsappCatalogOrders)
      .where(
        and(
          eq(crmWhatsappCatalogOrders.tenantId, tenantId),
          eq(crmWhatsappCatalogOrders.waOrderMessageId, params.waOrderMessageId)
        )
      );
    if (existing) return; // Already processed — Meta retries webhook delivery, this call is idempotent.

    const [headOffice] = await db
      .select()
      .from(branches)
      .where(
        and(
          eq(branches.tenantId, tenantId),
          eq(branches.isHeadOffice, true),
          eq(branches.isActive, true)
        )
      );
    if (!headOffice) {
      await WhatsAppCommerceService.reject(
        db,
        tenantId,
        params,
        'No active head-office branch configured for this tenant'
      );
      return;
    }
    if (!headOffice.gstin || headOffice.gstin.length < 2) {
      await WhatsAppCommerceService.reject(
        db,
        tenantId,
        params,
        'Head-office branch has no GSTIN configured — cannot determine the seller state for GST'
      );
      return;
    }
    const sellerStateCode = headOffice.gstin.slice(0, 2);

    const itemRows = await db.select().from(items).where(eq(items.tenantId, tenantId));
    const itemByCode = new Map(
      itemRows.filter((i) => i.itemCode).map((i) => [i.itemCode as string, i])
    );

    const lines: Array<{
      itemId: number;
      quantity: number;
      unitPrice: number;
      gstRate: number;
      hsnCode: string;
    }> = [];
    for (const productItem of params.productItems) {
      const item = itemByCode.get(productItem.productRetailerId);
      if (!item) {
        await WhatsAppCommerceService.reject(
          db,
          tenantId,
          params,
          `Unknown product_retailer_id: ${productItem.productRetailerId}`
        );
        return;
      }
      const currentPrice = parseFloat(item.salePrice);
      if (Math.abs(currentPrice - productItem.itemPrice) > PRICE_TOLERANCE) {
        await WhatsAppCommerceService.reject(
          db,
          tenantId,
          params,
          `Price mismatch for ${productItem.productRetailerId}: WhatsApp catalog sent ${productItem.itemPrice}, current ERP price is ${currentPrice}`
        );
        return;
      }
      lines.push({
        itemId: item.id,
        quantity: productItem.quantity,
        unitPrice: currentPrice,
        gstRate: parseFloat(item.gstRate),
        hsnCode: item.hsnCode,
      });
    }

    // Read-only lookup (matches the established shared-table-read precedent) — if the phone
    // already belongs to a known customer, the consumer skips customer creation entirely and
    // only creates the quotation.
    const [existingCustomer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, params.waPhoneNumber)));

    const [pending] = await db
      .insert(crmWhatsappCatalogOrders)
      .values({
        tenantId,
        customerId: existingCustomer?.id ?? null,
        waOrderMessageId: params.waOrderMessageId,
        catalogId: params.catalogId ?? null,
        status: 'PENDING',
        rawPayload: params.rawPayload,
      })
      .returning();
    if (!pending)
      throw new Error('WhatsApp catalog order tracking row creation failed unexpectedly');

    await db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: 'WHATSAPP_ORDER_RECEIVED',
      aggregateType: 'crm_whatsapp_catalog_order',
      aggregateId: pending.id,
      tenantId,
      payload: {
        catalogOrderId: pending.id,
        tenantId,
        customerId: existingCustomer?.id ?? null,
        waPhoneNumber: params.waPhoneNumber,
        senderName: params.senderName,
        branchId: headOffice.id,
        sellerStateCode,
        lines,
      },
      published: false,
    });
  }

  private static async reject(
    db: ErpDatabase,
    tenantId: number,
    params: WhatsAppOrderParams,
    reason: string
  ): Promise<void> {
    await db.insert(crmWhatsappCatalogOrders).values({
      tenantId,
      waOrderMessageId: params.waOrderMessageId,
      catalogId: params.catalogId ?? null,
      status: 'REJECTED',
      rejectionReason: reason,
      rawPayload: params.rawPayload,
    });
  }
}
