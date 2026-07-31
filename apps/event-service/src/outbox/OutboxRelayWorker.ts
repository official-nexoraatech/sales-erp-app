/* global setTimeout */
import { Kafka, type Producer, Partitioners } from 'kafkajs';
import { sql } from 'drizzle-orm';
import { dlqItems, type ErpDatabase } from '@erp/db';
import { createLogger, erpDlqDepth, erpOutboxPendingCount, erpOutboxRelayTotal } from '@erp/logger';

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
  // Base delay for exponential backoff between retries (doubled per attempt, capped at
  // MAX_RETRY_DELAY_MS) — without this, a failed publish retried on the very next poll
  // tick could dead-letter a real business event within a couple of seconds of a
  // transient Kafka blip, well before the broker could plausibly recover.
  retryBaseDelayMs?: number;
}

const MAX_RETRY_DELAY_MS = 300_000; // 5 minutes

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
  private readonly retryBaseDelayMs: number;

  constructor(config: OutboxWorkerConfig) {
    this.db = config.db;
    this.kafkaBrokers = config.kafkaBrokers;
    this.kafkaClientId = config.kafkaClientId;
    this.pollIntervalMs = config.pollIntervalMs ?? 500;
    this.batchSize = config.batchSize ?? 100;
    this.maxRetryAttempts = config.maxRetryAttempts ?? 5;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 2_000;
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
    logger.info(
      { pollIntervalMs: this.pollIntervalMs, batchSize: this.batchSize },
      'OutboxRelayWorker started'
    );
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      const batch = this.processBatch().catch((err: unknown) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'OutboxRelayWorker: unhandled batch error'
        );
      });
      this.currentBatch = batch;
      await batch;
      this.currentBatch = null;
      await this.refreshGauges();
      if (this.running) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }
    }
    logger.info({}, 'OutboxRelayWorker stopped gracefully');
  }

  // Reuses the existing poll cadence instead of a second timer — keeps the outbox-pending
  // and DLQ-depth gauges fresh at the same interval the relay itself runs at. Both metrics
  // are defined in @erp/logger's erp-metrics.ts and already wired into
  // infrastructure/docker/prometheus/alert-rules.yml (DLQDepthHigh, OutboxLagHigh) and the
  // erp-hardening Grafana dashboard — they were previously never set anywhere, so those
  // alerts/panels could never fire/render despite existing.
  private async refreshGauges(): Promise<void> {
    try {
      erpOutboxPendingCount.set(await this.getQueueDepth());

      const rows = await this.db.execute(sql`
        SELECT topic, COUNT(*)::INTEGER AS cnt FROM dlq_items WHERE status = 'PENDING' GROUP BY topic
      `);
      erpDlqDepth.reset();
      for (const row of rows as unknown as Array<{ topic: string; cnt: number }>) {
        erpDlqDepth.set({ topic: row.topic }, row.cnt);
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'OutboxRelayWorker: failed to refresh outbox/DLQ gauges'
      );
    }
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
            AND (next_retry_at IS NULL OR next_retry_at <= NOW())
          ORDER BY created_at
          LIMIT ${this.batchSize}
          FOR UPDATE SKIP LOCKED
        `);
        return result as unknown as OutboxRow[];
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'OutboxRelayWorker: failed to fetch batch'
      );
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
        erpOutboxRelayTotal.inc({ tenant_id: String(row.tenant_id), event_type: row.event_type });
        logger.info(
          { eventId: row.event_id, eventType: row.event_type, topic },
          'Outbox event published'
        );
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
            // Previously the only trace of a dead-lettered outbox event was this counter and
            // a DB row nothing ever read — the admin DLQ console (dlq.routes.ts) only queries
            // dlq_items, which (before this fix) was written to solely by search-service's own
            // consumer-side sync failures. Every publish-side dead letter — from any of the
            // 15 services, since this worker is the only Kafka producer for the outbox pattern
            // — was therefore invisible and unreplayable via any admin surface. Inserting here
            // reuses the existing dlq_items schema/routes/UI as-is (no new surface needed).
            await this.db.insert(dlqItems).values({
              topic,
              partition: 0,
              offset: row.event_id,
              payload: row.payload,
              headers: {
                eventId: row.event_id,
                eventType: row.event_type,
                tenantId: String(row.tenant_id),
                source: 'outbox-relay',
              },
              errorMessage: errMsg,
              retryCount: nextRetry,
              status: 'PENDING',
              tenantId: row.tenant_id,
            });
            this.deadLetterCount += 1;
            logger.error(
              { eventId: row.event_id, eventType: row.event_type, retries: nextRetry, err: errMsg },
              'Outbox event dead-lettered after max retries'
            );
          } else {
            const backoffMs = Math.min(
              this.retryBaseDelayMs * 2 ** (nextRetry - 1),
              MAX_RETRY_DELAY_MS
            );
            await this.db.execute(sql`
              UPDATE outbox_events
              SET retry_count = ${nextRetry}, next_retry_at = NOW() + (${backoffMs} * INTERVAL '1 millisecond')
              WHERE id = ${row.id}
            `);
            logger.warn(
              {
                eventId: row.event_id,
                eventType: row.event_type,
                retry: nextRetry,
                backoffMs,
                err: errMsg,
              },
              'Outbox event publish failed — will retry after backoff'
            );
          }
        } catch (updateErr) {
          logger.error(
            {
              eventId: row.event_id,
              err: updateErr instanceof Error ? updateErr.message : String(updateErr),
            },
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
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'OutboxRelayWorker: producer disconnect error during stop'
      );
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

  async publishRaw(
    topic: string,
    key: string,
    value: Record<string, unknown>,
    headers: Record<string, string>
  ): Promise<void> {
    if (!this.producer) throw new Error('OutboxRelayWorker not started');

    await this.producer.send({
      topic,
      messages: [{ key, value: JSON.stringify(value), headers }],
    });
  }
}
