// CRM-ROADMAP Phase 4, Feature 2 — WhatsApp Commerce.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches, units, items, customers, quotations, crmWhatsappCatalogOrders } from '@erp/db';
import { eq } from 'drizzle-orm';
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
      .delete(crmWhatsappCatalogOrders)
      .where(eq(crmWhatsappCatalogOrders.tenantId, TEST_TENANT));
    await db.delete(quotations).where(eq(quotations.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(items).where(eq(items.tenantId, TEST_TENANT));
    await db.delete(units).where(eq(units.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('rejects an order referencing an unknown product_retailer_id and creates no quotation', async () => {
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

  it('creates a real quotation for a valid order and auto-creates the customer from the WhatsApp phone number', async () => {
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
    expect(row!.status).toBe('CREATED');
    expect(row!.quotationId).not.toBeNull();

    const [quotation] = await db
      .select()
      .from(quotations)
      .where(eq(quotations.id, row!.quotationId!));
    expect(quotation!.customerId).toBe(row!.customerId);
    expect(parseFloat(quotation!.grandTotal)).toBeGreaterThan(0);

    const [customer] = await db.select().from(customers).where(eq(customers.id, row!.customerId!));
    expect(customer!.displayName).toBe('New WA Customer');
    expect(customer!.phone).toBe('911111111113');
    expect(customer!.branchId).toBe(branchId);
  });

  it('reuses an existing customer matched by phone instead of creating a duplicate', async () => {
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
  });

  it('is idempotent — replaying the same wa_order_message_id does not create a second quotation', async () => {
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
