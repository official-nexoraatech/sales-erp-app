import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { ERPError, PERMISSIONS } from '@erp/types';

const { attendanceTable, shiftsTable, employeesTable, biometricDeviceConfigsTable } = vi.hoisted(() => ({
  attendanceTable: { tenantId: {}, employeeId: {}, attendanceDate: {} },
  shiftsTable: { tenantId: {}, id: {}, isDefault: {} },
  employeesTable: { tenantId: {}, employeeCode: {}, id: {}, shiftId: {} },
  biometricDeviceConfigsTable: { tenantId: {} },
}));

vi.mock('@erp/db', () => ({
  attendance: attendanceTable,
  shifts: shiftsTable,
  employees: employeesTable,
  biometricDeviceConfigs: biometricDeviceConfigsTable,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((..._args: unknown[]) => '__and__'),
  eq: vi.fn((_a: unknown, _b: unknown) => '__eq__'),
  gte: vi.fn(() => '__gte__'),
  lte: vi.fn(() => '__lte__'),
  isNull: vi.fn(() => '__isNull__'),
  inArray: vi.fn(() => '__inArray__'),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { attendanceRoutes } from '../api/attendance.routes.js';

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

function buildPunchLogMultipart(csv: string): { body: Buffer; contentType: string } {
  const boundary = '----hrservicetestboundary';
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="punches.csv"',
    'Content-Type: text/csv',
    '',
    csv,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return { body: Buffer.from(body), contentType: `multipart/form-data; boundary=${boundary}` };
}

function mockSelectFrom(table: unknown): { where: (..._args: unknown[]) => Promise<unknown[]> } {
  if (table === employeesTable) {
    return { where: () => Promise.resolve([{ id: 10, employeeCode: 'EMP-00010', shiftId: null }]) };
  }
  return { where: () => Promise.resolve([]) };
}

describe('POST /attendance/import (PG-041)', () => {
  let app: FastifyInstance;

  const mockCtxFactory = {
    create: () => ({
      db: {
        raw: {
          select: () => ({ from: mockSelectFrom }),
        },
      },
      audit: { log: vi.fn() },
    }),
  } as never;

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
    await attendanceRoutes(app, mockCtxFactory);
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ERPError) {
        return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
      }
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
    });
  });

  afterAll(() => app.close());

  it('normalizes a punch-log file and drives the ImportEngine pipeline through to execute, returning the real jobId', async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === '/imports/upload') return { ok: true, json: async () => ({ data: { jobId: 'job-123' } }) };
      if (path.endsWith('/map')) return { ok: true, json: async () => ({ data: {} }) };
      if (path.endsWith('/validate')) return { ok: true, json: async () => ({ data: { errors: [], validRows: 1 } }) };
      if (path.endsWith('/execute')) return { ok: true, json: async () => ({ data: { imported: 1, failed: 0 } }) };
      throw new Error(`Unexpected fetch to ${url}`);
    });

    const token = await makeToken([PERMISSIONS.ATTENDANCE_MARK]);
    const csv = ['EmployeeID,Date,Time,Direction', 'EMP-00010,2024-01-15,09:02:00,IN', 'EMP-00010,2024-01-15,18:10:00,OUT'].join('\n');
    const { body, contentType } = buildPunchLogMultipart(csv);

    const res = await app.inject({
      method: 'POST',
      url: '/attendance/import',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(202);
    const responseBody = res.json<{ data: { jobId: string; imported: number; failed: number } }>();
    expect(responseBody.data.jobId).toBe('job-123');
    expect(responseBody.data.imported).toBe(1);

    // upload → map → validate → execute, in that order
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const uploadCall = fetchMock.mock.calls[0]!;
    expect(new URL(uploadCall[0] as string).pathname).toBe('/imports/upload');
    const uploadBody = JSON.parse((uploadCall[1] as RequestInit).body as string) as { entityType: string; csvData: string };
    expect(uploadBody.entityType).toBe('attendance');
    expect(uploadBody.csvData).toContain('EMP-00010,2024-01-15,PRESENT');
    expect(uploadBody.csvData).toContain(',BIOMETRIC');
  });

  it('rejects a file with no valid punch rows as IMPORT_EMPTY', async () => {
    const token = await makeToken([PERMISSIONS.ATTENDANCE_MARK]);
    const csv = ['EmployeeID,Date,Time,Direction', ',2024-01-15,09:00:00,IN'].join('\n');
    const { body, contentType } = buildPunchLogMultipart(csv);

    const res = await app.inject({
      method: 'POST',
      url: '/attendance/import',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(422);
    const responseBody = res.json<{ error: { code: string } }>();
    expect(responseBody.error.code).toBe('IMPORT_EMPTY');
  });
});
