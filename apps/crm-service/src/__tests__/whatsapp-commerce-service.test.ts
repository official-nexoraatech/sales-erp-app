// CRM-ROADMAP Phase 4, Feature 2 — WhatsApp Commerce.
// CRM/O2C split: handleOrderMessage no longer creates the customer/quotation synchronously
// (that would be a cross-service O2C write) — it validates, then publishes a
// WHATSAPP_ORDER_RECEIVED outbox event for sales-service's WhatsAppOrderConsumer to act on
// asynchronously (see WhatsAppCommerceService.ts's own header comment). This file tests only
// the validation half — rejection paths (unchanged) and the PENDING-row-plus-outbox-event
// shape for a valid order. The actual customer/quotation creation is covered by
// whatsapp-order-consumer.test.ts in sales-service.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches, units, items, customers, crmWhatsappCatalogOrders, outboxEvents } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { WhatsAppCommerceService } from '../domain/WhatsAppCommerceService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('WhatsAppCommerceService', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 911_901 + Math.floor(Math.random() * 1000);
  let branchId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'WA Branch',
        code: 'WAB',
        isHeadOffice: true,
        isActive: true,
        gstin: `27WABTEST${TEST_TENANT}Z`,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;

    const [unit] = await db
      .insert(units)
      .values({ tenantId: TEST_TENANT, name: 'Piece', abbreviation: 'PC', createdBy: 1 })
      .returning();

    await db
      .insert(items)
      .values({
        tenantId: TEST_TENANT,
        name: 'WA Test Item',
        unitId: unit!.id,
        hsnCode: '5208',
        gstRate: '12',
        salePrice: '250',
        itemCode: 'WASKU1',
        createdBy: 1,
      })
      .returning();
  });

  afterAll(async () => {
    await db
      .delete(outboxEvents)
      .where(
        and(
          eq(outboxEvents.tenantId, TEST_TENANT),
          eq(outboxEvents.eventType, 'WHATSAPP_ORDER_RECEIVED')
        )
      );
    await db
      .delete(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(units).where(eq(units.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('rejects an order referencing an unknown product_retailer_id and publishes no event', async () => {
    await WhatsAppCommerceService.handleOrderMessage(db, TEST_TENANT, {
      waPhoneNumber: '911111111111',
      waOrderMessageId: `wamid-unknown-${TEST_TENANT}`,
      productItems: [{ productRetailerId: 'DOES-NOT-EXIST', quantity: 1, itemPrice: 250 }],
      rawPayload: {},
    });

    const [row] = await db
      .select()
      .from(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.waOrderMessageId, `wamid-unknown-${TEST_TENANT}`));
    expect(row!.status).toBe('REJECTED');
    expect(row!.rejectionReason).toMatch(/Unknown product_retailer_id/);
    expect(row!.quotationId).toBeNull();
  });

  it('rejects (never silently honors) an order whose price has drifted from the current ERP price', async () => {
    await WhatsAppCommerceService.handleOrderMessage(db, TEST_TENANT, {
      waPhoneNumber: '911111111112',
      waOrderMessageId: `wamid-pricedrift-${TEST_TENANT}`,
      productItems: [{ productRetailerId: 'WASKU1', quantity: 1, itemPrice: 199 }],
      rawPayload: {},
    });

    const [row] = await db
      .select()
      .from(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.waOrderMessageId, `wamid-pricedrift-${TEST_TENANT}`));
    expect(row!.status).toBe('REJECTED');
    expect(row!.rejectionReason).toMatch(/Price mismatch/);
  });

  it('validates a new-customer order, creates a PENDING tracking row, and publishes a WHATSAPP_ORDER_RECEIVED event', async () => {
    await WhatsAppCommerceService.handleOrderMessage(db, TEST_TENANT, {
      waPhoneNumber: '911111111113',
      senderName: 'New WA Customer',
      waOrderMessageId: `wamid-valid-${TEST_TENANT}`,
      catalogId: 'catalog-123',
      productItems: [{ productRetailerId: 'WASKU1', quantity: 2, itemPrice: 250 }],
      rawPayload: { type: 'order' },
    });

    const [row] = await db
      .select()
      .from(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.waOrderMessageId, `wamid-valid-${TEST_TENANT}`));
    expect(row!.status).toBe('PENDING');
    expect(row!.quotationId).toBeNull();
    expect(row!.customerId).toBeNull(); // no existing customer for this phone yet

    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.tenantId, TEST_TENANT), eq(outboxEvents.aggregateId, row!.id)));
    expect(event!.eventType).toBe('WHATSAPP_ORDER_RECEIVED');
    const payload = event!.payload as {
      catalogOrderId: number;
      customerId: number | null;
      waPhoneNumber: string;
      lines: Array<{ itemId: number; quantity: number; gstRate: number }>;
    };
    expect(payload.catalogOrderId).toBe(row!.id);
    expect(payload.customerId).toBeNull();
    expect(payload.waPhoneNumber).toBe('911111111113');
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0]!.quantity).toBe(2);
    expect(payload.lines[0]!.gstRate).toBe(12);
  });

  it('resolves an existing customer by phone and carries its id in the event payload instead of leaving it null', async () => {
    const [existingCustomer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Existing Distributor',
        customerCode: `EXIST-${TEST_TENANT}`,
        phone: '911111111114',
        createdBy: 1,
      } as unknown as typeof customers.$inferInsert)
      .returning();

    await WhatsAppCommerceService.handleOrderMessage(db, TEST_TENANT, {
      waPhoneNumber: '911111111114',
      waOrderMessageId: `wamid-existing-${TEST_TENANT}`,
      productItems: [{ productRetailerId: 'WASKU1', quantity: 1, itemPrice: 250 }],
      rawPayload: {},
    });

    const [row] = await db
      .select()
      .from(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.waOrderMessageId, `wamid-existing-${TEST_TENANT}`));
    expect(row!.customerId).toBe(existingCustomer!.id);
    expect(row!.status).toBe('PENDING');

    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.tenantId, TEST_TENANT), eq(outboxEvents.aggregateId, row!.id)));
    const payload = event!.payload as { customerId: number | null };
    expect(payload.customerId).toBe(existingCustomer!.id);
  });

  it('is idempotent — replaying the same wa_order_message_id does not publish a second event', async () => {
    const msgId = `wamid-idempotent-${TEST_TENANT}`;
    const orderParams = {
      waPhoneNumber: '911111111115',
      waOrderMessageId: msgId,
      productItems: [{ productRetailerId: 'WASKU1', quantity: 1, itemPrice: 250 }],
      rawPayload: {},
    };
    await WhatsAppCommerceService.handleOrderMessage(db, TEST_TENANT, orderParams);
    await WhatsAppCommerceService.handleOrderMessage(db, TEST_TENANT, orderParams);

    const rows = await db
      .select()
      .from(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.waOrderMessageId, msgId));
    expect(rows.length).toBe(1);

    const events = await db
      .select()
      .from(outboxEvents)
      .where(
        and(eq(outboxEvents.tenantId, TEST_TENANT), eq(outboxEvents.aggregateId, rows[0]!.id))
      );
    expect(events.length).toBe(1);
  });

  it('rejects with a clear reason when the head-office branch has no GSTIN configured', async () => {
    const OTHER_TENANT = TEST_TENANT + 500;
    const [otherBranch] = await db
      .insert(branches)
      .values({
        tenantId: OTHER_TENANT,
        name: 'No GSTIN Branch',
        code: 'NGB',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();

    await WhatsAppCommerceService.handleOrderMessage(db, OTHER_TENANT, {
      waPhoneNumber: '911111111116',
      waOrderMessageId: `wamid-nogstin-${OTHER_TENANT}`,
      productItems: [{ productRetailerId: 'WASKU1', quantity: 1, itemPrice: 250 }],
      rawPayload: {},
    });

    const [row] = await db
      .select()
      .from(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.waOrderMessageId, `wamid-nogstin-${OTHER_TENANT}`));
    expect(row!.status).toBe('REJECTED');
    expect(row!.rejectionReason).toMatch(/GSTIN/);

    await db
      .delete(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.tenantId, OTHER_TENANT));
    await db.delete(branches).where(eq(branches.id, otherBranch!.id));
  });
});
