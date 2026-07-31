import { and, eq } from 'drizzle-orm';
import { crmWhatsappCatalogOrders, customers, branches, items } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { QuotationService } from './QuotationService.js';

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
 * Inbound WhatsApp catalog orders create a real Quotation through the existing
 * `QuotationService` — no parallel order-creation logic, matching this feature's own explicit
 * reuse instruction. Every order attempt (successful or rejected) is logged in
 * `crm_whatsapp_catalog_orders`: a rejected order is never silently dropped, since a
 * merchandiser needs to see why a customer's WhatsApp order didn't turn into a quote.
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

    const customerId = await WhatsAppCommerceService.resolveOrCreateCustomer(
      db,
      tenantId,
      headOffice.id,
      params.waPhoneNumber,
      params.senderName
    );

    const quotationService = new QuotationService(db);
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 7);
    const quotationId = await quotationService.create({
      tenantId,
      branchId: headOffice.id,
      customerId,
      quotationNumber: `QT-WA-${tenantId}-${Date.now()}`,
      // Defaults to intra-state (same as the seller) since a brand-new WhatsApp contact has no
      // known billing address yet — flagged in the completion report as a real limitation
      // (correct the GST treatment manually if the customer is actually out-of-state).
      placeOfSupply: sellerStateCode,
      sellerStateCode,
      validUntil,
      lines,
      notes: 'Created automatically from a WhatsApp Commerce catalog order',
      createdBy: 0,
    });

    await db.insert(crmWhatsappCatalogOrders).values({
      tenantId,
      customerId,
      waOrderMessageId: params.waOrderMessageId,
      catalogId: params.catalogId ?? null,
      status: 'CREATED',
      quotationId,
      rawPayload: params.rawPayload,
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

  private static async resolveOrCreateCustomer(
    db: ErpDatabase,
    tenantId: number,
    headOfficeBranchId: number,
    waPhoneNumber: string,
    senderName: string | undefined
  ): Promise<number> {
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, waPhoneNumber)));
    if (existing) return existing.id;

    const [created] = await db
      .insert(customers)
      .values({
        tenantId,
        branchId: headOfficeBranchId,
        customerCode: `WA${Date.now()}`,
        displayName: senderName ?? waPhoneNumber,
        phone: waPhoneNumber,
        customerType: 'RETAIL',
        createdBy: 0,
      } as unknown as typeof customers.$inferInsert)
      .returning({ id: customers.id });
    if (!created) throw new Error('WhatsApp Commerce customer creation failed unexpectedly');
    return created.id;
  }
}
