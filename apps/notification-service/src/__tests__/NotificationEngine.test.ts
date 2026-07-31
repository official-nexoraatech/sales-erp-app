import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@erp/db', () => {
  const makeTable = () =>
    new Proxy(
      {},
      {
        get: (_t, prop) => ({ columnName: String(prop) }),
      }
    );
  return {
    notificationLog: makeTable(),
    notificationTemplates: makeTable(),
    notificationPreferences: makeTable(),
    featureFlags: makeTable(),
    createDatabaseClient: vi.fn(),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => '__eq__'),
  and: vi.fn((..._args: unknown[]) => '__and__'),
  isNull: vi.fn((_a: unknown) => '__isNull__'),
  count: vi.fn(() => '__count__'),
  sql: vi.fn((s: string) => s),
  lt: vi.fn((_a: unknown, _b: unknown) => '__lt__'),
  gte: vi.fn((_a: unknown, _b: unknown) => '__gte__'),
}));

// Mock Handlebars so templates compile without real templates
vi.mock('handlebars', () => ({
  default: { compile: vi.fn().mockReturnValue((_data: unknown) => 'compiled-body') },
}));

import { NotificationEngine } from '../domain/NotificationEngine.js';
import { notificationPreferences, notificationTemplates, featureFlags } from '@erp/db';

// Architectural tier (2026-07-23 audit): delivery moved off the request thread onto a BullMQ
// worker (see DeliveryQueue.ts) — NotificationEngine now only depends on the narrow
// DeliveryEnqueuer interface, so tests inject this trivial mock instead of standing up a real
// queue/Redis. mockEnqueue() lets a test assert exactly what was handed to the queue.
function mockQueue() {
  return { enqueue: vi.fn().mockResolvedValue(undefined) };
}

// Makes a thenable that also has .limit() — handles both await where() and where().limit()
function makeWhereResult(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    limit: vi.fn().mockResolvedValue(rows),
  });
}

// Returns a mock DB where each select().from(table).where() call returns rows keyed by which
// table was queried (rather than call order, since PG-047 added a featureFlags lookup between
// the existing prefs and template lookups).
function makeDb(
  prefs: unknown[] = [],
  template: unknown[] = [],
  logReturn: unknown[] = [{ id: 'log-1' }],
  flag: unknown[] = []
) {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation((table: unknown) => ({
        where: vi.fn().mockImplementation(() => {
          if (table === notificationPreferences) return makeWhereResult(prefs);
          if (table === notificationTemplates) return makeWhereResult(template);
          if (table === featureFlags) return makeWhereResult(flag);
          return makeWhereResult([{ count: '3' }]);
        }),
      })),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi
          .fn()
          .mockReturnValue({ returning: vi.fn().mockResolvedValue(logReturn) }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
  };
}

