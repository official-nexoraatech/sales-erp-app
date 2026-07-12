import { describe, it, expect, vi } from 'vitest';

// Note: @erp/db's schema barrel (`export * from './report.js'` etc. in schema/index.ts) does not
// surface reportSchedules/reportRunHistory under vitest's module graph (a pre-existing test-environment
// resolution quirk, unrelated to ES-17 — direct imports of schema/report.ts work fine). Since
// ScheduledReportJob only uses these two objects as opaque column-reference holders passed into
// drizzle's real `eq()`, minimal stand-ins are sufficient here.
vi.mock('@erp/db', () => ({
  reportSchedules: { id: 'reportSchedules.id' },
  reportRunHistory: { id: 'reportRunHistory.id' },
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({ messageId: 'test' }) })),
  },
}));

import { ScheduledReportJob } from '../scheduler/ScheduledReportJob.js';

interface FakeSchedule {
  id: number;
  tenantId: number;
  reportSlug: string;
  params: Record<string, string>;
  format: 'CSV';
  cronExpression: string;
  recipients: string[];
  active: number;
  unsubscribeToken: string;
  createdBy: number;
}

function makeRedis() {
  const store = new Map<string, string>();
  return {
    set: vi.fn(async (key: string, value: string, _ex: string, _ttl: number, nx: string) => {
      if (nx === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
}

function makeDb(reportRows: unknown[]) {
  const insertedRows: Record<string, unknown>[] = [];
  const updatedRows: Record<string, unknown>[] = [];
  return {
    execute: vi.fn().mockResolvedValue(reportRows),
    insert: vi.fn(() => ({
      values: vi.fn((vals: Record<string, unknown>) => {
        insertedRows.push(vals);
        return { returning: vi.fn().mockResolvedValue([{ id: 99, ...vals }]) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        updatedRows.push(vals);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
    insertedRows,
    updatedRows,
  };
}

// Test 7: Report schedule created → runs on due date → report_run_history row created
describe('ES-17 — ScheduledReportJob.runSchedule', () => {
  it('creates a RUNNING report_run_history row, executes the report and marks it COMPLETED', async () => {
    const db = makeDb([
      { gender: 'MALE', headcount: 5 },
      { gender: 'FEMALE', headcount: 3 },
    ]);
    const logger = { info: vi.fn(), error: vi.fn() };
    const job = new ScheduledReportJob(db as never, logger, makeRedis() as never);

    const schedule: FakeSchedule = {
      id: 42,
      tenantId: 1,
      reportSlug: 'hr-gender-diversity',
      params: {},
      format: 'CSV',
      cronExpression: '0 6 * * *',
      recipients: ['owner@example.com'],
      active: 1,
      unsubscribeToken: 'test-token',
      createdBy: 1,
    };

    const jobWithPrivate = job as unknown as { runSchedule: (s: FakeSchedule) => Promise<void> };
    await jobWithPrivate.runSchedule(schedule);

    expect(db.insert).toHaveBeenCalled();
    const insertedRun = db.insertedRows[0]!;
    expect(insertedRun['status']).toBe('RUNNING');
    expect(insertedRun['reportSlug']).toBe('hr-gender-diversity');
    expect(insertedRun['scheduleId']).toBe(42);
    expect(insertedRun['triggeredBy']).toBe('SCHEDULED');

    expect(db.update).toHaveBeenCalled();
    const updatedRun = db.updatedRows[0]!;
    expect(updatedRun['status']).toBe('COMPLETED');
    expect(updatedRun['rowCount']).toBe(2);
  });

  it('marks the run FAILED when the report engine throws', async () => {
    const db = makeDb([]);
    db.execute.mockRejectedValueOnce(new Error('db unavailable'));
    const logger = { info: vi.fn(), error: vi.fn() };
    const job = new ScheduledReportJob(db as never, logger, makeRedis() as never);

    const schedule: FakeSchedule = {
      id: 43,
      tenantId: 1,
      reportSlug: 'hr-gender-diversity',
      params: {},
      format: 'CSV',
      cronExpression: '0 6 * * *',
      recipients: ['owner@example.com'],
      active: 1,
      unsubscribeToken: 'test-token-2',
      createdBy: 1,
    };

    const jobWithPrivate = job as unknown as { runSchedule: (s: FakeSchedule) => Promise<void> };
    await jobWithPrivate.runSchedule(schedule);

    const updatedRun = db.updatedRows[0]!;
    expect(updatedRun['status']).toBe('FAILED');
    expect(updatedRun['errorMessage']).toContain('db unavailable');
  });
});

// PG-048: distributed lock around runSchedule so multiple report-service replicas don't
// double-dispatch the same schedule on the same cron tick.
describe('PG-048 — ScheduledReportJob distributed lock', () => {
  function makeSchedule(id: number): FakeSchedule {
    return {
      id,
      tenantId: 1,
      reportSlug: 'hr-gender-diversity',
      params: {},
      format: 'CSV',
      cronExpression: '0 6 * * *',
      recipients: ['owner@example.com'],
      active: 1,
      unsubscribeToken: `test-token-${id}`,
      createdBy: 1,
    };
  }

  it('only one of two concurrent replica invocations for the same schedule actually runs it', async () => {
    const db = makeDb([{ gender: 'MALE', headcount: 5 }]);
    const logger = { info: vi.fn(), error: vi.fn() };
    const redis = makeRedis();
    // Both "replicas" share the same job instance's redis client — mirrors two
    // ScheduledReportJob instances backed by the same Redis in production.
    const jobA = new ScheduledReportJob(db as never, logger, redis as never);
    const jobB = new ScheduledReportJob(db as never, logger, redis as never);

    const schedule = makeSchedule(50);

    await Promise.all([
      (
        jobA as unknown as { runScheduleWithLock: (s: FakeSchedule) => Promise<void> }
      ).runScheduleWithLock(schedule),
      (
        jobB as unknown as { runScheduleWithLock: (s: FakeSchedule) => Promise<void> }
      ).runScheduleWithLock(schedule),
    ]);

    // Only one RUNNING row should have been inserted — the other invocation was skipped
    // before it ever reached runSchedule/ReportEngine/sendMail.
    expect(db.insertedRows.length).toBe(1);
    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(redis.del).toHaveBeenCalledTimes(1);
  });

  it('releases the lock after a failing run so a later tick can still execute', async () => {
    const db = makeDb([]);
    db.execute.mockRejectedValueOnce(new Error('db unavailable'));
    const logger = { info: vi.fn(), error: vi.fn() };
    const redis = makeRedis();
    const job = new ScheduledReportJob(db as never, logger, redis as never);
    const schedule = makeSchedule(51);

    const runWithLock = (
      job as unknown as { runScheduleWithLock: (s: FakeSchedule) => Promise<void> }
    ).runScheduleWithLock.bind(job);
    await runWithLock(schedule);

    expect(db.updatedRows[0]!['status']).toBe('FAILED');
    // Lock must be released (not leaked) even though runSchedule's internal try/catch
    // already swallowed the error — a second call must be able to acquire the lock again.
    expect(redis.del).toHaveBeenCalledTimes(1);
    await runWithLock(schedule);
    expect(db.insertedRows.length).toBe(2);
  });

  it('skips the run (fails closed) when the Redis lock check throws', async () => {
    const db = makeDb([{ gender: 'MALE', headcount: 5 }]);
    const logger = { info: vi.fn(), error: vi.fn() };
    const redis = { set: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')), del: vi.fn() };
    const job = new ScheduledReportJob(db as never, logger, redis as never);
    const schedule = makeSchedule(52);

    const runWithLock = (
      job as unknown as { runScheduleWithLock: (s: FakeSchedule) => Promise<void> }
    ).runScheduleWithLock.bind(job);
    await runWithLock(schedule);

    expect(db.insertedRows.length).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });
});
