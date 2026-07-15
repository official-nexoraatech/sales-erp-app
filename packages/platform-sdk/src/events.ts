import { type Kafka, type Consumer } from 'kafkajs';
import { ulid } from 'ulid';
import { inboxEvents } from '@erp/db';
import { and, eq, sql } from 'drizzle-orm';
import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from './database.js';

export type { ERPEventPayload };

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
      const eventBus = new PlatformEventBus(trx, this.tenantId, this.userId, this.correlationId);
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

        // OutboxRelayWorker publishes the Kafka message VALUE as row.payload, with
        // eventId/eventType/tenantId carried in message HEADERS. But row.payload itself has
        // TWO possible shapes depending on which producer path wrote it:
        //   (a) a direct `insert(outboxEvents).values({..., payload: {flatFields...}})` —
        //       the majority pattern (sales/purchase/production-service) — value is flat
        //       business data with no envelope metadata at all.
        //   (b) `ctx.events.publish()` (PlatformEventBus, used by hr-service) — writes the
        //       FULL ERPEventPayload envelope (eventId/eventType/tenantId/userId/... AND a
        //       nested `payload` field) as the outbox row's payload column, so value is that
        //       whole envelope, doubly-nesting the real business fields one level deeper.
        // Originally this only handled (a): `event.payload = businessPayload` left path (b)'s
        // real fields buried at `businessPayload.payload.*` — confirmed live via psql: after
        // this fix landed, sales-service's direct-insert events (invoices/payments) posted
        // real journals, but hr-service's PAYROLL_RUN_APPROVED/DISBURSED silently posted zero
        // new journals across multiple full E2E runs (consumer read undefined totalNet/
        // payrollRunId off the un-unwrapped envelope and hit the "zero net amount" skip path
        // — no crash, no log noise, just permanently no-op). Detect the envelope shape via its
        // distinctive fields and unwrap before handing off to handlers.
        const parsed = JSON.parse(message.value.toString()) as Record<string, unknown>;
        const isEnveloped =
          typeof parsed['payload'] === 'object' &&
          parsed['payload'] !== null &&
          typeof parsed['schemaVersion'] !== 'undefined' &&
          typeof parsed['occurredAt'] !== 'undefined';
        const envelope = isEnveloped ? parsed : undefined;
        const businessPayload = isEnveloped
          ? (parsed['payload'] as Record<string, unknown>)
          : parsed;
        const header = (key: string): string | undefined => {
          const v = message.headers?.[key];
          return v === undefined ? undefined : v.toString();
        };
        const tenantIdRaw =
          header('tenantId') ??
          (envelope?.['tenantId'] as string | number | undefined) ??
          (businessPayload['tenantId'] as string | number | undefined);
        const tenantId = Number(tenantIdRaw);
        const event: ERPEventPayload = {
          eventId:
            header('eventId') ??
            (envelope?.['eventId'] as string | undefined) ??
            (businessPayload['eventId'] as string | undefined) ??
            `${topic}-${partition}-${message.offset}`,
          eventType:
            header('eventType') ??
            (envelope?.['eventType'] as string | undefined) ??
            (businessPayload['eventType'] as string | undefined) ??
            '',
          schemaVersion: 1,
          aggregateType: topic,
          aggregateId: Number(businessPayload['id'] ?? 0) || 0,
          tenantId,
          // Not recoverable from the current wire format for most event types on the flat
          // (a) path (not in headers, and the flat business payload rarely carries it) — 0
          // rather than a guessed value, so any consumer that genuinely needs it (e.g.
          // accounting's auto-journal posting, which attributes createdBy) fails loudly/
          // visibly instead of silently mis-attributing. The enveloped (b) path always has it.
          userId:
            Number(
              envelope?.['userId'] ?? businessPayload['userId'] ?? businessPayload['createdBy'] ?? 0
            ) || 0,
          correlationId: header('eventId') ?? '',
          causationId: header('eventId') ?? '',
          occurredAt: new Date().toISOString(),
          payload: businessPayload,
        };
        if (!tenantId || tenantId <= 0) {
          process.stderr.write(
            `[EventConsumer:${this.serviceName}] Dropping message with no resolvable tenantId on ${topic}[${partition}] offset ${message.offset}\n`
          );
          return;
        }
        const db = dbFactory(event.tenantId);

        try {
          await db.transaction(async (trx) => {
            // ES-24 [C7]: the insert/upsert's own .returning() IS the idempotency check —
            // if another transaction already claimed this eventId+consumerService and it's
            // PROCESSED, the conditional DO UPDATE's WHERE clause makes it a no-op and
            // returns zero rows, so THIS call skips the handler. A row left PROCESSING (a
            // prior attempt crashed mid-handler) or FAILED is still re-claimable — that's
            // the retry path. The old code checked PROCESSED status via a separate SELECT
            // before inserting, which raced: a second delivery could pass that check, have
            // its own insert silently no-op via onConflictDoNothing(), and still (wrongly)
            // run handler() regardless of who "won".
            const claimed = await trx.raw
              .insert(inboxEvents)
              .values({
                eventId: event.eventId,
                consumerService: this.serviceName,
                status: 'PROCESSING',
                tenantId: event.tenantId,
              })
              .onConflictDoUpdate({
                target: [inboxEvents.eventId, inboxEvents.consumerService],
                set: { status: 'PROCESSING' },
                setWhere: sql`${inboxEvents.status} != 'PROCESSED'`,
              })
              .returning({ id: inboxEvents.id });

            if (claimed.length === 0) return; // another delivery already owns/finished this event

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