describe('NotificationEngine — quiet hours behavior via send()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips SMS at 22:00 IST (quiet hours start)', async () => {
    // 22:00 IST = 16:30 UTC
    vi.setSystemTime(new Date('2026-01-01T16:30:00Z'));
    const engine = new NotificationEngine(makeDb() as never, mockQueue());
    const results = await engine.send({
      tenantId: 1,
      eventType: 'TEST_EVENT',
      recipientPhone: '9876543210',
      templateData: { name: 'Test' },
      channels: ['SMS'],
    });
    const smsResult = results.find((r) => r.channel === 'SMS');
    expect(smsResult?.status).toBe('SKIPPED');
  });

  it('skips SMS at 02:00 IST (quiet hours — early morning)', async () => {
    // 02:00 IST = 20:30 UTC (prev day)
    vi.setSystemTime(new Date('2026-01-01T20:30:00Z'));
    const engine = new NotificationEngine(makeDb() as never, mockQueue());
    const results = await engine.send({
      tenantId: 1,
      eventType: 'TEST_EVENT',
      recipientPhone: '9876543210',
      templateData: {},
      channels: ['SMS'],
    });
    const smsResult = results.find((r) => r.channel === 'SMS');
    expect(smsResult?.status).toBe('SKIPPED');
  });

  it('does NOT skip SMS at 10:00 IST due to quiet hours — enqueues for delivery instead', async () => {
    // 10:00 IST = 04:30 UTC — business hours
    vi.setSystemTime(new Date('2026-01-01T04:30:00Z'));
    // Pass recipientUserId=1 so prefs are queried first → template is 2nd select call
    const template = [
      { id: 't1', channel: 'SMS', bodyTemplate: 'Hi {{name}}', isActive: true, subject: null },
    ];
    const queue = mockQueue();
    const engine = new NotificationEngine(makeDb([], template) as never, queue);
    const results = await engine.send({
      tenantId: 1,
      eventType: 'TEST_EVENT',
      recipientUserId: 1,
      recipientPhone: '9876543210',
      templateData: { name: 'Raj' },
      channels: ['SMS'],
    });
    const smsResult = results.find((r) => r.channel === 'SMS');
    // isQuietHours() returns false at 10:00 IST — not skipped for quiet hours, handed to the queue.
    expect(smsResult?.status).toBe('QUEUED');
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  // PG-047: tenant-level custom window via the feature_flags table
  it('honors a tenant-configured quiet-hours window (23:00-06:00) instead of the default', async () => {
    const flag = [{ enabled: true, config: { startHour: 23, endHour: 6 } }];
    const template = [
      { id: 't1', channel: 'SMS', bodyTemplate: 'Hi', isActive: true, subject: null },
    ];

    // 22:30 IST — within the old default window, but NOT within the tenant's custom 23:00-06:00 window
    vi.setSystemTime(new Date('2026-01-01T17:00:00Z'));
    const notSuppressed = await new NotificationEngine(
      makeDb([], template, undefined, flag) as never,
      mockQueue()
    ).send({
      tenantId: 1,
      eventType: 'TEST_EVENT',
      recipientPhone: '9876543210',
      templateData: {},
      channels: ['SMS'],
    });
    expect(notSuppressed.find((r) => r.channel === 'SMS')?.status).toBe('QUEUED');

    // 23:30 IST — within the tenant's custom window
    vi.setSystemTime(new Date('2026-01-01T18:00:00Z'));
    const suppressed = await new NotificationEngine(
      makeDb([], template, undefined, flag) as never,
      mockQueue()
    ).send({
      tenantId: 1,
      eventType: 'TEST_EVENT',
      recipientPhone: '9876543210',
      templateData: {},
      channels: ['SMS'],
    });
    expect(suppressed.find((r) => r.channel === 'SMS')?.status).toBe('SKIPPED');
  });

  // PG-047: fixes the dead-column bug — notificationPreferences.quietHoursEnabled was written
  // by the API but never read by NotificationEngine, so it had zero effect on SMS suppression.
  it('bypasses quiet-hours suppression at 02:00 IST when the user has quietHoursEnabled: false', async () => {
    // 02:00 IST = 20:30 UTC (prev day) — inside the default quiet-hours window
    vi.setSystemTime(new Date('2026-01-01T20:30:00Z'));
    const prefs = [
      {
        smsEnabled: true,
        emailEnabled: true,
        whatsappEnabled: false,
        inAppEnabled: true,
        quietHoursEnabled: false,
      },
    ];
    const template = [
      { id: 't1', channel: 'SMS', bodyTemplate: 'Hi {{name}}', isActive: true, subject: null },
    ];
    const engine = new NotificationEngine(makeDb(prefs, template) as never, mockQueue());
    const results = await engine.send({
      tenantId: 1,
      eventType: 'TEST_EVENT',
      recipientUserId: 1,
      recipientPhone: '9876543210',
      templateData: { name: 'Raj' },
      channels: ['SMS'],
    });
    const smsResult = results.find((r) => r.channel === 'SMS');
    // Previously this column was write-only/dead-read — SMS would have been SKIPPED regardless.
    expect(smsResult?.status).toBe('QUEUED');
  });
});

// ES-26 (M8): idempotency key dedup
// Simulates the real unique-constraint conflict: the first insert for a given idempotencyKey
// returns a row; a second insert with the same key returns nothing (onConflictDoNothing).
// No recipientUserId is passed in these tests, so the only select() call per channel is the
// template lookup (the preferences lookup is skipped entirely) — always return the template.
function makeIdempotentDb(template: unknown[], insertedKeys: Set<string> = new Set()) {
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => makeWhereResult(template)),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((vals: { idempotencyKey: string }) => ({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => {
            if (insertedKeys.has(vals.idempotencyKey)) return Promise.resolve([]);
            insertedKeys.add(vals.idempotencyKey);
            return Promise.resolve([{ id: insertedKeys.size }]);
          }),
        }),
      })),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
  };
}

describe('NotificationEngine.send — idempotency key dedup (M8)', () => {
  const template = [
    { id: 't1', channel: 'IN_APP', bodyTemplate: 'Hi {{name}}', isActive: true, subject: null },
  ];

  it('two rapid-fire sends with the same explicit idempotencyKey result in exactly one QUEUED and one SKIPPED', async () => {
    const insertedKeys = new Set<string>();
    const db = makeIdempotentDb(template, insertedKeys);
    const engine = new NotificationEngine(db as never, mockQueue());

    const input = {
      tenantId: 1,
      eventType: 'TEST_EVENT',
      recipientPhone: '9876543210',
      templateData: { name: 'Raj' },
      channels: ['IN_APP'] as const,
      idempotencyKey: 'invoice-42:reminder-2026-07-04',
    };

    const [first, second] = await Promise.all([engine.send(input), engine.send(input)]);
    const statuses = [first[0]?.status, second[0]?.status].sort();

    expect(statuses).toEqual(['QUEUED', 'SKIPPED']);
  });

  it('two sends with different recipients (same event) are NOT deduped — both queued', async () => {
    const insertedKeys = new Set<string>();
    const db = makeIdempotentDb(template, insertedKeys);
    const queue = mockQueue();
    const engine = new NotificationEngine(db as never, queue);

    const base = {
      tenantId: 1,
      eventType: 'TEST_EVENT',
      templateData: { name: 'Raj' },
      channels: ['IN_APP'] as const,
    };

    const [first, second] = await Promise.all([
      engine.send({ ...base, recipientPhone: '9876543210' }),
      engine.send({ ...base, recipientPhone: '9999999999' }),
    ]);

    expect(first[0]?.status).toBe('QUEUED');
    expect(second[0]?.status).toBe('QUEUED');
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });
});

