// PG-042 — Employee Photo/Document Upload: the two upload routes used to be pure stubs
// (verify the employee exists, then return a hardcoded fake path — no file was ever read
// or stored). This verifies the real PlatformAttachments/StorageClient wiring: uploads
// reach ctx.files with the right entityType/entityId, permission gates (EMPLOYEE_UPDATE for
// upload/delete, EMPLOYEE_VIEW for list/download), MIME/size validation, and that a document
// belonging to a different employee can't be downloaded/deleted through another employee's URL.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { ERPError, PERMISSIONS } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';

const { employeesTable, departmentsTable, designationsTable } = vi.hoisted(() => ({
  employeesTable: { id: {}, tenantId: {}, deletedAt: {}, photoUrl: {}, updatedAt: {} },
  departmentsTable: {},
  designationsTable: {},
}));

vi.mock('@erp/db', () => ({
  employees: employeesTable,
  departments: departmentsTable,
  designations: designationsTable,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  ilike: vi.fn(() => '__ilike__'),
  isNull: vi.fn(() => '__isNull__'),
  or: vi.fn(() => '__or__'),
  sql: vi.fn(() => '__sql__'),
}));

import { employeeRoutes } from '../api/employee.routes.js';

let privateKey: KeyLike;
const TEST_TTL = 900;

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'test@erp.local', roles: [], permissions })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer('erp-test')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + TEST_TTL)
    .sign(privateKey);
}

function buildMultipart(fields: Record<string, string>, file: { filename: string; contentType: string; content: string }): { body: Buffer; contentType: string } {
  const boundary = '----hrdocumenttestboundary';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`--${boundary}`, `Content-Disposition: form-data; name="${key}"`, '', value);
  }
  parts.push(
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${file.filename}"`,
    `Content-Type: ${file.contentType}`,
    '',
    file.content
  );
  parts.push(`--${boundary}--`, '');
  return { body: Buffer.from(parts.join('\r\n')), contentType: `multipart/form-data; boundary=${boundary}` };
}

let employeeExists = true;
const listMock = vi.fn();
const uploadMock = vi.fn();
const getMock = vi.fn();
const getDownloadUrlMock = vi.fn();
const deleteMock = vi.fn();
const auditLogMock = vi.fn();
const updateWhereMock = vi.fn().mockResolvedValue(undefined);

function makeCtxFactory(): PlatformContextFactory {
  return {
    create: () => ({
      db: {
        raw: {
          select: () => ({
            from: () => ({
              where: () => Promise.resolve(employeeExists ? [{ id: 1 }] : []),
            }),
          }),
          update: () => ({
            set: () => ({
              where: updateWhereMock,
            }),
          }),
        },
      },
      files: {
        list: listMock,
        upload: uploadMock,
        get: getMock,
        getDownloadUrl: getDownloadUrlMock,
        delete: deleteMock,
      },
      audit: { log: auditLogMock },
    }),
  } as unknown as PlatformContextFactory;
}

