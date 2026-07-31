import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  createLogger,
  erpJobExecutionTotal,
  erpJobDurationSeconds,
  erpJobLastSuccessTimestamp,
} from '@erp/logger';
import type { ErpDatabase } from '@erp/db';
import { jobHistory } from '@erp/db';
import { eq } from 'drizzle-orm';

const logger = createLogger({ serviceName: 'scheduler-service' });

export interface JobConfig {
  cron: string;
  description: string;
  tenantScoped: boolean;
  timeout?: number;
  // Rebuild-on-demand jobs (e.g. projection rebuild — PG-008) have no meaningful
  // cron; register() still creates their Worker, but main.ts's startup loop must
  // skip calling schedule() for them so they don't get a recurring BullMQ repeat job.
  manualOnly?: boolean;
}

export type JobHandler = (job: Job, tenantId?: number) => Promise<void>;

export interface RegisteredJob {
  name: string;
  config: JobConfig;
  handler: JobHandler;
  queue: Queue;
  worker: Worker;
}

const JOB_KEY_PREFIX = 'erp:scheduler';

export class JobRegistry {
  private readonly jobs = new Map<string, RegisteredJob>();
  private readonly queueOpts: { connection: Redis };

  constructor(
    private readonly redis: Redis,
    private readonly db: ErpDatabase
  ) {
    this.queueOpts = { connection: redis };
  }

  // job_history has full RUNNING/COMPLETED/FAILED/SKIPPED lifecycle columns (duration,
  // errorMessage, triggeredBy) and a whole API (GET /jobs, /jobs/:name/history) built on top
  // of it, but until now nothing ever wrote a row here for an actual cron-triggered run —
  // only the manual-trigger route inserted one, and even that was never updated past RUNNING.
  // Every one of this service's 44 registered jobs was invisible to its own history API.
  // Best-effort by design: a DB hiccup while recording history must never block or fail the
  // job itself, matching this file's existing non-fatal-logging posture elsewhere.
  private async startHistory(
    name: string,
    cron: string,
    tenantId: number | undefined,
    triggeredBy: 'CRON' | 'MANUAL',
    triggeredByUserId: number | undefined
  ): Promise<number | undefined> {
    try {
      const [row] = await this.db
        .insert(jobHistory)
        .values({
          tenantId: tenantId ?? 0,
          jobName: name,
          cronExpression: cron,
          status: 'RUNNING',
          triggeredBy,
          triggeredByUserId,
          startedAt: new Date(),
          createdBy: triggeredByUserId ?? 0,
        })
        .returning({ id: jobHistory.id });
      return row?.id;
    } catch (err) {
      logger.warn({ name, err }, 'Failed to record job history start (non-fatal)');
      return undefined;
    }
  }

  private async recordSkipped(
    name: string,
    cron: string,
    tenantId: number | undefined,
    triggeredBy: 'CRON' | 'MANUAL',
    triggeredByUserId: number | undefined
  ): Promise<void> {
    try {
      await this.db.insert(jobHistory).values({
        tenantId: tenantId ?? 0,
        jobName: name,
        cronExpression: cron,
        status: 'SKIPPED',
        triggeredBy,
        triggeredByUserId,
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
        errorMessage: 'Skipped — already running on another pod',
        createdBy: triggeredByUserId ?? 0,
      });
    } catch (err) {
      logger.warn({ name, err }, 'Failed to record skipped job history (non-fatal)');
    }
  }