// Notification-service audit 2026-07-23: sendRaw() previously never persisted recipientUserId,
// so an IN_APP raw notification could never appear in GET /notifications or /unread-count for
// its intended recipient (both filter by recipientUserId) — used by scheduler-service's
// workflow.approval-reminder fix to actually reach the approver.
describe('NotificationEngine.sendRaw — recipientUserId (IN_APP)', () => {
  it('persists recipientUserId on the notification_log insert', async () => {
    const insertedValues: Array<Record<string, unknown>> = [];
    const db = {
      select: vi.fn(),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((vals: Record<string, unknown>) => {
          insertedValues.push(vals);
          return {
            onConflictDoNothing: vi
              .fn()
              .mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1 }]) }),
          };
        }),
      }),
      update: vi.fn(),
    };
    const engine = new NotificationEngine(db as never, mockQueue());

    await engine.sendRaw({
      tenantId: 1,
      eventType: 'WORKFLOW_APPROVAL_REMINDER',
      channel: 'IN_APP',
      recipientUserId: 42,
      body: 'Reminder text',
    });

    expect(insertedValues[0]).toMatchObject({ recipientUserId: 42, channel: 'IN_APP' });
  });
});

// Notification-service audit 2026-07-23: a FAILED notification was permanently terminal — no
// automated re-drive and no manual retry. retryFailed() and retrySingle() close that gap by
// re-queuing (a fresh DeliveryQueue job), not by delivering inline.
describe('NotificationEngine.retryFailed / retrySingle', () => {
  function makeRetryDb(rows: Array<Record<string, unknown>>) {
    return {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(rows) }),
      }),
      insert: vi.fn(),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }),
    };
  }

  it('retryFailed re-queues every FAILED row under the attempt cap', async () => {
    const db = makeRetryDb([
      {
        id: 1,
        channel: 'IN_APP',
        body: 'hi',
        recipientPhone: null,
        recipientEmail: null,
        subject: null,
        attemptCount: 3,
      },
      {
        id: 2,
        channel: 'IN_APP',
        body: 'hi',
        recipientPhone: null,
        recipientEmail: null,
        subject: null,
        attemptCount: 6,
      },
    ]);
    const queue = mockQueue();
    const engine = new NotificationEngine(db as never, queue);

    const result = await engine.retryFailed(1);

    expect(result).toEqual({ requeued: 2 });
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    // Each re-queue resets the row to PENDING before enqueuing (see requeue()).
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it('retrySingle returns null for a notification that is not FAILED (already SENT)', async () => {
    const db = makeRetryDb([{ id: 1, status: 'SENT', channel: 'IN_APP', body: 'hi' }]);
    const queue = mockQueue();
    const engine = new NotificationEngine(db as never, queue);

    const result = await engine.retrySingle(1, 1);
    expect(result).toBeNull();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('retrySingle returns null when no row exists for that tenant (IDOR-safe)', async () => {
    const db = makeRetryDb([]);
    const engine = new NotificationEngine(db as never, mockQueue());

    const result = await engine.retrySingle(1, 999);
    expect(result).toBeNull();
  });

  it('retrySingle re-queues a FAILED row and returns QUEUED', async () => {
    const db = makeRetryDb([
      {
        id: 5,
        status: 'FAILED',
        channel: 'IN_APP',
        body: 'hi',
        recipientPhone: null,
        recipientEmail: null,
        subject: null,
      },
    ]);
    const queue = mockQueue();
    const engine = new NotificationEngine(db as never, queue);

    const result = await engine.retrySingle(1, 5);
    expect(result).toEqual({ channel: 'IN_APP', status: 'QUEUED', logId: 5 });
    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ logId: 5, tenantId: 1, channel: 'IN_APP' })
    );
  });
});

describe('NotificationEngine.getUnreadCount', () => {
  it('returns a number (count from DB)', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: '7' }]),
        }),
      }),
      insert: vi.fn(),
      update: vi.fn(),
    };
    const engine = new NotificationEngine(db as never, mockQueue());
    const count = await engine.getUnreadCount(1, 2);
    expect(typeof count).toBe('number');
  });
});
