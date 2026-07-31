import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { ErpDatabase } from '@erp/db';
import { notificationLog, outboxEvents } from '@erp/db';
import { createLogger } from '@erp/logger';
import { ChannelRegistry } from './channels/ChannelRegistry.js';
import type { ChannelDeliveryParams, ChannelName } from './channels/types.js';
import type { NotificationServiceConfig } from '../config.js';

const logger = createLogger({ serviceName: 'notification-service' });

const QUEUE_NAME = 'notification-delivery';
// Same 3-attempts/exponential-backoff shape the old inline deliverWithRetry() used
// (Math.pow(2, attempt) * 1000 for attempts 1 and 2 → ~2s then ~4s) — this just moves the same
// retry policy off the request thread and onto a durable, non-blocking BullMQ job.
const ATTEMPTS = 3;
const BACKOFF_DELAY_MS = 2000;

export interface DeliveryJobData {
  logId: number;
  tenantId: number;
  channel: ChannelName;
  params: ChannelDeliveryParams;
}

/** Narrow interface NotificationEngine depends on — lets tests inject a plain mock instead of a real BullMQ queue. */
export interface DeliveryEnqueuer {
  enqueue(data: DeliveryJobData): Promise<void>;
}

// Architectural change (2026-07-23, notification-service audit — architectural tier item 1):
// previously every send blocked the HTTP request for up to ~7s of exponential backoff across 3
// synchronous delivery attempts. This queue moves the actual provider call (and all retries) off
// the request thread: NotificationEngine now only validates/dedupes/inserts a PENDING row and
// enqueues a job, returning immediately. This worker processes it, updates notification_log to
// SENT or (after all attempts, terminally) FAILED, and publishes NOTIFICATION_DELIVERY_UPDATED to
// the outbox — the same event type/shape the provider delivery-status webhooks already publish
// (see webhook.routes.ts's applyDeliveryUpdate), so any consumer already listening for that event
// (e.g. sales-service's NotificationDeliveryConsumer, for campaign recipient status) now also
// learns the *initial* send outcome, not just the later provider-confirmed DELIVERED/FAILED.
export class DeliveryQueue implements DeliveryEnqueuer {
  private readonly queue: Queue<DeliveryJobData>;
  private readonly worker: Worker<DeliveryJobData>;
  private readonly channels: ChannelRegistry;

  constructor(
    redis: Redis,
    private readonly db: ErpDatabase,
    config: NotificationServiceConfig
  ) {
    this.channels = new ChannelRegistry(config);

    // Same connection-sharing convention as scheduler-service's JobRegistry (one ioredis
    // connection, already configured with maxRetriesPerRequest: null for BullMQ, reused for both
    // Queue and Worker) rather than opening a second Redis connection just for this queue.
    this.queue = new Queue<DeliveryJobData>(QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
        attempts: ATTEMPTS,
        backoff: { type: 'exponential', delay: BACKOFF_DELAY_MS },
      },
    });

    this.worker = new Worker<DeliveryJobData>(QUEUE_NAME, (job) => this.process(job), {
      connection: redis,
      concurrency: 5,
    });

    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const totalAttempts = job.opts.attempts ?? ATTEMPTS;
      if (job.attemptsMade >= totalAttempts) {
        // Final attempt exhausted — no more BullMQ-scheduled retries will happen for this job.
        void this.markTerminal(job.data, err.message);
      } else {
        logger.warn(
          { logId: job.data.logId, attempt: job.attemptsMade, err: err.message },
          'Notification delivery attempt failed, retrying'
        );
      }
    });
  }

  async enqueue(data: DeliveryJobData): Promise<void> {
    await this.queue.add('deliver', data);
  }

  private async process(job: Job<DeliveryJobData>): Promise<void> {
    const { logId, tenantId, channel, params } = job.data;
    try {
      const { externalId } = await this.channels.get(channel).send(params);

      await this.db
        .update(notificationLog)
        .set({
          status: 'SENT',
          externalMessageId: externalId,
          attemptCount: job.attemptsMade + 1,
          lastAttemptAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(notificationLog.id, logId));

      await this.publishDeliveryEvent(tenantId, logId, 'SENT', null);
    } catch (err) {
      await this.db
        .update(notificationLog)
        .set({
          attemptCount: job.attemptsMade + 1,
          lastAttemptAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(notificationLog.id, logId));
      throw err;
    }
  }

  private async markTerminal(data: DeliveryJobData, errorMessage: string): Promise<void> {
    await this.db
      .update(notificationLog)
      .set({ status: 'FAILED', errorMessage, updatedAt: new Date() })
      .where(eq(notificationLog.id, data.logId));

    await this.publishDeliveryEvent(data.tenantId, data.logId, 'FAILED', errorMessage);
  }

  private async publishDeliveryEvent(
    tenantId: number,
    notificationLogId: number,
    status: 'SENT' | 'FAILED',
    errorMessage: string | null
  ): Promise<void> {
    // Same direct-outbox-insert pattern webhook.routes.ts's applyDeliveryUpdate already uses.
    await this.db.insert(outboxEvents).values({
      eventId: ulid(),
      eventType: 'NOTIFICATION_DELIVERY_UPDATED',
      aggregateType: 'notification_log',
      aggregateId: notificationLogId,
      tenantId,
      payload: { notificationLogId, status, errorMessage },
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}
