import { eq } from 'drizzle-orm';
import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { crmWhatsappCatalogOrders } from '@erp/db';
import { createLogger } from '@erp/logger';
import { CustomerService } from '../domain/CustomerService.js';
import { QuotationService, type QuotationLineInput } from '../domain/QuotationService.js';

const logger = createLogger({ serviceName: 'sales-service' });

// CRM/O2C split — the async half of WhatsAppCommerceService.handleOrderMessage()'s outbox
// redesign (see that method's own doc comment for why), mirroring OpportunityWonConsumer.ts's
// exact shape. Creates the customer (if none was already resolved) and the Quotation a
// WhatsApp catalog order was validated against, then writes the result back onto the
// crm_whatsapp_catalog_orders row crm-service already created in PENDING status.
//
// Accepted gap, recorded not silently absorbed: if creation fails here, PlatformEventConsumer
// marks the inbox row FAILED and there is no automatic retry (same accepted gap
// OpportunityWonConsumer documents) — the catalog order row is left PENDING, a
// recoverable-but-not-yet-automated state, visible to staff same as a REJECTED row already was.
interface WhatsAppOrderReceivedPayload {
  catalogOrderId: number;
  tenantId: number;
  customerId: number | null;
  waPhoneNumber: string;
  senderName?: string | undefined;
  branchId: number;
  sellerStateCode: string;
  lines: QuotationLineInput[];
}

export async function handleWhatsAppOrderReceived(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as WhatsAppOrderReceivedPayload;
  if (!p.catalogOrderId) return;

  // Idempotent no-op if this catalog order was already converted — guards against a duplicate
  // *business* trigger on top of (not instead of) the inbox table's own delivery-level
  // idempotency, mirroring OpportunityWonConsumer's own pre-check.
  const [existing] = await db.raw
    .select({
      status: crmWhatsappCatalogOrders.status,
      quotationId: crmWhatsappCatalogOrders.quotationId,
    })
    .from(crmWhatsappCatalogOrders)
    .where(eq(crmWhatsappCatalogOrders.id, p.catalogOrderId));
  if (existing?.status === 'CREATED') {
    logger.info(
      { catalogOrderId: p.catalogOrderId, quotationId: existing.quotationId },
      'WHATSAPP_ORDER_RECEIVED already converted — skipping'
    );
    return;
  }

  let customerId = p.customerId;
  if (!customerId) {
    const { created } = await CustomerService.create(db.raw, {
      tenantId: p.tenantId,
      createdBy: 0,
      displayName: p.senderName ?? p.waPhoneNumber,
      phone: p.waPhoneNumber,
      customerType: 'RETAIL',
      branchId: p.branchId,
    });
    customerId = created.id;
  }

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 7);
  const quotationService = new QuotationService(db.raw);
  const quotationId = await quotationService.create({
    tenantId: p.tenantId,
    branchId: p.branchId,
    customerId,
    quotationNumber: `QT-WA-${p.tenantId}-${Date.now()}`,
    // Defaults to intra-state (same as the seller) since a brand-new WhatsApp contact has no
    // known billing address yet — see WhatsAppCommerceService's own header comment for the
    // same accepted limitation this carries over from before the outbox split.
    placeOfSupply: p.sellerStateCode,
    sellerStateCode: p.sellerStateCode,
    validUntil,
    lines: p.lines,
    notes: 'Created automatically from a WhatsApp Commerce catalog order',
    createdBy: 0,
  });

  await db.raw
    .update(crmWhatsappCatalogOrders)
    .set({ status: 'CREATED', customerId, quotationId })
    .where(eq(crmWhatsappCatalogOrders.id, p.catalogOrderId));

  logger.info(
    { catalogOrderId: p.catalogOrderId, quotationId },
    'WHATSAPP_ORDER_RECEIVED converted to a real Quotation'
  );
}
