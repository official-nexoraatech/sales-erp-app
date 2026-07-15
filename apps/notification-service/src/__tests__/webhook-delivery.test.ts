// CP-6: integration tests for the webhook delivery-processing logic (idempotency + status
// update + outbox write) against the real dev Postgres. HTTP-level route testing (raw-body
// content-type parser, actual signature headers over a live Fastify instance) was judged lower
// priority than testing the domain logic directly and the signature verification exhaustively
// (see webhookVerification.test.ts) given this phase's remaining scope — documented as a gap in
// the CP-6 completion report, not silently skipped.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { notificationLog, notificationDeliveryEvents, outboxEvents } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { recordDeliveryEvent, applyDeliveryUpdate } from '../api/webhook.routes.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('webhook delivery processing — integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 900_501 + Math.floor(Math.random() * 1000);
  let logId: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const [log] = await db
      .insert(notificationLog)
      .values({
        tenantId: TEST_TENANT,
        eventType: 'CRM_CAMPAIGN',
        channel: 'WHATSAPP',
        recipientPhone: '9000000301',
        body: 'Hi there',
        status: 'SENT',
        externalMessageId: 'wamid.TEST123',
        createdBy: 0,
      })
      .returning();
    logId = log!.id;
  });

  afterAll(async () => {
    await db.delete(outboxEvents).where(eq(outboxEvents.tenantId, TEST_TENANT));
    await db
      .delete(notificationDeliveryEvents)
      .where(eq(notificationDeliveryEvents.notificationLogId, logId));
    await db.delete(notificationLog).where(eq(notificationLog.tenantId, TEST_TENANT));
  });

  it('recordDeliveryEvent returns true (new) on first insert and false (duplicate) on redelivery', async () => {
    const first = await recordDeliveryEvent(
      db,
      TEST_TENANT,
      logId,
      'META',
      'wamid.TEST123:DELIVERED',
      'DELIVERED'
    );
    expect(first).toBe(true);

    const redelivered = await recordDeliveryEvent(
      db,
      TEST_TENANT,
      logId,
      'META',
      'wamid.TEST123:DELIVERED',
      'DELIVERED'
    );
    expect(redelivered).toBe(false);

    const rows = await db
      .select()
      .from(notificationDeliveryEvents)
      .where(eq(notificationDeliveryEvents.notificationLogId, logId));
    expect(rows).toHaveLength(1);
  });

  it('applyDeliveryUpdate sets notification_log status/deliveredAt and writes an outbox event', async () => {
    await applyDeliveryUpdate(
      db,
      { id: logId, tenantId: TEST_TENANT, deliveredAt: null },
      'DELIVERED',
      undefined
    );

    const [reloaded] = await db.select().from(notificationLog).where(eq(notificationLog.id, logId));
    expect(reloaded?.status).toBe('DELIVERED');
    expect(reloaded?.deliveredAt).not.toBeNull();

    const [outboxRow] = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.tenantId, TEST_TENANT),
          eq(outboxEvents.eventType, 'NOTIFICATION_DELIVERY_UPDATED')
        )
      );
    expect(outboxRow).toBeDefined();
    expect(outboxRow?.aggregateId).toBe(logId);
    expect((outboxRow?.payload as { notificationLogId: number; status: string }).status).toBe(
      'DELIVERED'
    );
  });

  it('applyDeliveryUpdate with FAILED sets errorMessage and does not touch deliveredAt again', async () => {
    const [before] = await db.select().from(notificationLog).where(eq(notificationLog.id, logId));
    await applyDeliveryUpdate(
      db,
      { id: logId, tenantId: TEST_TENANT, deliveredAt: before!.deliveredAt },
      'FAILED',
      'Provider reported failure'
    );

    const [reloaded] = await db.select().from(notificationLog).where(eq(notificationLog.id, logId));
    expect(reloaded?.status).toBe('FAILED');
    expect(reloaded?.errorMessage).toBe('Provider reported failure');
    // deliveredAt from the earlier DELIVERED event is preserved, not cleared, by a later FAILED
    // update — applyDeliveryUpdate only ever sets it forward, matching how a channel could
    // legitimately report DELIVERED then later a distinct FAILED event (e.g. WhatsApp read
    // receipt followed by an unrelated error) without erasing delivery history.
    expect(reloaded?.deliveredAt).not.toBeNull();
  });
});
