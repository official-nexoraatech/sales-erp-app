/* global setTimeout */
// CP-8 (Campaign Management Platform initiative): poll-loop dispatcher for
// campaign_webhook_deliveries, structurally modeled on event-service's OutboxRelayWorker
// (SELECT ... FOR UPDATE SKIP LOCKED inside a short transaction, outbound I/O happens after the
// transaction commits so a slow/unreachable third party never holds a DB lock or blocks
// campaign-send). Deliveries are enqueued synchronously by CampaignService — this worker is the
// only thing that ever performs the actual outbound HTTP call.
import { sql } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { createLogger } from '@erp/logger';
import { deliverWebhook } from './WebhookDispatchService.js';

const logger = createLogger({ serviceName: 'sales-service' });

interface DeliveryRow {
  id: number;
  event_type: string;
  campaign_id: number;
  payload: Record<string, unknown>;
  attempt_count: number;
  target_url: string;
  secret: string;
}

export interface WebhookDispatchWorkerConfig {
  db: ErpDatabase;
  pollIntervalMs?: number;
  batchSize?: number;
  maxAttempts?: number;
}

export class WebhookDispatchWorker {
  private running = false;
  private currentBatch: Promise<void> | null = null;

  private readonly db: ErpDatabase;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;

  constructor(config: WebhookDispatchWorkerConfig) {
    this.db = config.db;
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.batchSize = config.batchSize ?? 25;
    this.maxAttempts = config.maxAttempts ?? 5;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.pollLoop();
    logger.info(
      { pollIntervalMs: this.pollIntervalMs, batchSize: this.batchSize },
      'WebhookDispatchWorker started'
    );
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      const batch = this.processBatch().catch((err: unknown) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'WebhookDispatchWorker: unhandled batch error'
        );
      });
      this.currentBatch = batch;
      await batch;
      this.currentBatch = null;
      if (this.running) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }
    }
    logger.info({}, 'WebhookDispatchWorker stopped gracefully');
  }

  private async processBatch(): Promise<void> {
    let rows: DeliveryRow[];
    try {
      rows = await this.db.transaction(async (trx) => {
        const result = await trx.execute(sql`
          SELECT d.id, d.event_type, d.campaign_id, d.payload, d.attempt_count,
                 s.target_url, s.secret
          FROM campaign_webhook_deliveries d
          JOIN campaign_webhook_subscriptions s ON s.id = d.subscription_id
          WHERE d.status = 'PENDING'
          ORDER BY d.created_at
          LIMIT ${this.batchSize}
          FOR UPDATE OF d SKIP LOCKED
        `);
        return result as unknown as DeliveryRow[];
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'WebhookDispatchWorker: failed to fetch batch'
      );
      return;
    }

    for (const row of rows) {
      const outcome = await deliverWebhook({
        targetUrl: row.target_url,
        secret: row.secret,
        eventType: row.event_type,
        campaignId: row.campaign_id,
        payload: row.payload,
      });

      try {
        if (outcome.success) {
          await this.db.execute(sql`
            UPDATE campaign_webhook_deliveries
            SET status = 'SENT', attempt_count = ${row.attempt_count + 1}, sent_at = NOW(), last_error = NULL
            WHERE id = ${row.id}
          `);
        } else {
          const nextAttempt = row.attempt_count + 1;
          const errMsg = outcome.error ?? `HTTP ${outcome.httpStatus ?? 'error'}`;
          if (nextAttempt >= this.maxAttempts) {
            await this.db.execute(sql`
              UPDATE campaign_webhook_deliveries
              SET status = 'FAILED', attempt_count = ${nextAttempt}, last_error = ${errMsg}
              WHERE id = ${row.id}
            `);
            logger.error(
              { deliveryId: row.id, eventType: row.event_type, attempts: nextAttempt, err: errMsg },
              'Webhook delivery dead-lettered after max attempts'
            );
          } else {
            await this.db.execute(sql`
              UPDATE campaign_webhook_deliveries
              SET attempt_count = ${nextAttempt}, last_error = ${errMsg}
              WHERE id = ${row.id}
            `);
            logger.warn(
              { deliveryId: row.id, eventType: row.event_type, attempt: nextAttempt, err: errMsg },
              'Webhook delivery failed — will retry'
            );
          }
        }
      } catch (updateErr) {
        logger.error(
          {
            deliveryId: row.id,
            err: updateErr instanceof Error ? updateErr.message : String(updateErr),
          },
          'WebhookDispatchWorker: failed to update delivery state'
        );
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.running && !this.currentBatch) return;
    this.running = false;
    if (this.currentBatch) {
      await this.currentBatch;
    }
  }
}