describe('employee photo/document upload (PG-042)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = await importPKCS8(privPem, 'RS256');
    process.env['JWT_PUBLIC_KEY'] = pubPem;

    app = Fastify({ logger: false });
    await app.register(multipart);
    await employeeRoutes(app, makeCtxFactory());
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ERPError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
      }
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: error.message } });
    });
  });

  afterAll(() => app.close());

  beforeEach(() => {
    employeeExists = true;
    listMock.mockReset().mockResolvedValue([]);
    uploadMock.mockReset().mockResolvedValue({ id: 10, objectKey: 'tenant/1/employee_photo/1-photo.jpg' });
    getMock.mockReset();
    getDownloadUrlMock.mockReset();
    deleteMock.mockReset().mockResolvedValue(undefined);
    auditLogMock.mockReset();
    updateWhereMock.mockClear();
  });

  describe('photo upload', () => {
    it('rejects without EMPLOYEE_UPDATE → 403, never uploads', async () => {
      const token = await makeToken([PERMISSIONS.EMPLOYEE_VIEW]);
      const { body, contentType } = buildMultipart({}, { filename: 'photo.jpg', contentType: 'image/jpeg', content: 'binarydata' });

      const res = await app.inject({
        method: 'POST',
        url: '/employees/1/photo/upload',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
        payload: body,
      });

      expect(res.statusCode).toBe(403);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('unknown employee → 404, never uploads', async () => {
      employeeExists = false;
      const token = await makeToken([PERMISSIONS.EMPLOYEE_UPDATE]);
      const { body, contentType } = buildMultipart({}, { filename: 'photo.jpg', contentType: 'image/jpeg', content: 'binarydata' });

      const res = await app.inject({
        method: 'POST',
        url: '/employees/999/photo/upload',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
        payload: body,
      });

      expect(res.statusCode).toBe(404);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('rejects an unsupported MIME type (e.g. PDF) → 422', async () => {
      const token = await makeToken([PERMISSIONS.EMPLOYEE_UPDATE]);
      const { body, contentType } = buildMultipart({}, { filename: 'photo.pdf', contentType: 'application/pdf', content: '%PDF-1.4' });

      const res = await app.inject({
        method: 'POST',
        url: '/employees/1/photo/upload',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
        payload: body,
      });

      expect(res.statusCode).toBe(422);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('stores the upload via PlatformAttachments as EMPLOYEE_PHOTO and writes the objectKey to photoUrl', async () => {
      const token = await makeToken([PERMISSIONS.EMPLOYEE_UPDATE]);
      const { body, contentType } = buildMultipart({}, { filename: 'photo.jpg', contentType: 'image/jpeg', content: 'binarydata' });

      const res = await app.inject({
        method: 'POST',
        url: '/employees/1/photo/upload',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
        payload: body,
      });

      expect(res.statusCode).toBe(200);
      const responseBody = res.json<{ data: { employeeId: number; photoUrl: string } }>();
      expect(responseBody.data.photoUrl).toBe('tenant/1/employee_photo/1-photo.jpg');
      expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'EMPLOYEE_PHOTO', entityId: 1, mimeType: 'image/jpeg' }));
      expect(updateWhereMock).toHaveBeenCalled();
      expect(auditLogMock).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ action: 'PHOTO_UPLOAD' }) }));
    });

    it('deletes any prior photo attachment before storing the new one (replace-on-reupload)', async () => {
      listMock.mockResolvedValueOnce([{ id: 7, entityType: 'EMPLOYEE_PHOTO', entityId: 1 }]);
      const token = await makeToken([PERMISSIONS.EMPLOYEE_UPDATE]);
      const { body, contentType } = buildMultipart({}, { filename: 'photo2.jpg', contentType: 'image/jpeg', content: 'binarydata2' });

      const res = await app.inject({
        method: 'POST',
        url: '/employees/1/photo/upload',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
        payload: body,
      });

      expect(res.statusCode).toBe(200);
      expect(deleteMock).toHaveBeenCalledWith(7);
    });
  });

  describe('GET /employees/:id/photo', () => {
    it('404 when no photo has been uploaded', async () => {
      listMock.mockResolvedValue([]);
      const token = await makeToken([PERMISSIONS.EMPLOYEE_VIEW]);

      const res = await app.inject({ method: 'GET', url: '/employees/1/photo', headers: { Authorization: `Bearer ${token}` } });

      expect(res.statusCode).toBe(404);
    });

    it('302 redirects to a signed URL when a photo exists', async () => {
      listMock.mockResolvedValue([{ id: 10, entityType: 'EMPLOYEE_PHOTO', entityId: 1 }]);
      getDownloadUrlMock.mockResolvedValue({ url: 'https://minio.local/signed', fileName: 'photo.jpg' });
      const token = await makeToken([PERMISSIONS.EMPLOYEE_VIEW]);

      const res = await app.inject({ method: 'GET', url: '/employees/1/photo', headers: { Authorization: `Bearer ${token}` } });

      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('https://minio.local/signed');
    });
  });

  describe('document upload', () => {
    it('rejects a missing/invalid documentType → 422', async () => {
      const token = await makeToken([PERMISSIONS.EMPLOYEE_UPDATE]);
      const { body, contentType } = buildMultipart({ documentType: 'PASSPORT' }, { filename: 'doc.pdf', contentType: 'application/pdf', content: '%PDF-1.4' });

      const res = await app.inject({
        method: 'POST',
        url: '/employees/1/documents/upload',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
        payload: body,
      });

      expect(res.statusCode).toBe(422);
      expect(uploadMock).not.toHaveBeenCalled();
    });

    it('creates an EMPLOYEE_DOCUMENT attachment for a valid documentType', async () => {
      uploadMock.mockResolvedValue({ id: 22, entityType: 'EMPLOYEE_DOCUMENT', entityId: 1, fileName: '[AADHAAR] aadhaar.pdf', objectKey: 'k', fileSize: 8, mimeType: 'application/pdf', uploadedBy: 1, createdAt: new Date().toISOString() });
      const token = await makeToken([PERMISSIONS.EMPLOYEE_UPDATE]);
      const { body, contentType } = buildMultipart({ documentType: 'AADHAAR' }, { filename: 'aadhaar.pdf', contentType: 'application/pdf', content: '%PDF-1.4' });

      const res = await app.inject({
        method: 'POST',
        url: '/employees/1/documents/upload',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
        payload: body,
      });

      expect(res.statusCode).toBe(201);
      expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'EMPLOYEE_DOCUMENT', entityId: 1, fileName: '[AADHAAR] aadhaar.pdf' }));
    });
  });

  describe('GET /employees/:id/documents', () => {
    it('requires EMPLOYEE_VIEW → 403 without it', async () => {
      const token = await makeToken([]);
      const res = await app.inject({ method: 'GET', url: '/employees/1/documents', headers: { Authorization: `Bearer ${token}` } });
      expect(res.statusCode).toBe(403);
    });

    it('lists EMPLOYEE_DOCUMENT attachments for the employee', async () => {
      listMock.mockResolvedValue([{ id: 22, entityType: 'EMPLOYEE_DOCUMENT', entityId: 1, fileName: '[PAN] pan.pdf' }]);
      const token = await makeToken([PERMISSIONS.EMPLOYEE_VIEW]);

      const res = await app.inject({ method: 'GET', url: '/employees/1/documents', headers: { Authorization: `Bearer ${token}` } });

      expect(res.statusCode).toBe(200);
      expect(listMock).toHaveBeenCalledWith('EMPLOYEE_DOCUMENT', 1);
    });
  });

  describe('document download/delete', () => {
    it('download requires EMPLOYEE_VIEW → 403 without, 302 with', async () => {
      getMock.mockResolvedValue({ id: 22, entityType: 'EMPLOYEE_DOCUMENT', entityId: 1 });
      getDownloadUrlMock.mockResolvedValue({ url: 'https://minio.local/doc', fileName: 'x.pdf' });

      const noPerm = await makeToken([]);
      const resForbidden = await app.inject({ method: 'GET', url: '/employees/1/documents/22/download', headers: { Authorization: `Bearer ${noPerm}` } });
      expect(resForbidden.statusCode).toBe(403);
      expect(getDownloadUrlMock).not.toHaveBeenCalled();

      const withPerm = await makeToken([PERMISSIONS.EMPLOYEE_VIEW]);
      const resOk = await app.inject({ method: 'GET', url: '/employees/1/documents/22/download', headers: { Authorization: `Bearer ${withPerm}` } });
      expect(resOk.statusCode).toBe(302);
      expect(resOk.headers.location).toBe('https://minio.local/doc');
    });

    it('a document belonging to a different employee → 404, not the other employee\'s file', async () => {
      getMock.mockResolvedValue({ id: 22, entityType: 'EMPLOYEE_DOCUMENT', entityId: 999 });
      const token = await makeToken([PERMISSIONS.EMPLOYEE_VIEW]);

      const res = await app.inject({ method: 'GET', url: '/employees/1/documents/22/download', headers: { Authorization: `Bearer ${token}` } });

      expect(res.statusCode).toBe(404);
      expect(getDownloadUrlMock).not.toHaveBeenCalled();
    });

    it('delete requires EMPLOYEE_UPDATE → 403 without, 204 with, deletes exactly the requested attachment', async () => {
      getMock.mockResolvedValue({ id: 22, entityType: 'EMPLOYEE_DOCUMENT', entityId: 1 });

      const viewOnly = await makeToken([PERMISSIONS.EMPLOYEE_VIEW]);
      const resForbidden = await app.inject({ method: 'DELETE', url: '/employees/1/documents/22', headers: { Authorization: `Bearer ${viewOnly}` } });
      expect(resForbidden.statusCode).toBe(403);
      expect(deleteMock).not.toHaveBeenCalled();

      const canUpdate = await makeToken([PERMISSIONS.EMPLOYEE_UPDATE]);
      const resOk = await app.inject({ method: 'DELETE', url: '/employees/1/documents/22', headers: { Authorization: `Bearer ${canUpdate}` } });
      expect(resOk.statusCode).toBe(204);
      expect(deleteMock).toHaveBeenCalledWith(22);
    });
  });
});
