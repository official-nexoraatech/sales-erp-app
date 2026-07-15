import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => {
  const mockTable = new Proxy({}, { get: (_t, prop) => ({ columnName: String(prop) }) });
  return {
    inboxEvents: mockTable,
    outboxEvents: mockTable,
    dlqItems: mockTable,
    createDatabaseClient: vi.fn(),
  };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: { columnName: string }, b: unknown) => ({ type: 'eq', col: a.columnName, val: b })),
  and: vi.fn((...args: Array<{ type: string }>) => ({ type: 'and', args })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    type: 'sql',
    strings,
    values,
  })),
}));

import { PlatformEventConsumer } from '../events.js';
import type { TenantScopedDatabase } from '../database.js';
import type { ERPEventPayload } from '@erp/types';
import type { Kafka } from 'kafkajs';

/* global Buffer */

interface Cond {
  type: string;
  col?: string;
  val?: unknown;
  args?: Cond[];
}

function matches(row: Record<string, unknown>, cond: Cond): boolean {
  if (cond.type === 'and') return (cond.args ?? []).every((c) => matches(row, c));
  return row[cond.col!] === cond.val;
}

// Models the real Postgres semantics of the fixed onConflictDoUpdate({..., setWhere}):
// a row already PROCESSED is left untouched (0 rows returned to caller); any other
// existing status (or no existing row) is claimable and returns 1 row.
function makeFakeInboxDb(existingRows: Array<Record<string, unknown>> = []) {
  const rows = [...existingRows];
  const raw = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: () => ({
          returning: () => {
            const existing = rows.find(
              (r) => r['eventId'] === v['eventId'] && r['consumerService'] === v['consumerService']
            );
            if (existing) {
              if (existing['status'] === 'PROCESSED') return Promise.resolve([]);
              Object.assign(existing, { status: v['status'] });
              return Promise.resolve([{ id: existing['id'] }]);
            }
            const inserted = { id: rows.length + 1, ...v };
            rows.push(inserted);
            return Promise.resolve([{ id: inserted.id }]);
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: Cond) => {
          rows.filter((r) => matches(r, cond)).forEach((r) => Object.assign(r, patch));
          return Promise.resolve();
        },
      }),
    }),
  };
  const db = {
    rows,
    raw,
    transaction: async (fn: (trx: { raw: typeof raw }) => Promise<unknown>) => fn({ raw }),
  };
  return db as unknown as TenantScopedDatabase & { rows: typeof rows };
}

function makeFakeKafka() {
  let eachMessage:
    | ((args: {
        message: {
          value: Buffer | null;
          headers?: Record<string, Buffer | string>;
          offset: string;
        };
        topic: string;
        partition: number;
      }) => Promise<void>)
    | undefined;
  const fakeConsumer = {
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockImplementation(async (opts: { eachMessage: typeof eachMessage }) => {
      eachMessage = opts.eachMessage;
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const kafka = { consumer: vi.fn().mockReturnValue(fakeConsumer) };
  return {
    kafka: kafka as unknown as Kafka,
    deliver: async (payload: ERPEventPayload) => {
      if (!eachMessage)
        throw new Error('consumer.run() was never called — eachMessage not captured');
      await eachMessage({
        message: { value: Buffer.from(JSON.stringify(payload)), offset: '0' },
        topic: 'erp.test.event',
        partition: 0,
      });
    },
    // Models the REAL production wire format: OutboxRelayWorker publishes the message value
    // as just the flat business payload, with eventId/eventType/tenantId in Kafka headers —
    // never nested inside the value. See events.ts's eachMessage rationale comment.
    deliverRaw: async (
      businessPayload: Record<string, unknown>,
      headers: Record<string, string>,
      offset = '0'
    ) => {
      if (!eachMessage)
        throw new Error('consumer.run() was never called — eachMessage not captured');
      await eachMessage({
        message: {
          value: Buffer.from(JSON.stringify(businessPayload)),
          headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, Buffer.from(v)])),
          offset,
        },
        topic: 'erp.test.event',
        partition: 0,
      });
    },
    // Models the OTHER real production wire format: ctx.events.publish() (PlatformEventBus,
    // used by hr-service) writes the FULL ERPEventPayload envelope as the outbox row's
    // payload — so the Kafka message value is that whole envelope, not a flat business object.
    deliverEnveloped: async (envelope: ERPEventPayload, offset = '0') => {
      if (!eachMessage)
        throw new Error('consumer.run() was never called — eachMessage not captured');
      await eachMessage({
        message: { value: Buffer.from(JSON.stringify(envelope)), offset },
        topic: 'erp.test.event',
        partition: 0,
      });
    },
  };
}

function samplePayload(overrides?: Partial<ERPEventPayload>): ERPEventPayload {
  return {
    eventId: 'evt-1',
    eventType: 'TEST_EVENT',
    schemaVersion: 1,
    aggregateType: 'Test',
    aggregateId: 1,
    tenantId: 1,
    userId: 1,
    correlationId: 'corr-1',
    causationId: 'corr-1',
    occurredAt: new Date().toISOString(),
    payload: {},
    ...overrides,
  } as ERPEventPayload;
}

