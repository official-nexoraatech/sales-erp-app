/* global setTimeout */
import { Kafka, type Producer, Partitioners } from 'kafkajs';
import { sql } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'event-service' });

interface OutboxRow {
  id: number;
  event_id: string;
  event_type: string;
  aggregate_id: number;
  tenant_id: number;
  payload: Record<string, unknown>;
  retry_count: number;
}

export interface OutboxWorkerConfig {
  db: ErpDatabase;
  kafkaBrokers: string[];
  kafkaClientId: string;
  pollIntervalMs?: number;
  batchSize?: number;
  maxRetryAttempts?: number;
}

export class OutboxRelayWorker {
  private producer: Producer | null = null;
  private running = false;
  private currentBatch: Promise<void> | null = null;
  private deadLetterCount = 0;
  private lastPublishedAt: Date | null = null;

  private readonly db: ErpDatabase;
  private readonly kafkaBrokers: string[];
  private readonly kafkaClientId: string;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxRetryAttempts: number;

  constructor(config: OutboxWorkerConfig) {
    this.db = config.db;
    this.kafkaBrokers = config.kafkaBrokers;
    this.kafkaClientId = config.kafkaClientId;
    this.pollIntervalMs = config.pollIntervalMs ?? 500;
    this.batchSize = config.batchSize ?? 100;
    this.maxRetryAttempts = config.maxRetryAttempts ?? 5;
  }

  async start(): Promise<void> {
    if (this.running) return;

    const kafka = new Kafka({
      clientId: this.kafkaClientId,
      brokers: this.kafkaBrokers,
      retry: { retries: 3, initialRetryTime: 300, multiplier: 2 },
    });
    this.producer = kafka.producer({ createPartitioner: Partitioners.LegacyPartitioner });
    await this.producer.connect();
    this.running = true;
    void this.pollLoop();
    logger.info({ pollIntervalMs: this.pollIntervalMs, batchSize: this.batchSize }, 'OutboxRelayWorker started');
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      const batch = this.processBatch().catch((err: unknown) => {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'OutboxRelayWorker: unhandled batch error');
      });
      this.currentBatch = batch;
      await batch;
      this.currentBatch = null;
      if (this.running) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }
    }
    logger.info({}, 'OutboxRelayWorker stopped gracefully');
  }

  private async processBatch(): Promise<void> {
    const producer = this.producer;
    if (!producer) return;

    // Phase 1: Fetch rows in a short transaction — lock is released on commit.
    // Kafka sends happen AFTER the transaction to avoid holding DB locks
    // during network I/O (critical for PgBouncer transaction-mode pools).
    let rows: OutboxRow[];
    try {
      rows = await this.db.transaction(async (trx) => {
        const result = await trx.execute(sql`
          SELECT id, event_id, event_type, aggregate_id, tenant_id, payload, retry_count
          FROM outbox_events
          WHERE published = false AND failed = false
          ORDER BY created_at
          LIMIT ${this.batchSize}
          FOR UPDATE SKIP LOCKED
        `);
        return result as unknown as OutboxRow[];
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'OutboxRelayWorker: failed to fetch batch');
      return;
    }

    // Phase 2: Produce each event to Kafka, then update in separate short queries.
    for (const row of rows) {
      const topic = `erp.${row.event_type.toLowerCase().replace(/_/g, '.')}`;

      try {
        await producer.send({
          topic,
          messages: [
            {
              key: String(row.aggregate_id),
              value: JSON.stringify(row.payload),
              headers: {
                eventId: row.event_id,
                eventType: row.event_type,
                tenantId: String(row.tenant_id),
              },
            },
          ],
        });

        await this.db.execute(sql`
          UPDATE outbox_events
          SET published = true, published_at = NOW()
          WHERE id = ${row.id}
        `);

        this.lastPublishedAt = new Date();
        logger.info({ eventId: row.event_id, eventType: row.event_type, topic }, 'Outbox event published');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const nextRetry = row.retry_count + 1;

        try {
          if (nextRetry >= this.maxRetryAttempts) {
            await this.db.execute(sql`
              UPDATE outbox_events
              SET failed = true, failed_reason = ${errMsg}, retry_count = ${nextRetry}
              WHERE id = ${row.id}
            `);
            this.deadLetterCount += 1;
            logger.error(
              { eventId: row.event_id, eventType: row.event_type, retries: nextRetry, err: errMsg },
              'Outbox event dead-lettered after max retries'
            );
          } else {
            await this.db.execute(sql`
              UPDATE outbox_events
              SET retry_count = ${nextRetry}
              WHERE id = ${row.id}
            `);
            logger.warn(
              { eventId: row.event_id, eventType: row.event_type, retry: nextRetry, err: errMsg },
              'Outbox event publish failed — will retry'
            );
          }
        } catch (updateErr) {
          logger.error(
            { eventId: row.event_id, err: updateErr instanceof Error ? updateErr.message : String(updateErr) },
            'OutboxRelayWorker: failed to update retry state'
          );
        }
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.running && !this.currentBatch) return;
    this.running = false;
    if (this.currentBatch) {
      await this.currentBatch;
    }
    try {
      await this.producer?.disconnect();
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'OutboxRelayWorker: producer disconnect error during stop');
    }
    this.producer = null;
  }

  getDeadLetterCount(): number {
    return this.deadLetterCount;
  }

  getLastPublishedAt(): Date | null {
    return this.lastPublishedAt;
  }

  async getQueueDepth(): Promise<number> {
    const rows = await this.db.execute(sql`
      SELECT COUNT(*)::INTEGER AS cnt FROM outbox_events WHERE published = false AND failed = false
    `);
    const row = rows[0] as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  async getDbDeadLetterCount(): Promise<number> {
    const rows = await this.db.execute(sql`
      SELECT COUNT(*)::INTEGER AS cnt FROM outbox_events WHERE failed = true
    `);
    const row = rows[0] as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }
}
