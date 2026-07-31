/**
 * PG-026 — schedule(name, tenantId) must give each tenant's repeatable job a distinct
 * BullMQ jobId. Without one, BullMQ dedupes repeatable jobs on (name, repeat options,
 * jobId) — scheduling the same tenantScoped job for multiple tenants would collapse into
 * a single repeatable entry instead of one per tenant, silently dropping every tenant but
 * the last one scheduled.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const addMock = vi.fn(() => Promise.resolve({}));
let capturedWorkerCallback: ((job: unknown) => Promise<void>) | undefined;

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: addMock, close: vi.fn() })),
  Worker: vi.fn().mockImplementation((_name: string, cb: (job: unknown) => Promise<void>) => {
    capturedWorkerCallback = cb;
    return { on: vi.fn(), close: vi.fn() };
  }),
}));

import { JobRegistry } from '../JobRegistry.js';

afterEach(() => {
  vi.clearAllMocks();
  capturedWorkerCallback = undefined;
});

function makeRedisMock(): { set: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> } {
  return {
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
}

function makeDbMock(): {
  db: unknown;
  insertedRows: Record<string, unknown>[];
  updatedRows: Record<string, unknown>[];
} {
  const insertedRows: Record<string, unknown>[] = [];
  const updatedRows: Record<string, unknown>[] = [];
  const db = {
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        insertedRows.push(v);
        // Must double as a plain awaitable (recordSkipped doesn't chain .returning()) AND
        // support .returning() (startHistory does) — a Promise with the method attached
        // satisfies both call shapes.
        const thenable = Promise.resolve(undefined) as Promise<undefined> & {
          returning: ReturnType<typeof vi.fn>;
        };
        thenable.returning = vi.fn(() => Promise.resolve([{ id: insertedRows.length }]));
        return thenable;
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => ({
        where: vi.fn(() => {
          updatedRows.push(v);
          return Promise.resolve();
        }),
      })),
    })),
  };
  return { db, insertedRows, updatedRows };
}

describe('JobRegistry.schedule', () => {
  it('gives each tenant a distinct jobId so repeatable jobs do not collide across tenants', async () => {
    const registry = new JobRegistry({} as never, {} as never);
    registry.register(
      'test.job',
      { cron: '0 0 * * *', description: 'test', tenantScoped: true },
      async () => undefined
    );

    await registry.schedule('test.job', 1);
    await registry.schedule('test.job', 2);

    expect(addMock).toHaveBeenCalledTimes(2);
    const [, , firstOpts] = addMock.mock.calls[0] as [string, unknown, { jobId?: string }];
    const [, , secondOpts] = addMock.mock.calls[1] as [string, unknown, { jobId?: string }];
    expect(firstOpts.jobId).toBe('test.job:1');
    expect(secondOpts.jobId).toBe('test.job:2');
    expect(firstOpts.jobId).not.toBe(secondOpts.jobId);
  });

  it('uses the bare job name as jobId for non-tenant-scoped jobs', async () => {
    const registry = new JobRegistry({} as never, {} as never);
    registry.register(
      'test.global-job',
      { cron: '0 0 * * *', description: 'test', tenantScoped: false },
      async () => undefined
    );

    await registry.schedule('test.global-job');

    const [, , opts] = addMock.mock.calls[0] as [string, unknown, { jobId?: string }];
    expect(opts.jobId).toBe('test.global-job');
  });
});

// job_history has a full RUNNING/COMPLETED/FAILED/SKIPPED lifecycle, but until now nothing
// ever wrote a row for an actual cron-triggered run — only the manual-trigger route inserted
// one, and even that was never updated past RUNNING. These tests cover the worker's own
// recording, independent of the route.
describe('JobRegistry — job_history recording', () => {
  it('records RUNNING then COMPLETED for a successful cron run', async () => {
    const redis = makeRedisMock();
    const { db, insertedRows, updatedRows } = makeDbMock();
    const registry = new JobRegistry(redis as never, db as never);
    registry.register(
      'test.history-job',
      { cron: '0 0 * * *', description: 'test', tenantScoped: false },
      async () => undefined
    );

    await capturedWorkerCallback!({ data: {} });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      jobName: 'test.history-job',
      status: 'RUNNING',
      triggeredBy: 'CRON',
      tenantId: 0,
    });
    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]).toMatchObject({ status: 'COMPLETED' });
  });

  it('records FAILED with the error message when the handler throws, and still rethrows so BullMQ retries', async () => {
    const redis = makeRedisMock();
    const { db, updatedRows } = makeDbMock();
    const registry = new JobRegistry(redis as never, db as never);
    registry.register(
      'test.failing-job',
      { cron: '0 0 * * *', description: 'test', tenantScoped: false },
      async () => {
        throw new Error('boom');
      }
    );

    await expect(capturedWorkerCallback!({ data: {} })).rejects.toThrow('boom');

    expect(updatedRows).toHaveLength(1);
    expect(updatedRows[0]).toMatchObject({ status: 'FAILED', errorMessage: 'boom' });
    expect(redis.del).toHaveBeenCalled();
  });

  it('records SKIPPED and never invokes the handler when the distributed lock is already held', async () => {
    const redis = { set: vi.fn().mockResolvedValue(null), del: vi.fn() };
    const { db, insertedRows } = makeDbMock();
    const handler = vi.fn(async () => undefined);
    const registry = new JobRegistry(redis as never, db as never);
    registry.register(
      'test.locked-job',
      { cron: '0 0 * * *', description: 'test', tenantScoped: false },
      handler
    );

    await capturedWorkerCallback!({ data: {} });

    expect(handler).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ status: 'SKIPPED' });
  });

  it('attributes MANUAL trigger and triggeredByUserId from job.data', async () => {
    const redis = makeRedisMock();
    const { db, insertedRows } = makeDbMock();
    const registry = new JobRegistry(redis as never, db as never);
    registry.register(
      'test.manual-job',
      { cron: '0 0 * * *', description: 'test', tenantScoped: true },
      async () => undefined
    );

    await capturedWorkerCallback!({ data: { tenantId: 5, manual: true, triggeredByUserId: 42 } });

    expect(insertedRows[0]).toMatchObject({
      tenantId: 5,
      triggeredBy: 'MANUAL',
      triggeredByUserId: 42,
    });
  });
});
