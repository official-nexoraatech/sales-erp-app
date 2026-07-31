// CRM-ROADMAP Phase 4, Feature 8 — Public CRM API & BI/Data-Warehouse Export.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const queueAdd = vi.fn().mockResolvedValue({ id: 'job-1' });
const queueRemoveRepeatable = vi.fn().mockResolvedValue(true);
const queueClose = vi.fn().mockResolvedValue(undefined);
const workerClose = vi.fn().mockResolvedValue(undefined);
let workerHandler: (job: { data: unknown }) => Promise<void>;

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: queueAdd,
    removeRepeatable: queueRemoveRepeatable,
    close: queueClose,
  })),
  Worker: vi
    .fn()
    .mockImplementation((_name: string, handler: (job: { data: unknown }) => Promise<void>) => {
      workerHandler = handler;
      return { close: workerClose, on: vi.fn() };
    }),
}));

vi.mock('@erp/db', () => ({
  exportSchedules: { id: 'id', active: 'active' },
  exportRunHistory: { id: 'id', scheduleId: 'scheduleId' },
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ type: 'eq', a, b })) }));

const engineQuery = vi.fn();
vi.mock('../domain/ExportEngine.js', () => ({
  ExportEngine: vi.fn().mockImplementation(() => ({ query: engineQuery })),
}));

const formatterToCSV = vi.fn().mockReturnValue('col\nval');
vi.mock('../domain/ExportFormatter.js', () => ({
  ExportFormatter: vi.fn().mockImplementation(() => ({
    toCSV: formatterToCSV,
    toExcel: vi.fn().mockReturnValue(Buffer.from('xlsx')),
    getFileName: vi.fn().mockReturnValue('lead-export.csv'),
    getContentType: vi.fn().mockReturnValue('text/csv'),
  })),
}));

const originalFetch = globalThis.fetch;

import { ExportScheduleJob } from '../jobs/ExportScheduleJob.js';

function makeDb(opts: {
  activeSchedules?: Array<Record<string, unknown>>;
  scheduleById?: Record<string, unknown> | undefined;
  insertReturn?: Record<string, unknown>;
}) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi
          .fn()
          .mockResolvedValue(
            opts.scheduleById ? [opts.scheduleById] : (opts.activeSchedules ?? [])
          ),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([opts.insertReturn ?? { id: 1 }]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })),
  };
}

function makeStorage() {
  return {
    uploadFile: vi.fn().mockResolvedValue('tenant/1/export-schedules/lead-export.csv'),
    getSignedUrl: vi.fn().mockResolvedValue('https://minio.local/signed-url'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
});

describe('ExportScheduleJob.syncSchedules (via start())', () => {
  it('registers a BullMQ repeatable job for each active schedule', async () => {
    const db = makeDb({ activeSchedules: [{ id: 5, cronExpression: '0 6 * * *', active: 1 }] });
    const job = new ExportScheduleJob(db as never, {} as never, makeStorage() as never);
    await job.start();

    expect(queueAdd).toHaveBeenCalledWith(
      'export-schedule-run',
      { scheduleId: 5 },
      { repeat: { pattern: '0 6 * * *' }, jobId: 'schedule:5' }
    );
    await job.stop();
  });
});

describe('ExportScheduleJob run (via the registered Worker handler)', () => {
  it('writes exportRunHistory COMPLETED with a real fileUrl on success', async () => {
    const db = makeDb({
      activeSchedules: [],
      scheduleById: {
        id: 5,
        tenantId: 1,
        entityType: 'lead',
        format: 'CSV',
        filters: {},
        cronExpression: '0 6 * * *',
        active: 1,
        recipients: [],
      },
      insertReturn: { id: 99 },
    });
    engineQuery.mockResolvedValue({ columns: [], rows: [], totalRows: 3 });
    const storage = makeStorage();
    const job = new ExportScheduleJob(db as never, {} as never, storage as never);
    await job.start();

    await workerHandler({ data: { scheduleId: 5 } });

    expect(storage.uploadFile).toHaveBeenCalled();
    expect(storage.getSignedUrl).toHaveBeenCalledWith(
      'tenant/1/export-schedules/lead-export.csv',
      7 * 24 * 60 * 60
    );
    expect(db.update).toHaveBeenCalled();
    await job.stop();
  });

  it('writes exportRunHistory FAILED (not an unhandled rejection) when the export query throws', async () => {
    const db = makeDb({
      activeSchedules: [],
      scheduleById: {
        id: 5,
        tenantId: 1,
        entityType: 'lead',
        format: 'CSV',
        filters: {},
        cronExpression: '0 6 * * *',
        active: 1,
        recipients: [],
      },
      insertReturn: { id: 99 },
    });
    engineQuery.mockRejectedValue(new Error('db exploded'));
    const job = new ExportScheduleJob(db as never, {} as never, makeStorage() as never);
    await job.start();

    await expect(workerHandler({ data: { scheduleId: 5 } })).resolves.toBeUndefined();
    expect(db.update).toHaveBeenCalled();
    await job.stop();
  });

  it('skips the run entirely when the schedule was deactivated between sync and dispatch', async () => {
    const db = makeDb({ activeSchedules: [], scheduleById: undefined });
    const job = new ExportScheduleJob(db as never, {} as never, makeStorage() as never);
    await job.start();

    await workerHandler({ data: { scheduleId: 999 } });
    expect(db.insert).not.toHaveBeenCalled();
    await job.stop();
  });

  it('emails each recipient via notification-service internal route when recipients are configured', async () => {
    const db = makeDb({
      activeSchedules: [],
      scheduleById: {
        id: 5,
        tenantId: 1,
        entityType: 'lead',
        format: 'CSV',
        filters: {},
        cronExpression: '0 6 * * *',
        active: 1,
        recipients: ['analyst@example.com'],
      },
      insertReturn: { id: 99 },
    });
    engineQuery.mockResolvedValue({ columns: [], rows: [], totalRows: 1 });
    const job = new ExportScheduleJob(db as never, {} as never, makeStorage() as never);
    await job.start();

    await workerHandler({ data: { scheduleId: 5 } });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/notifications/send-raw-internal'),
      expect.objectContaining({ method: 'POST' })
    );
    await job.stop();
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});
