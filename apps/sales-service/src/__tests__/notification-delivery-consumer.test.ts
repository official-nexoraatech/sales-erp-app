// CP-6 (Campaign Management Platform initiative): sales-service's first Kafka consumer handler —
// tested directly against real Postgres (same DB-integration convention as GstLedgerService's
// consumer-adjacent tests), since spinning up a real Kafka broker + PlatformEventConsumer for
// this test was judged lower priority than exhaustively testing the handler's actual sync logic
// (idempotency, cross-service join, deliveredCount rollup) — documented as a gap in the CP-6
// completion report, matching the same scope decision made for the webhook HTTP routes.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { branches, campaigns, campaignRecipients, customers } from '@erp/db';
import { eq } from 'drizzle-orm';
import { TenantScopedDatabase } from '@erp/sdk';
import type { ERPEventPayload } from '@erp/types';
import { handleNotificationDeliveryUpdated } from '../consumers/NotificationDeliveryConsumer.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('handleNotificationDeliveryUpdated — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_601 + Math.floor(Math.random() * 1000);
  let branchId: number;
  let customerId: number;
  let campaignId: number;

  function makeEvent(payload: Record<string, unknown>): ERPEventPayload {
    return {
      eventId: 'test-event-id',
      eventType: 'NOTIFICATION_DELIVERY_UPDATED',
      schemaVersion: 1,
      aggregateType: 'notification_log',
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
        name: 'Test HO',
        code: 'HO',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;

    const [customer] = await db
      .insert(customers)
      .values({
        tenantId: TEST_TENANT,
        branchId,
        displayName: 'Delivery Test Customer',
        phone: '9000000401',
        creditLimit: '0',
        openingBalance: '0',
        createdBy: 1,
      })
      .returning();
    customerId = customer!.id;

    const [campaign] = await db
      .insert(campaigns)
      .values({
        tenantId: TEST_TENANT,
        name: 'Delivery Sync Test Campaign',
        customerIds: [customerId],
        channel: 'WHATSAPP',
        messageTemplate: 'Hi',
        status: 'SENT',
        totalRecipients: 1,
        sentCount: 1,
        deliveredCount: 0,
        createdBy: 1,
      })
      .returning();
    campaignId = campaign!.id;
  });

  afterAll(async () => {
    await db.delete(campaignRecipients).where(eq(campaignRecipients.tenantId, TEST_TENANT));
    await db.delete(campaigns).where(eq(campaigns.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('syncs status/deliveredAt onto the matching campaign_recipient and increments campaigns.deliveredCount', async () => {
    const [recipient] = await db
      .insert(campaignRecipients)
      .values({
        tenantId: TEST_TENANT,
        campaignId,
        customerId,
        status: 'SENT',
        notificationLogId: 5001,
      })
      .returning();

    const tsDb = new TenantScopedDatabase(TEST_TENANT, db);
    await handleNotificationDeliveryUpdated(
      makeEvent({ notificationLogId: 5001, status: 'DELIVERED', errorMessage: null }),
      tsDb
    );

    const [reloadedRecipient] = await db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.id, recipient!.id));
    expect(reloadedRecipient?.status).toBe('DELIVERED');
    expect(reloadedRecipient?.deliveredAt).not.toBeNull();

    const [reloadedCampaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId));
    expect(reloadedCampaign?.deliveredCount).toBe(1);
  });

  it('is idempotent — applying the same status twice only increments deliveredCount once', async () => {
    const [recipient] = await db
      .insert(campaignRecipients)
      .values({
        tenantId: TEST_TENANT,
        campaignId,
        customerId,
        status: 'SENT',
        notificationLogId: 5002,
      })
      .returning();

    const tsDb = new TenantScopedDatabase(TEST_TENANT, db);
    const event = makeEvent({ notificationLogId: 5002, status: 'DELIVERED', errorMessage: null });
    await handleNotificationDeliveryUpdated(event, tsDb);
    const [afterFirst] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));

    await handleNotificationDeliveryUpdated(event, tsDb);
    const [afterSecond] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));

    expect(afterSecond?.deliveredCount).toBe(afterFirst?.deliveredCount);

    const [reloadedRecipient] = await db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.id, recipient!.id));
    expect(reloadedRecipient?.status).toBe('DELIVERED');
  });

  it('sets errorMessage on FAILED without touching deliveredCount', async () => {
    await db
      .insert(campaignRecipients)
      .values({
        tenantId: TEST_TENANT,
        campaignId,
        customerId,
        status: 'SENT',
        notificationLogId: 5003,
      });
    const [before] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));

    const tsDb = new TenantScopedDatabase(TEST_TENANT, db);
    await handleNotificationDeliveryUpdated(
      makeEvent({ notificationLogId: 5003, status: 'FAILED', errorMessage: 'Bounced' }),
      tsDb
    );

    const [reloadedRecipient] = await db
      .select()
      .from(campaignRecipients)
      .where(eq(campaignRecipients.notificationLogId, 5003));
    expect(reloadedRecipient?.status).toBe('FAILED');
    expect(reloadedRecipient?.errorMessage).toBe('Bounced');

    const [after] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    expect(after?.deliveredCount).toBe(before?.deliveredCount);
  });

  it('is a no-op when no campaign_recipient matches the notificationLogId (non-campaign notification)', async () => {
    const tsDb = new TenantScopedDatabase(TEST_TENANT, db);
    await expect(
      handleNotificationDeliveryUpdated(
        makeEvent({ notificationLogId: 999_999_999, status: 'DELIVERED', errorMessage: null }),
        tsDb
      )
    ).resolves.not.toThrow();
  });

  it('is a no-op for a malformed payload (missing notificationLogId/status)', async () => {
    const tsDb = new TenantScopedDatabase(TEST_TENANT, db);
    await expect(handleNotificationDeliveryUpdated(makeEvent({}), tsDb)).resolves.not.toThrow();
  });
});
