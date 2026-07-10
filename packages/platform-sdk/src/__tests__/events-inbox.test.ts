import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => {
  const mockTable = new Proxy({}, { get: (_t, prop) => ({ columnName: String(prop) }) });
  return { inboxEvents: mockTable, outboxEvents: mockTable, dlqItems: mockTable, createDatabaseClient: vi.fn() };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: { columnName: string }, b: unknown) => ({ type: 'eq', col: a.columnName, val: b })),
  and: vi.fn((...args: Array<{ type: string }>) => ({ type: 'and', args })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', strings, values })),
}));

import { PlatformEventConsumer } from '../events.js';
import type { TenantScopedDatabase } from '../database.js';
import type { ERPEventPayload } from '@erp/types';
import type { Kafka } from 'kafkajs';

/* global Buffer */

interface Cond { type: string; col?: string; val?: unknown; args?: Cond[] }

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
            const existing = rows.find((r) => r['eventId'] === v['eventId'] && r['consumerService'] === v['consumerService']);
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
  let eachMessage: ((args: { message: { value: Buffer | null }; topic: string; partition: number }) => Promise<void>) | undefined;
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
      if (!eachMessage) throw new Error('consumer.run() was never called — eachMessage not captured');
      await eachMessage({ message: { value: Buffer.from(JSON.stringify(payload)) }, topic: 'erp.test.event', partition: 0 });
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

    await consumer.subscribe(['erp.test.event'], async () => { handlerCalls++; }, () => db);

    const payload = samplePayload();
    await deliver(payload);
    await deliver(payload); // redelivery — same eventId

    expect(handlerCalls).toBe(1);
  });

  it('a PROCESSED row is never reclaimed — replay after successful processing does not re-run the handler', async () => {
    const { kafka, deliver } = makeFakeKafka();
    const db = makeFakeInboxDb([{ id: 1, eventId: 'evt-1', consumerService: 'test-service', status: 'PROCESSED', tenantId: 1 }]);
    const consumer = new PlatformEventConsumer(kafka, 'test-group', 'test-service');
    let handlerCalls = 0;

    await consumer.subscribe(['erp.test.event'], async () => { handlerCalls++; }, () => db);
    await deliver(samplePayload());

    expect(handlerCalls).toBe(0);
  });

  it('a FAILED row (prior crashed attempt) IS reclaimable — legitimate retries still run the handler', async () => {
    const { kafka, deliver } = makeFakeKafka();
    const db = makeFakeInboxDb([{ id: 1, eventId: 'evt-1', consumerService: 'test-service', status: 'FAILED', tenantId: 1 }]);
    const consumer = new PlatformEventConsumer(kafka, 'test-group', 'test-service');
    let handlerCalls = 0;

    await consumer.subscribe(['erp.test.event'], async () => { handlerCalls++; }, () => db);
    await deliver(samplePayload());

    expect(handlerCalls).toBe(1);
  });
});
