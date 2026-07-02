import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'scheduler-service' });

export interface JobConfig {
  cron: string;
  description: string;
  tenantScoped: boolean;
  timeout?: number;
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

  constructor(private readonly redis: Redis) {
    this.queueOpts = { connection: redis };
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
        const lockKey = tenantId
          ? `${JOB_KEY_PREFIX}:lock:${name}:${tenantId}`
          : `${JOB_KEY_PREFIX}:lock:${name}`;

        // Distributed lock: prevents duplicate runs across pods
        const acquired = await this.redis.set(lockKey, '1', 'EX', 300, 'NX');
        if (!acquired) {
          logger.warn({ name, tenantId }, 'Job skipped — already running on another pod');
          return;
        }

        const start = Date.now();
        try {
          await handler(job, tenantId);
          logger.info({ name, tenantId, durationMs: Date.now() - start }, 'Job completed');
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

    await job.queue.add(
      name,
      { tenantId },
      { repeat: { pattern: job.config.cron } }
    );
  }

  async triggerManual(name: string, tenantId?: number): Promise<string> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);

    const added = await job.queue.add(name, { tenantId, manual: true }, {
      priority: 1,
    });
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
