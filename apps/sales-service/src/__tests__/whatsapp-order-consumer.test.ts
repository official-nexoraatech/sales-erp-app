// CRM/O2C split — the async half of WhatsAppCommerceService.handleOrderMessage()'s outbox
// redesign (see WhatsAppOrderConsumer.ts's own header comment). Tested directly against real
// Postgres, same convention as notification-delivery-consumer.test.ts (no real Kafka broker
// stood up — the handler's own sync logic is what's under test).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches, customers, quotations, crmWhatsappCatalogOrders } from '@erp/db';
import { eq } from 'drizzle-orm';
import { TenantScopedDatabase } from '@erp/sdk';
import type { ERPEventPayload } from '@erp/types';
import { handleWhatsAppOrderReceived } from '../consumers/WhatsAppOrderConsumer.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('handleWhatsAppOrderReceived — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 911_950 + Math.floor(Math.random() * 1000);
  let branchId: number;

  function makeEvent(payload: Record<string, unknown>): ERPEventPayload {
    return {
      eventId: 'test-event-id',
      eventType: 'WHATSAPP_ORDER_RECEIVED',
      schemaVersion: 1,
      aggregateType: 'crm_whatsapp_catalog_order',
      aggregateId: 1,
      tenantId: TEST_TENANT,
      userId: 0,
      correlationId: 'test-correlation-id',
      causationId: 'test-causation-id',
      occurredAt: new Date().toISOString(),
      payload,
    };
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'WA Consumer Test Branch',
        code: 'WACB',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;
  });

  afterAll(async () => {
    await db
      .delete(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.tenantId, TEST_TENANT));
    await db.delete(quotations).where(eq(quotations.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('creates a new customer and a real quotation when no customerId was resolved, then updates the tracking row', async () => {
    const [pending] = await db
      .insert(crmWhatsappCatalogOrders)
      .values({
        tenantId: TEST_TENANT,
        waOrderMessageId: `wamid-consumer-new-${TEST_TENANT}`,
        status: 'PENDING',
        rawPayload: {},
      })
      .returning();

    const tsDb = new TenantScopedDatabase(TEST_TENANT, db);
    await handleWhatsAppOrderReceived(
      makeEvent({
        catalogOrderId: pending!.id,
        tenantId: TEST_TENANT,
        customerId: null,
        waPhoneNumber: '912222222221',
        senderName: 'Consumer Test Customer',
        branchId,
        sellerStateCode: '27',
        lines: [{ itemId: 1, quantity: 2, unitPrice: 100, gstRate: 12, hsnCode: '1234' }],
      }),
      tsDb
    );

    const [updated] = await db
      .select()
      .from(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.id, pending!.id));
    expect(updated!.status).toBe('CREATED');
    expect(updated!.customerId).not.toBeNull();
    expect(updated!.quotationId).not.toBeNull();

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, updated!.customerId!));
    expect(customer!.phone).toBe('912222222221');
    expect(customer!.displayName).toBe('Consumer Test Customer');

    const [quotation] = await db
      .select()
      .from(quotations)
      .where(eq(quotations.id, updated!.quotationId!));
    expect(quotation!.customerId).toBe(updated!.customerId);
    expect(parseFloat(quotation!.grandTotal)).toBeGreaterThan(0);
  });

  it('reuses the already-resolved customerId from the event payload instead of creating a new customer', async () => {
    const [existingCustomer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Pre-resolved Customer',
        phone: '912222222222',
        createdBy: 1,
      } as unknown as typeof customers.$inferInsert)
      .returning();

    const [pending] = await db
      .insert(crmWhatsappCatalogOrders)
      .values({
        tenantId: TEST_TENANT,
        customerId: existingCustomer!.id,
        waOrderMessageId: `wamid-consumer-existing-${TEST_TENANT}`,
        status: 'PENDING',
        rawPayload: {},
      })
      .returning();

    const tsDb = new TenantScopedDatabase(TEST_TENANT, db);
    await handleWhatsAppOrderReceived(
      makeEvent({
        catalogOrderId: pending!.id,
        tenantId: TEST_TENANT,
        customerId: existingCustomer!.id,
        waPhoneNumber: '912222222222',
        branchId,
        sellerStateCode: '27',
        lines: [{ itemId: 1, quantity: 1, unitPrice: 50, gstRate: 5, hsnCode: '5678' }],
      }),
      tsDb
    );

    const [updated] = await db
      .select()
      .from(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.id, pending!.id));
    expect(updated!.status).toBe('CREATED');
    expect(updated!.customerId).toBe(existingCustomer!.id);

    const allCustomersWithPhone = await db
      .select()
      .from(customers)
      .where(eq(customers.phone, '912222222222'));
    expect(allCustomersWithPhone.length).toBe(1);
  });

  it('is idempotent — replaying the event for an already-CREATED row does not create a second quotation', async () => {
    const [pending] = await db
      .insert(crmWhatsappCatalogOrders)
      .values({
        tenantId: TEST_TENANT,
        waOrderMessageId: `wamid-consumer-idempotent-${TEST_TENANT}`,
        status: 'PENDING',
        rawPayload: {},
      })
      .returning();

    const event = makeEvent({
      catalogOrderId: pending!.id,
      tenantId: TEST_TENANT,
      customerId: null,
      waPhoneNumber: '912222222223',
      branchId,
      sellerStateCode: '27',
      lines: [{ itemId: 1, quantity: 1, unitPrice: 100, gstRate: 12, hsnCode: '1234' }],
    });
    const tsDb = new TenantScopedDatabase(TEST_TENANT, db);
    await handleWhatsAppOrderReceived(event, tsDb);
    const [afterFirst] = await db
      .select()
      .from(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.id, pending!.id));

    await handleWhatsAppOrderReceived(event, tsDb);
    const [afterSecond] = await db
      .select()
      .from(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.id, pending!.id));

    expect(afterSecond!.quotationId).toBe(afterFirst!.quotationId);
    const quotationsForCustomer = await db
      .select()
      .from(quotations)
      .where(eq(quotations.customerId, afterFirst!.customerId!));
    expect(quotationsForCustomer.length).toBe(1);
  });
});
