/* global Buffer */
import { describe, it, expect, vi, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../domain/ExportEngine.js', () => ({
  ExportEngine: vi.fn().mockImplementation(() => ({ query: queryMock })),
}));

const toCSVMock = vi.fn();
const toExcelMock = vi.fn();
const getFileNameMock = vi.fn();
const getContentTypeMock = vi.fn();
vi.mock('../domain/ExportFormatter.js', () => ({
  ExportFormatter: vi.fn().mockImplementation(() => ({
    toCSV: toCSVMock,
    toExcel: toExcelMock,
    getFileName: getFileNameMock,
    getContentType: getContentTypeMock,
  })),
}));

vi.mock('@erp/db', () => ({
  exportJobs: { id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ type: 'eq', col, val })),
}));

import { registerExportGenerateJob, EXPORT_GENERATE_JOB } from '../jobs/exportGenerateJob.js';

type JobHandler = (job: unknown, tenantId?: number) => Promise<void>;

function buildFakeRegistry() {
  const handlers = new Map<string, JobHandler>();
  const configs = new Map<string, { manualOnly?: boolean; tenantScoped: boolean }>();
  return {
    handlers,
    configs,
    register: vi.fn((name: string, config: { manualOnly?: boolean; tenantScoped: boolean }, handler: JobHandler) => {
      handlers.set(name, handler);
      configs.set(name, config);
    }),
  };
}

function buildFakeDb() {
  const updateSets: Array<Record<string, unknown>> = [];
  return {
    update: vi.fn(() => ({
      set: vi.fn((patch: Record<string, unknown>) => {
        updateSets.push(patch);
        return { where: vi.fn(() => Promise.resolve()) };
      }),
    })),
    updateSets,
  };
}

function buildFakeStorage(objectKey = 'tenant/1/exports/foo.csv', signedUrl = 'https://minio/foo') {
  return {
    uploadFile: vi.fn().mockResolvedValue(objectKey),
    getSignedUrl: vi.fn().mockResolvedValue(signedUrl),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('registerExportGenerateJob', () => {
  it('registers a manualOnly, tenantScoped job', () => {
    const registry = buildFakeRegistry();
    registerExportGenerateJob(registry as never, {} as never, {} as never);

    expect(registry.handlers.has(EXPORT_GENERATE_JOB)).toBe(true);
    const config = registry.configs.get(EXPORT_GENERATE_JOB)!;
    expect(config.manualOnly).toBe(true);
    expect(config.tenantScoped).toBe(true);
  });

  it('skips entirely when triggered without a tenantId', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    registerExportGenerateJob(registry as never, db as never, buildFakeStorage() as never);

    const handler = registry.handlers.get(EXPORT_GENERATE_JOB)!;
    await handler({ data: { jobId: 1 } }, undefined);

    expect(queryMock).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('generates a CSV, uploads it to MinIO, and marks the job READY with a real s3Key/signedUrl/totalRows', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    const storage = buildFakeStorage('tenant/1/exports/customer.csv', 'https://minio/signed');
    queryMock.mockResolvedValue({
      columns: [{ key: 'name', label: 'Name', type: 'string' }],
      rows: [{ name: 'Acme' }],
      totalRows: 1,
    });
    toCSVMock.mockReturnValue('Name\nAcme');
    getFileNameMock.mockReturnValue('customer-export.csv');
    getContentTypeMock.mockReturnValue('text/csv');

    registerExportGenerateJob(registry as never, db as never, storage as never);
    const handler = registry.handlers.get(EXPORT_GENERATE_JOB)!;
    await handler({ data: { jobId: 42, entityType: 'customer', format: 'CSV' } }, 1);

    expect(toCSVMock).toHaveBeenCalled();
    expect(toExcelMock).not.toHaveBeenCalled();
    expect(storage.uploadFile).toHaveBeenCalledWith(1, 'exports', 'customer-export.csv', expect.any(Buffer), 'text/csv');
    expect(storage.getSignedUrl).toHaveBeenCalledWith('tenant/1/exports/customer.csv', 86400);
    expect(db.updateSets).toContainEqual(
      expect.objectContaining({
        status: 'READY',
        s3Key: 'tenant/1/exports/customer.csv',
        signedUrl: 'https://minio/signed',
        totalRows: 1,
      })
    );
  });

  it('generates XLSX via toExcel (not toCSV) when format is XLSX', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    const storage = buildFakeStorage();
    queryMock.mockResolvedValue({ columns: [], rows: [], totalRows: 0 });
    toExcelMock.mockReturnValue(Buffer.from('xlsx-bytes'));
    getFileNameMock.mockReturnValue('item-export.xlsx');
    getContentTypeMock.mockReturnValue('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    registerExportGenerateJob(registry as never, db as never, storage as never);
    const handler = registry.handlers.get(EXPORT_GENERATE_JOB)!;
    await handler({ data: { jobId: 1, entityType: 'item', format: 'XLSX' } }, 1);

    expect(toExcelMock).toHaveBeenCalled();
    expect(toCSVMock).not.toHaveBeenCalled();
  });

  it('marks the job FAILED with errorMessage and rethrows when the query fails', async () => {
    const registry = buildFakeRegistry();
    const db = buildFakeDb();
    queryMock.mockRejectedValue(new Error('db down'));

    registerExportGenerateJob(registry as never, db as never, buildFakeStorage() as never);
    const handler = registry.handlers.get(EXPORT_GENERATE_JOB)!;

    await expect(handler({ data: { jobId: 7, entityType: 'customer', format: 'CSV' } }, 1)).rejects.toThrow('db down');
    expect(db.updateSets).toContainEqual(expect.objectContaining({ status: 'FAILED', errorMessage: 'db down' }));
  });
});
