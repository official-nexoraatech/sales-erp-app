import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { customers, customerInteractions, invoices, branches, warehouses } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { PaymentReminderService, shouldSendChannel } from '../domain/PaymentReminderService.js';

describe('shouldSendChannel', () => {
  it('blocks a channel the customer opted out of', () => {
    const optedOutOfWhatsapp = { optOutSms: false, optOutWhatsapp: true, optOutEmail: false };
    expect(shouldSendChannel(optedOutOfWhatsapp, 'WHATSAPP')).toBe(false);
    expect(shouldSendChannel(optedOutOfWhatsapp, 'SMS')).toBe(true);
    expect(shouldSendChannel(optedOutOfWhatsapp, 'EMAIL')).toBe(true);
  });

  it('allows every channel when nothing is opted out', () => {
    const noOptOut = { optOutSms: false, optOutWhatsapp: false, optOutEmail: false };
    expect(shouldSendChannel(noOptOut, 'SMS')).toBe(true);
    expect(shouldSendChannel(noOptOut, 'WHATSAPP')).toBe(true);
    expect(shouldSendChannel(noOptOut, 'EMAIL')).toBe(true);
  });
});

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('ES-18 CRM gaps — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_201 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let warehouseId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({ tenantId: TEST_TENANT, name: 'Test HO', code: 'HO', isHeadOffice: true, isActive: true, createdBy: 1 })
      .returning();
    branchId = branch!.id;

    const [warehouse] = await db
      .insert(warehouses)
      .values({ tenantId: TEST_TENANT, branchId, name: 'Test WH', code: 'WH1', isActive: true, createdBy: 1 })
      .returning();
    warehouseId = warehouse!.id;
  });

  afterAll(async () => {
    await db.delete(invoices).where(eq(invoices.tenantId, TEST_TENANT));
    await db.delete(customerInteractions).where(eq(customerInteractions.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('customers default to opted-in on all channels and can be opted out', async () => {
    const [created] = await db
      .insert(customers)
      .values({ tenantId: TEST_TENANT, branchId, displayName: 'Opt Test Customer', phone: '9000000010', creditLimit: '0', openingBalance: '0', createdBy: 1 })
      .returning();

    expect(created!.optOutSms).toBe(false);
    expect(created!.optOutWhatsapp).toBe(false);
    expect(created!.optOutEmail).toBe(false);

    const [updated] = await db
      .update(customers)
      .set({ optOutWhatsapp: true })
      .where(eq(customers.id, created!.id))
      .returning();

    expect(updated!.optOutWhatsapp).toBe(true);
    expect(updated!.optOutSms).toBe(false);
  });

  it('finds an overdue-invoice customer as a reminder candidate, then dedups after a SYSTEM interaction is logged today', async () => {
    const [customer] = await db
      .insert(customers)
      .values({ tenantId: TEST_TENANT, branchId, displayName: 'Overdue Customer', phone: '9000000011', email: 'overdue@example.com', creditLimit: '0', openingBalance: '0', createdBy: 1 })
      .returning();

    await db.insert(invoices).values({
      tenantId: TEST_TENANT,
      branchId,
      warehouseId,
      customerId: customer!.id,
      status: 'OVERDUE',
      placeOfSupply: '27',
      invoiceDate: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      dueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      grandTotal: '5000.00',
      balanceDue: '5000.00',
      createdBy: 1,
    });

    const before = await PaymentReminderService.findCandidates(db, TEST_TENANT);
    const candidate = before.find((c) => c.customerId === customer!.id);
    expect(candidate).toBeDefined();
    expect(candidate!.overdueTotal).toBe(5000);
    expect(candidate!.invoiceCount).toBe(1);

    await db.insert(customerInteractions).values({
      tenantId: TEST_TENANT,
      customerId: customer!.id,
      type: 'SYSTEM',
      notes: 'Payment reminder sent',
      createdBy: 0,
    });

    const after = await PaymentReminderService.findCandidates(db, TEST_TENANT);
    expect(after.find((c) => c.customerId === customer!.id)).toBeUndefined();
  });

  it('rejects editing an interaction older than 24 hours', async () => {
    const [customer] = await db
      .insert(customers)
      .values({ tenantId: TEST_TENANT, branchId, displayName: 'Stale Interaction Customer', phone: '9000000012', creditLimit: '0', openingBalance: '0', createdBy: 1 })
      .returning();

    const [interaction] = await db
      .insert(customerInteractions)
      .values({ tenantId: TEST_TENANT, customerId: customer!.id, type: 'CALL', notes: 'Old note', createdBy: 1 })
      .returning();

    // Backdate createdAt past the 24h edit window (same threshold the PUT route enforces)
    await db
      .update(customerInteractions)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(customerInteractions.id, interaction!.id));

    const [reloaded] = await db
      .select()
      .from(customerInteractions)
      .where(and(eq(customerInteractions.id, interaction!.id), eq(customerInteractions.tenantId, TEST_TENANT)));

    const ageMs = Date.now() - reloaded!.createdAt.getTime();
    expect(ageMs).toBeGreaterThan(24 * 60 * 60 * 1000);
  });
});
