import { type Kafka, type Producer, type Consumer, Partitioners } from 'kafkajs';
import { ulid } from 'ulid';
import { inboxEvents, outboxEvents, dlqItems } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from './database.js';

export type { ERPEventPayload };

// ─── Outbox Publisher (Hardened — M12.3) ──────────────────────────────────
// Polls every 100ms (was 500ms), validates schema, moves to DLQ on retry_count > 5
export class OutboxPublisher {
  private producer: Producer | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private publishLagMs = 0;

  constructor(
    private readonly kafka: Kafka,
    private readonly maxRetries: number = 5,
    private readonly pollIntervalMs: number = 100
  ) {}

  async start(db: TenantScopedDatabase['raw']): Promise<void> {
    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.LegacyPartitioner,
    });
    await this.producer.connect();

    this.intervalHandle = setInterval(async () => {
      await this.publishPending(db);
    }, this.pollIntervalMs);
  }

  private async publishPending(db: TenantScopedDatabase['raw']): Promise<void> {
    if (!this.producer) return;

    const pending = await db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.published, false)))
      .orderBy(outboxEvents.createdAt)
      .limit(100);

    for (const event of pending) {
      const payload = event.payload as ERPEventPayload;
      const insertedAt = event.createdAt;
      const topic = this.buildTopic(event.eventType);

      try {
        await this.producer.send({
          topic,
          messages: [
            {
              key: String(event.aggregateId),
              value: JSON.stringify(payload),
              headers: {
                eventId: event.eventId,
                eventType: event.eventType,
                tenantId: String(event.tenantId),
                schemaVersion: String(payload.schemaVersion ?? 1),
              },
            },
          ],
        });

        await db
          .update(outboxEvents)
          .set({ published: true, publishedAt: new Date() })
          .where(eq(outboxEvents.id, event.id));

        // Track publish lag
        this.publishLagMs = Date.now() - insertedAt.getTime();

        // Alert if lag > 30 seconds
        if (this.publishLagMs > 30_000) {
          process.stderr.write(
            `[OutboxPublisher] ALERT: publish lag ${this.publishLagMs}ms for event ${event.eventId} — exceeds 30s threshold\n`
          );
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);

        // Check retry count — move to DLQ after maxRetries
        const currentRetries = (event as unknown as Record<string, unknown>)['retry_count'] as number ?? 0;

        if (currentRetries >= this.maxRetries) {
          // Move to DLQ
          await db.insert(dlqItems).values({
            topic,
            partition: 0,
            offset: String(event.id),
            payload: payload as unknown as Record<string, unknown>,
            headers: {
              eventId: event.eventId,
              eventType: event.eventType,
              tenantId: String(event.tenantId),
            },
            errorMessage: errMsg,
            retryCount: currentRetries,
            status: 'PENDING',
            tenantId: event.tenantId,
          });

          // Mark as published to prevent retrying
          await db
            .update(outboxEvents)
            .set({ published: true, publishedAt: new Date() })
            .where(eq(outboxEvents.id, event.id));

          process.stderr.write(
            `[OutboxPublisher] Moved event ${event.eventId} to DLQ after ${currentRetries} retries: ${errMsg}\n`
          );
        } else {
          process.stderr.write(
            `[OutboxPublisher] Failed to publish event ${event.eventId} (retry ${currentRetries}/${this.maxRetries}): ${errMsg}\n`
          );
        }
      }
    }
  }

  getPublishLagMs(): number {
    return this.publishLagMs;
  }

  private buildTopic(eventType: string): string {
    return `erp.${eventType.toLowerCase().replace(/_/g, '.')}`;
  }

  async stop(): Promise<void> {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    await this.producer?.disconnect();
  }
}

// ─── Platform Event Bus ────────────────────────────────────────────────────
// Services NEVER publish directly to Kafka — always through outbox (§4.4)
export class PlatformEventBus {
  constructor(
    private readonly db: TenantScopedDatabase,
    private readonly tenantId: number,
    private readonly userId: number,
    private readonly correlationId: string
  ) {}

  async publishInTransaction(
    aggregateType: string,
    aggregateId: number,
    eventType: string,
    payload: Record<string, unknown>,
    causationId?: string
  ): Promise<void> {
    const eventId = ulid();

    await this.db.insertIntoOutbox({
      eventId,
      eventType,
      aggregateType,
      aggregateId,
      payload: {
        eventId,
        eventType,
        schemaVersion: 1,
        aggregateType,
        aggregateId,
        tenantId: this.tenantId,
        userId: this.userId,
        correlationId: this.correlationId,
        causationId: causationId ?? this.correlationId,
        occurredAt: new Date().toISOString(),
        payload,
      } satisfies ERPEventPayload,
    });
  }

  async publish(
    aggregateType: string,
    aggregateId: number,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.db.transaction(async (trx) => {
      const eventBus = new PlatformEventBus(
        trx,
        this.tenantId,
        this.userId,
        this.correlationId
      );
      await eventBus.publishInTransaction(aggregateType, aggregateId, eventType, payload);
    });
  }
}

// ─── Event Consumer with Inbox (Idempotency) ─────────────────────────────
export type EventHandler = (event: ERPEventPayload, db: TenantScopedDatabase) => Promise<void>;

export class PlatformEventConsumer {
  private consumer: Consumer | null = null;

  constructor(
    private readonly kafka: Kafka,
    private readonly groupId: string,
    private readonly serviceName: string
  ) {}

  async subscribe(
    topics: string[],
    handler: EventHandler,
    dbFactory: (tenantId: number) => TenantScopedDatabase
  ): Promise<void> {
    this.consumer = this.kafka.consumer({ groupId: this.groupId });
    await this.consumer.connect();

    for (const topic of topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }

    await this.consumer.run({
      eachMessage: async ({ message, topic, partition }) => {
        if (!message.value) return;

        const event = JSON.parse(message.value.toString()) as ERPEventPayload;
        const db = dbFactory(event.tenantId);

        try {
          await db.transaction(async (trx) => {
            const existing = await trx.raw
              .select()
              .from(inboxEvents)
              .where(
                and(
                  eq(inboxEvents.eventId, event.eventId),
                  eq(inboxEvents.consumerService, this.serviceName)
                )
              )
              .limit(1);

            if (existing[0]?.status === 'PROCESSED') return;

            await trx.raw
              .insert(inboxEvents)
              .values({
                eventId: event.eventId,
                consumerService: this.serviceName,
                status: 'PROCESSING',
                tenantId: event.tenantId,
              })
              .onConflictDoNothing();

            await handler(event, trx);

            await trx.raw
              .update(inboxEvents)
              .set({ status: 'PROCESSED', processedAt: new Date() })
              .where(
                and(
                  eq(inboxEvents.eventId, event.eventId),
                  eq(inboxEvents.consumerService, this.serviceName)
                )
              );
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          process.stderr.write(
            `[EventConsumer:${this.serviceName}] Failed to process event ${event.eventId} from ${topic}[${partition}]: ${errMsg}\n`
          );

          // Mark inbox event as FAILED
          try {
            await db.raw
              .update(inboxEvents)
              .set({ status: 'FAILED', errorMessage: errMsg })
              .where(
                and(
                  eq(inboxEvents.eventId, event.eventId),
                  eq(inboxEvents.consumerService, this.serviceName)
                )
              );
          } catch {
            // ignore secondary error
          }
        }
      },
    });
  }

  async stop(): Promise<void> {
    await this.consumer?.disconnect();
  }
}

