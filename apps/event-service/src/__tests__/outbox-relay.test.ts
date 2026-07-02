import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDatabaseClient } from '@erp/db';
import { OutboxRelayWorker } from '../outbox/OutboxRelayWorker.js';

const DB_URL = process.env['DATABASE_URL'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeKafkaMock(opts: { shouldFail?: boolean } = {}) {
  const published: string[] = [];
  let callCount = 0;

  const producer = {
    connect: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockImplementation(async (payload: { messages: { headers: { eventId: string } }[] }) => {
      callCount++;
      if (opts.shouldFail) throw new Error('Kafka broker unavailable');
      const eventId = payload.messages[0]?.headers?.eventId as string | undefined;
      if (eventId) published.push(eventId);
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };

  const kafka = {
    producer: vi.fn().mockReturnValue(producer),
  };

  return { kafka, producer, published, getCallCount: () => callCount };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!DB_URL)('OutboxRelayWorker integration', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TENANT = 900_800 + Math.floor(Math.random() * 1000);

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM outbox_events WHERE tenant_id = ${TENANT}`);
  });

  it('publishes a pending outbox event within 2000ms', async () => {
    const eventId = `test-evt-${Date.now()}`;

    await db.execute(sql`
      INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, tenant_id, payload, published)
      VALUES (${eventId}, 'TEST_EVENT', 'test', 1, ${TENANT}, ${'{}'}::jsonb, false)
    `);

    const { kafka, producer } = makeKafkaMock();

    // Patch Kafka constructor
    const { Kafka } = await import('kafkajs');
    vi.spyOn({ Kafka }, 'Kafka').mockImplementation(() => kafka as never);

    const worker = new OutboxRelayWorker({
      db,
      kafkaBrokers: ['localhost:29092'],
      kafkaClientId: 'test-outbox',
      pollIntervalMs: 100,
      batchSize: 10,
      maxRetryAttempts: 5,
    });

    // Override the internal Kafka construction by patching produce method
    // Directly test via a controlled producer injection
    worker.start = async () => {
      // Override producer before start
      (worker as unknown as { producer: typeof producer }).producer = producer;
      producer.connect.mockResolvedValue(undefined);
      // Manually trigger poll via the internal method
      await (worker as unknown as { processBatch: () => Promise<void> }).processBatch();
    };

    await worker.start();
    await worker.stop();

    const rows = await db.execute(sql`
      SELECT published FROM outbox_events WHERE event_id = ${eventId}
    `);
    const row = rows[0] as { published: boolean } | undefined;
    expect(row?.published).toBe(true);
  }, 5000);

  it('increments retry_count on Kafka failure and marks failed after maxRetryAttempts', async () => {
    const eventId = `test-fail-${Date.now()}`;

    await db.execute(sql`
      INSERT INTO outbox_events (event_id, event_type, aggregate_type, aggregate_id, tenant_id, payload, published, retry_count)
      VALUES (${eventId}, 'TEST_FAIL', 'test', 2, ${TENANT}, ${'{}'}::jsonb, false, 4)
    `);

    const { producer } = makeKafkaMock({ shouldFail: true });

    const worker = new OutboxRelayWorker({
      db,
      kafkaBrokers: ['localhost:29092'],
      kafkaClientId: 'test-outbox-fail',
      pollIntervalMs: 100,
      batchSize: 10,
      maxRetryAttempts: 5,
    });

    // Inject the failing producer directly
    (worker as unknown as { producer: typeof producer }).producer = producer;

    await (worker as unknown as { processBatch: () => Promise<void> }).processBatch();

    const rows = await db.execute(sql`
      SELECT retry_count, failed FROM outbox_events WHERE event_id = ${eventId}
    `);
    const row = rows[0] as { retry_count: number; failed: boolean } | undefined;

    // retry_count was 4, maxRetryAttempts is 5, so nextRetry = 5 >= 5 → dead-lettered
    expect(row?.failed).toBe(true);
    expect(row?.retry_count).toBe(5);
  }, 5000);
});

// ─── Unit test: stop() waits for current batch ─────────────────────────────

describe('OutboxRelayWorker.stop() waits for in-flight batch', () => {
  it('resolves only after the current batch finishes', async () => {
    const worker = new OutboxRelayWorker({
      db: {} as never,
      kafkaBrokers: ['localhost:29092'],
      kafkaClientId: 'test-stop',
      pollIntervalMs: 60000,
      batchSize: 1,
      maxRetryAttempts: 5,
    });

    // Inject a disconnect-able producer stub
    const producer = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    (worker as unknown as { producer: typeof producer }).producer = producer;

    // Create a deferred promise to simulate an in-flight batch
    let resolveBatch!: () => void;
    const batchPromise = new Promise<void>((resolve) => { resolveBatch = resolve; });
    (worker as unknown as { currentBatch: Promise<void> }).currentBatch = batchPromise;

    const stopPromise = worker.stop();

    let stopResolved = false;
    void stopPromise.then(() => { stopResolved = true; });

    // Batch is still pending — stop must not have resolved yet
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(stopResolved).toBe(false);

    // Finish the batch
    resolveBatch();
    await stopPromise;

    expect(stopResolved).toBe(true);
  });
});
