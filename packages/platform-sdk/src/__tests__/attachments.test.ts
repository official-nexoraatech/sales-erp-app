import { describe, it, expect, vi } from 'vitest';

vi.mock('@erp/db', () => {
  const mockTable = new Proxy({}, { get: (_t, prop) => ({ columnName: String(prop) }) });
  return { documentAttachments: mockTable, createDatabaseClient: vi.fn() };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ type: 'eq', a, b })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
}));

import { TenantScopedDatabase } from '../database.js';
import { PlatformAttachments } from '../attachments.js';
import type { StorageClient } from '../storage.js';

function makeStorage(): StorageClient {
  return {
    uploadFile: vi.fn().mockResolvedValue('tenant/1/invoice/12345-file.pdf'),
    getSignedUrl: vi.fn().mockResolvedValue('https://minio.local/signed-url'),
    deleteFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as StorageClient;
}

function makeRawDb(row: Record<string, unknown> | undefined) {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(row ? [row] : []) }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(row ? [row] : []) }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  };
}

describe('PlatformAttachments', () => {
  it('upload() stores the object via StorageClient and inserts a tenant-scoped row', async () => {
    const storage = makeStorage();
    const insertedRow = { id: 1, tenantId: 7, entityType: 'INVOICE', entityId: 42, objectKey: 'tenant/7/invoice/1-a.pdf', fileName: 'a.pdf' };
    const rawDb = makeRawDb(insertedRow);
    const db = new TenantScopedDatabase(7, rawDb as never);
    const attachments = new PlatformAttachments(db, storage);

    const result = await attachments.upload({
      entityType: 'INVOICE',
      entityId: 42,
      fileName: 'a.pdf',
      buffer: Buffer.from('hello'),
      mimeType: 'application/pdf',
      fileSize: 5,
      uploadedBy: 1,
    });

    expect(storage.uploadFile).toHaveBeenCalledWith(7, 'invoice', 'a.pdf', expect.any(Buffer), 'application/pdf');
    expect(result).toEqual(insertedRow);
  });

  it('getDownloadUrl() throws NotFoundError when the attachment does not belong to this tenant', async () => {
    const storage = makeStorage();
    const rawDb = makeRawDb(undefined); // no row found — tenant mismatch or missing
    const db = new TenantScopedDatabase(7, rawDb as never);
    const attachments = new PlatformAttachments(db, storage);

    await expect(attachments.getDownloadUrl(999)).rejects.toThrow();
    expect(storage.getSignedUrl).not.toHaveBeenCalled();
  });

  it('delete() removes the object from storage before deleting the metadata row', async () => {
    const storage = makeStorage();
    const row = { id: 5, tenantId: 7, objectKey: 'tenant/7/invoice/5-a.pdf' };
    const rawDb = makeRawDb(row);
    const db = new TenantScopedDatabase(7, rawDb as never);
    const attachments = new PlatformAttachments(db, storage);

    await attachments.delete(5);

    expect(storage.deleteFile).toHaveBeenCalledWith('tenant/7/invoice/5-a.pdf');
    expect(rawDb.delete).toHaveBeenCalled();
  });
});
