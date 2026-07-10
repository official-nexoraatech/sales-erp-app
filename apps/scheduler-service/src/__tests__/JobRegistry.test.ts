/**
 * PG-026 — schedule(name, tenantId) must give each tenant's repeatable job a distinct
 * BullMQ jobId. Without one, BullMQ dedupes repeatable jobs on (name, repeat options,
 * jobId) — scheduling the same tenantScoped job for multiple tenants would collapse into
 * a single repeatable entry instead of one per tenant, silently dropping every tenant but
 * the last one scheduled.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const addMock = vi.fn(() => Promise.resolve({}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: addMock, close: vi.fn() })),
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn(), close: vi.fn() })),
}));

import { JobRegistry } from '../JobRegistry.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('JobRegistry.schedule', () => {
  it('gives each tenant a distinct jobId so repeatable jobs do not collide across tenants', async () => {
    const registry = new JobRegistry({} as never);
    registry.register('test.job', { cron: '0 0 * * *', description: 'test', tenantScoped: true }, async () => undefined);

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
    const registry = new JobRegistry({} as never);
    registry.register('test.global-job', { cron: '0 0 * * *', description: 'test', tenantScoped: false }, async () => undefined);

    await registry.schedule('test.global-job');

    const [, , opts] = addMock.mock.calls[0] as [string, unknown, { jobId?: string }];
    expect(opts.jobId).toBe('test.global-job');
  });
});
