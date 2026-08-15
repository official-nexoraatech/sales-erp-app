// Regression test for a real bug found while building the Notification Center:
// NotificationEngine.getUnreadCount never filtered on readAt, so it counted every ever-
// delivered IN_APP notification regardless of read state — confirmed live against the dev DB,
// two already-read rows still reported unreadCount: 2 both before and after a real
// POST /notifications/read-all. A mocked-db unit test can't actually prove SQL-level filtering
// works, so — same convention as packages/platform-sdk/src/__tests__/workflow.test.ts — this
// runs against a real database, skipped when one isn't configured.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { tenants, users, notificationLog } from '@erp/db';
import { eq, inArray } from 'drizzle-orm';
import { NotificationEngine } from '../domain/NotificationEngine.js';
import type { DeliveryEnqueuer } from '../domain/DeliveryQueue.js';

const DB_URL = process.env['DATABASE_URL'];

function mockQueue(): DeliveryEnqueuer {
  return { enqueue: async () => undefined };
}

describe.skipIf(!DB_URL)('NotificationEngine.getUnreadCount — read state filtering', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let tenantId: number;
  let userId: number;
  const logIds: number[] = [];

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const suffix = Date.now();
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: `Unread Count Test Tenant ${suffix}`,
        slug: `unread-count-test-${suffix}`,
        status: 'ACTIVE',
        contactEmail: `unread-count-test-${suffix}@example.com`,
      })
      .returning();
    tenantId = tenant!.id;

    const [user] = await db
      .insert(users)
      .values({
        tenantId,
        email: `unread-count-${suffix}@example.com`,
        passwordHash: 'x',
        firstName: 'Test',
        lastName: 'User',
        isActive: true,
        isEmailVerified: true,
      })
      .returning();
    userId = user!.id;
  });

  afterAll(async () => {
    if (logIds.length) await db.delete(notificationLog).where(inArray(notificationLog.id, logIds));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  it('counts only unread (readAt IS NULL) SENT IN_APP rows, not every delivered one', async () => {
    const [unread] = await db
      .insert(notificationLog)
      .values({
        tenantId,
        eventType: 'TEST_EVENT',
        channel: 'IN_APP',
        recipientUserId: userId,
        body: 'Unread test notification',
        status: 'SENT',
        createdBy: userId,
        readAt: null,
      })
      .returning();
    const [read] = await db
      .insert(notificationLog)
      .values({
        tenantId,
        eventType: 'TEST_EVENT',
        channel: 'IN_APP',
        recipientUserId: userId,
        body: 'Already-read test notification',
        status: 'SENT',
        createdBy: userId,
        readAt: new Date(),
      })
      .returning();
    logIds.push(unread!.id, read!.id);

    const engine = new NotificationEngine(db, mockQueue());
    expect(await engine.getUnreadCount(tenantId, userId)).toBe(1);

    await db
      .update(notificationLog)
      .set({ readAt: new Date() })
      .where(eq(notificationLog.id, unread!.id));
    expect(await engine.getUnreadCount(tenantId, userId)).toBe(0);
  });
});
