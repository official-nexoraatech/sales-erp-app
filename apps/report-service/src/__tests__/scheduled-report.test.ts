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
    const job = new ScheduledReportJob(db as never, logger);

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
    const job = new ScheduledReportJob(db as never, logger);

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