  private async completeHistory(
    historyId: number | undefined,
    status: 'COMPLETED' | 'FAILED',
    durationMs: number,
    errorMessage?: string
  ): Promise<void> {
    if (historyId === undefined) return;
    try {
      await this.db
        .update(jobHistory)
        .set({
          status,
          completedAt: new Date(),
          durationMs,
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(jobHistory.id, historyId));
    } catch (err) {
      logger.warn({ historyId, err }, 'Failed to record job history completion (non-fatal)');
    }
  }

  register(name: string, config: JobConfig, handler: JobHandler): void {
    if (this.jobs.has(name)) {
      logger.warn({ name }, 'Job already registered — skipping duplicate');
      return;
    }

    const queue = new Queue(name, {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: { count: 30 },
        removeOnFail: { count: 30 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    });

    const worker = new Worker(
      name,
      async (job: Job) => {
        const tenantId = job.data?.tenantId as number | undefined;
        const isManual = job.data?.manual === true;
        const triggeredByUserId = job.data?.triggeredByUserId as number | undefined;
        const lockKey = tenantId
          ? `${JOB_KEY_PREFIX}:lock:${name}:${tenantId}`
          : `${JOB_KEY_PREFIX}:lock:${name}`;

        // Distributed lock: prevents duplicate runs across pods
        const acquired = await this.redis.set(lockKey, '1', 'EX', 300, 'NX');
        if (!acquired) {
          logger.warn({ name, tenantId }, 'Job skipped — already running on another pod');
          erpJobExecutionTotal.inc({ job_name: name, status: 'skipped' });
          await this.recordSkipped(
            name,
            config.cron,
            tenantId,
            isManual ? 'MANUAL' : 'CRON',
            triggeredByUserId
          );
          return;
        }

        const start = Date.now();
        const historyId = await this.startHistory(
          name,
          config.cron,
          tenantId,
          isManual ? 'MANUAL' : 'CRON',
          triggeredByUserId
        );
        try {
          await handler(job, tenantId);
          const durationMs = Date.now() - start;
          logger.info({ name, tenantId, durationMs }, 'Job completed');
          erpJobExecutionTotal.inc({ job_name: name, status: 'completed' });
          erpJobDurationSeconds.observe({ job_name: name }, durationMs / 1000);
          erpJobLastSuccessTimestamp.set({ job_name: name }, Date.now() / 1000);
          await this.completeHistory(historyId, 'COMPLETED', durationMs);
        } catch (err) {
          const durationMs = Date.now() - start;
          const errMsg = err instanceof Error ? err.message : String(err);
          erpJobExecutionTotal.inc({ job_name: name, status: 'failed' });
          erpJobDurationSeconds.observe({ job_name: name }, durationMs / 1000);
          await this.completeHistory(historyId, 'FAILED', durationMs, errMsg);
          throw err;
        } finally {
          await this.redis.del(lockKey);
        }
      },
      {
        connection: this.redis,
        concurrency: 2,
      }
    );

    worker.on('failed', (job, err) => {
      logger.error({ name, jobId: job?.id, err: err.message }, 'Job failed');
    });

    this.jobs.set(name, { name, config, handler, queue, worker });
    logger.info({ name, cron: config.cron }, 'Job registered');
  }

  async schedule(name: string, tenantId?: number): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);

    // BullMQ dedupes repeatable jobs on (name, repeat options, jobId) — without a
    // per-tenant jobId here, scheduling the same tenantScoped job for multiple
    // tenants would collapse into a single repeatable entry instead of one per tenant.
    const jobId = tenantId !== undefined ? `${name}:${tenantId}` : name;

    await job.queue.add(name, { tenantId }, { repeat: { pattern: job.config.cron }, jobId });
  }

  async triggerManual(
    name: string,
    tenantId?: number,
    data?: Record<string, unknown>
  ): Promise<string> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);

    const added = await job.queue.add(
      name,
      { tenantId, manual: true, ...data },
      {
        priority: 1,
      }
    );
    return added.id ?? 'unknown';
  }

  async pause(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);
    await job.queue.pause();
  }

  async resume(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);
    await job.queue.resume();
  }

  async getStatus(name: string): Promise<{
    name: string;
    isPaused: boolean;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    cron: string;
    description: string;
  }> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);

    const [waiting, active, completed, failed, isPaused] = await Promise.all([
      job.queue.getWaitingCount(),
      job.queue.getActiveCount(),
      job.queue.getCompletedCount(),
      job.queue.getFailedCount(),
      job.queue.isPaused(),
    ]);

    return {
      name,
      cron: job.config.cron,
      description: job.config.description,
      isPaused,
      waiting,
      active,
      completed,
      failed,
    };
  }

  listAll(): Array<{ name: string; config: JobConfig }> {
    return Array.from(this.jobs.entries()).map(([name, j]) => ({
      name,
      config: j.config,
    }));
  }

  async closeAll(): Promise<void> {
    for (const { worker, queue } of this.jobs.values()) {
      await worker.close();
      await queue.close();
    }
  }
}
