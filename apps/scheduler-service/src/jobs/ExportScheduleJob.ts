/* global Buffer */
import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { ErpDatabase } from '@erp/db';
import { exportSchedules, exportRunHistory } from '@erp/db';
import type { StorageClient } from '@erp/sdk';
import { withTenantConnection } from '@erp/sdk';
import { createLogger } from '@erp/logger';
import { ExportEngine, type ExportEntity } from '../domain/ExportEngine.js';
import { ExportFormatter } from '../domain/ExportFormatter.js';

const logger = createLogger({ serviceName: 'scheduler-service' });

const QUEUE_NAME = 'export-schedule-run';
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * CRM-ROADMAP Phase 4, Feature 8 — Public CRM API & BI/Data-Warehouse Export.
 *
 * Recurring, user-configured export dispatch — the same "user-defined cron per row" shape as
 * report-service's ScheduledReportJob/reportSchedules, but built on this service's own already-
 * present BullMQ + Redis infrastructure (a Queue's repeatable-job mechanism) rather than adding
 * croner as a new dependency: BullMQ already dedupes a repeatable job by (name, jobId) across
 * every replica, which is exactly the "only one replica actually dispatches a given schedule per
 * tick" guarantee ScheduledReportJob has to implement by hand with its own Redis lock.
 *
 * Deliberately its own self-contained Queue/Worker pair rather than going through the shared
 * JobRegistry (jobs registered there assume one fixed cron per job NAME, known at startup — not
 * N independently-configured cron expressions, one per user-created schedule row, added/removed
 * at runtime).
 */
export class ExportScheduleJob {
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly formatter: ExportFormatter;
  // scheduleId -> cron pattern currently registered as a BullMQ repeatable job, so a sync tick
  // can detect a changed/removed schedule and re-register rather than accumulate stale entries.
  private readonly registered = new Map<number, string>();
  private syncTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly db: ErpDatabase,
    redis: Redis,
    private readonly storage: StorageClient
  ) {
    this.formatter = new ExportFormatter();
    this.queue = new Queue(QUEUE_NAME, { connection: redis });
    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job) => {
        await this.runSchedule((job.data as { scheduleId: number }).scheduleId);
      },
      { connection: redis, concurrency: 2 }
    );
    this.worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, err: err.message }, 'Export schedule run failed');
    });
  }

  async start(): Promise<void> {
    await this.syncSchedules();
    this.syncTimer = setInterval(() => {
      void this.syncSchedules();
    }, SYNC_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.syncTimer) clearInterval(this.syncTimer);
    await this.worker.close();
    await this.queue.close();
  }

  // RLS-readiness note (2026-08-22): genuinely cross-tenant by design — must see every
  // tenant's active schedules in one pass to (re)register BullMQ repeatables, and does no
  // further per-schedule Postgres work in its own loop body (only queue.add/removeRepeatable,
  // no DB). Deliberately left unwrapped, same category as other cross-tenant admin-style reads
  // already accepted elsewhere in this rollout (e.g. tenant-service's GET /admin/tenants).
  private async syncSchedules(): Promise<void> {
    const active = await this.db
      .select()
      .from(exportSchedules)
      .where(eq(exportSchedules.active, 1));
    const activeIds = new Map(active.map((s) => [s.id, s]));

    for (const [id, cron] of this.registered) {
      const current = activeIds.get(id);
      if (!current || current.cronExpression !== cron) {
        await this.queue
          .removeRepeatable(QUEUE_NAME, { pattern: cron }, `schedule:${id}`)
          .catch((err: unknown) =>
            logger.warn(
              { scheduleId: id, err },
              'Failed to remove stale export schedule (non-fatal)'
            )
          );
        this.registered.delete(id);
      }
    }

    for (const schedule of active) {
      if (this.registered.has(schedule.id)) continue;
      try {
        await this.queue.add(
          QUEUE_NAME,
          { scheduleId: schedule.id },
          { repeat: { pattern: schedule.cronExpression }, jobId: `schedule:${schedule.id}` }
        );
        this.registered.set(schedule.id, schedule.cronExpression);
        logger.info(
          { scheduleId: schedule.id, cron: schedule.cronExpression },
          'Export schedule registered'
        );
      } catch (err) {
        logger.error({ scheduleId: schedule.id, err }, 'Failed to register export schedule');
      }
    }
  }

  // RLS-readiness follow-up (2026-08-22): the initial lookup-by-scheduleId can't be
  // tenant-scoped — the tenantId isn't known until this row is read (caveat 4f, same shape as
  // notification-service's webhook routes resolving tenant by externalMessageId). Once
  // schedule.tenantId is known, every subsequent DB call gets its own withTenantConnection
  // wrap; the MinIO upload is real external I/O and stays outside any transaction (caveat 4g).
  private async runSchedule(scheduleId: number): Promise<void> {
    const [schedule] = await this.db
      .select()
      .from(exportSchedules)
      .where(eq(exportSchedules.id, scheduleId));
    if (!schedule || schedule.active !== 1) {
      logger.info({ scheduleId }, 'Export schedule run skipped — schedule inactive or deleted');
      return;
    }
    const tenantId = schedule.tenantId;

    const startTime = Date.now();
    const [run] = await withTenantConnection(this.db, tenantId, (scopedDb) =>
      scopedDb
        .insert(exportRunHistory)
        .values({
          tenantId,
          scheduleId: schedule.id,
          entityType: schedule.entityType,
          format: schedule.format,
          status: 'RUNNING',
          startedAt: new Date(),
        })
        .returning()
    );

    try {
      const { columns, rows, totalRows } = await withTenantConnection(
        this.db,
        tenantId,
        (scopedDb) =>
          new ExportEngine(scopedDb).query(
            tenantId,
            schedule.entityType as ExportEntity,
            schedule.filters as Record<string, unknown>
          )
      );
      const buffer =
        schedule.format === 'XLSX'
          ? this.formatter.toExcel(schedule.entityType, columns, rows)
          : Buffer.from(this.formatter.toCSV(columns, rows), 'utf-8');

      const fileName = this.formatter.getFileName(schedule.entityType, schedule.format);
      const mimeType = this.formatter.getContentType(schedule.format);
      const objectKey = await this.storage.uploadFile(
        tenantId,
        'export-schedules',
        fileName,
        buffer,
        mimeType
      );
      const signedUrl = await this.storage.getSignedUrl(objectKey, 7 * 24 * 60 * 60);

      await withTenantConnection(this.db, tenantId, (scopedDb) =>
        scopedDb
          .update(exportRunHistory)
          .set({
            status: 'COMPLETED',
            completedAt: new Date(),
            fileUrl: signedUrl,
            rowCount: totalRows,
            durationMs: Date.now() - startTime,
          })
          .where(eq(exportRunHistory.id, run!.id))
      );

      logger.info({ scheduleId, tenantId, totalRows }, 'Export schedule run completed');
      await this.notifyRecipients(schedule, signedUrl, totalRows);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await withTenantConnection(this.db, tenantId, (scopedDb) =>
        scopedDb
          .update(exportRunHistory)
          .set({
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage,
            durationMs: Date.now() - startTime,
          })
          .where(eq(exportRunHistory.id, run!.id))
      );
      logger.error({ scheduleId, err: errorMessage }, 'Export schedule run failed');
    }
  }

  // Reuses the existing internal-route notification pattern (system-jobs.ts's
  // send-raw-internal calls) rather than adding a raw SMTP client as a new dependency —
  // scheduler-service already talks to notification-service this way for every other
  // job-completion notification it sends.
  private async notifyRecipients(
    schedule: typeof exportSchedules.$inferSelect,
    signedUrl: string,
    totalRows: number
  ): Promise<void> {
    const recipients = schedule.recipients as string[];
    if (!recipients || recipients.length === 0) return;

    const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
    const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
    for (const recipientEmail of recipients) {
      try {
        await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          body: JSON.stringify({
            tenantId: schedule.tenantId,
            eventType: 'EXPORT_SCHEDULE_READY',
            channel: 'EMAIL',
            recipientEmail,
            subject: `Your scheduled ${schedule.entityType} export is ready`,
            body: `Your scheduled ${schedule.entityType} export (${totalRows} rows) is ready: ${signedUrl}\n\nThis link expires in 7 days.`,
          }),
        });
      } catch (err) {
        logger.warn(
          { scheduleId: schedule.id, recipientEmail, err },
          'Export schedule email delivery failed for one recipient (non-fatal)'
        );
      }
    }
  }
}