describe('PlatformEventConsumer inbox idempotency (ES-24 C7)', () => {
  it('two redeliveries of the same eventId via subscribe() run the handler exactly once', async () => {
    const { kafka, deliver } = makeFakeKafka();
    const db = makeFakeInboxDb();
    const consumer = new PlatformEventConsumer(kafka, 'test-group', 'test-service');
    let handlerCalls = 0;

    await consumer.subscribe(
      ['erp.test.event'],
      async () => {
        handlerCalls++;
      },
      () => db
    );

    const payload = samplePayload();
    await deliver(payload);
    await deliver(payload); // redelivery — same eventId

    expect(handlerCalls).toBe(1);
  });

  it('a PROCESSED row is never reclaimed — replay after successful processing does not re-run the handler', async () => {
    const { kafka, deliver } = makeFakeKafka();
    const db = makeFakeInboxDb([
      {
        id: 1,
        eventId: 'evt-1',
        consumerService: 'test-service',
        status: 'PROCESSED',
        tenantId: 1,
      },
    ]);
    const consumer = new PlatformEventConsumer(kafka, 'test-group', 'test-service');
    let handlerCalls = 0;

    await consumer.subscribe(
      ['erp.test.event'],
      async () => {
        handlerCalls++;
      },
      () => db
    );
    await deliver(samplePayload());

    expect(handlerCalls).toBe(0);
  });

  it('a FAILED row (prior crashed attempt) IS reclaimable — legitimate retries still run the handler', async () => {
    const { kafka, deliver } = makeFakeKafka();
    const db = makeFakeInboxDb([
      { id: 1, eventId: 'evt-1', consumerService: 'test-service', status: 'FAILED', tenantId: 1 },
    ]);
    const consumer = new PlatformEventConsumer(kafka, 'test-group', 'test-service');
    let handlerCalls = 0;

    await consumer.subscribe(
      ['erp.test.event'],
      async () => {
        handlerCalls++;
      },
      () => db
    );
    await deliver(samplePayload());

    expect(handlerCalls).toBe(1);
  });

  it('resolves tenantId/eventId/eventType from Kafka headers when the message value is just the flat business payload (the real OutboxRelayWorker wire format) — regression for the crash-loop bug where dbFactory(undefined) threw on every real message', async () => {
    const { kafka, deliverRaw } = makeFakeKafka();
    const db = makeFakeInboxDb();
    const consumer = new PlatformEventConsumer(kafka, 'test-group', 'test-service');
    let receivedTenantId: number | undefined;
    let receivedPayload: Record<string, unknown> | undefined;
    let dbFactoryCalledWith: number | undefined;

    await consumer.subscribe(
      ['erp.test.event'],
      async (event) => {
        receivedTenantId = event.tenantId;
        receivedPayload = event.payload;
      },
      (tenantId) => {
        dbFactoryCalledWith = tenantId;
        return db;
      }
    );

    // No `tenantId`, `eventId`, or `eventType` anywhere in the value — exactly like a real
    // INVOICE_CONFIRMED payload on the wire.
    await deliverRaw(
      { invoiceId: 16, taxableAmount: '5000.00', customerName: 'Ramesh Textiles' },
      { eventId: 'evt-real-1', eventType: 'INVOICE_CONFIRMED', tenantId: '2' }
    );

    expect(dbFactoryCalledWith).toBe(2);
    expect(receivedTenantId).toBe(2);
    expect(receivedPayload).toEqual({
      invoiceId: 16,
      taxableAmount: '5000.00',
      customerName: 'Ramesh Textiles',
    });
  });

  it('unwraps a full ERPEventPayload envelope (ctx.events.publish() wire format, e.g. hr-service payroll events) instead of treating the whole envelope as the business payload', async () => {
    const { kafka, deliverEnveloped } = makeFakeKafka();
    const db = makeFakeInboxDb();
    const consumer = new PlatformEventConsumer(kafka, 'test-group', 'test-service');
    let receivedTenantId: number | undefined;
    let receivedUserId: number | undefined;
    let receivedPayload: Record<string, unknown> | undefined;
    let dbFactoryCalledWith: number | undefined;

    await consumer.subscribe(
      ['erp.test.event'],
      async (event) => {
        receivedTenantId = event.tenantId;
        receivedUserId = event.userId;
        receivedPayload = event.payload;
      },
      (tenantId) => {
        dbFactoryCalledWith = tenantId;
        return db;
      }
    );

    // Real shape written by PlatformEventBus.publishInTransaction(): a full envelope with the
    // caller's actual business fields nested one level deeper, under `payload`.
    await deliverEnveloped(
      samplePayload({
        eventType: 'PAYROLL_RUN_APPROVED',
        tenantId: 2,
        userId: 7,
        payload: { payrollRunId: 1, periodMonth: 7, periodYear: 2026, totalNet: '45000.00' },
      })
    );

    expect(dbFactoryCalledWith).toBe(2);
    expect(receivedTenantId).toBe(2);
    expect(receivedUserId).toBe(7);
    expect(receivedPayload).toEqual({
      payrollRunId: 1,
      periodMonth: 7,
      periodYear: 2026,
      totalNet: '45000.00',
    });
  });

  it('drops (does not crash on) a message with no resolvable tenantId anywhere', async () => {
    const { kafka, deliverRaw } = makeFakeKafka();
    const db = makeFakeInboxDb();
    const consumer = new PlatformEventConsumer(kafka, 'test-group', 'test-service');
    let handlerCalls = 0;

    await consumer.subscribe(
      ['erp.test.event'],
      async () => {
        handlerCalls++;
      },
      () => db
    );

    await expect(
      deliverRaw({ invoiceId: 16 }, { eventId: 'evt-real-2', eventType: 'INVOICE_CONFIRMED' })
    ).resolves.not.toThrow();
    expect(handlerCalls).toBe(0);
  });
});
