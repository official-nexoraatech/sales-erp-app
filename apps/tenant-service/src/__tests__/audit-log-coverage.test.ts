// F11 (2026-07-22 enterprise audit): tenant creation and organization/branch/SSO config
// mutations previously wrote no append-only audit_log entry at all — only suspend/activate/
// close did (PG-012). This suite verifies ctx.audit.log() is actually invoked, with the
// right action/entityType, on every mutating route this fix touched.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';

vi.mock('@erp/db', () => ({
  branches: { __name: 'branches' },
  organizationSettings: { __name: 'organizationSettings' },
  ssoConfigs: { __name: 'ssoConfigs' },
  tenants: { __name: 'tenants' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  ne: vi.fn(() => '__ne__'),
  isNull: vi.fn(() => '__isNull__'),
  or: vi.fn(() => '__or__'),
  ilike: vi.fn(() => '__ilike__'),
  sql: vi.fn(() => '__sql__'),
}));

vi.mock('@erp/utils/server', () => ({
  encryptField: vi.fn(() => 'iv:tag:ciphertext'),
}));

vi.mock('@erp/config', () => ({
  requireEnv: vi.fn(() => '0'.repeat(64)),
}));

const { storageUploadMock, storageDeleteMock, storageSignedUrlMock } = vi.hoisted(() => ({
  storageUploadMock: vi.fn().mockResolvedValue('tenants/1/logo/123-logo.png'),
  storageDeleteMock: vi.fn().mockResolvedValue(undefined),
  storageSignedUrlMock: vi.fn().mockResolvedValue('https://minio.local/signed-logo-url'),
}));

vi.mock('@erp/sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    assertTenantActive: vi.fn().mockResolvedValue(undefined),
    // F14: organizationRoutes() constructs `new StorageClient(config)` directly (not via
    // ctx) — mock the class so logo-upload tests never hit real MinIO.
    StorageClient: vi.fn().mockImplementation(() => ({
      uploadFile: storageUploadMock,
      deleteFile: storageDeleteMock,
      getSignedUrl: storageSignedUrlMock,
      bucketExists: vi.fn().mockResolvedValue(true),
    })),
  };
});

import multipart from '@fastify/multipart';
import { branchRoutes } from '../api/branch.routes.js';
import { organizationRoutes } from '../api/organization.routes.js';
import { ssoConfigRoutes } from '../api/sso-config.routes.js';

let privateKey: KeyLike;

// F14: organizationRoutes() now constructs a StorageClient from these fields at setup —
// never actually contacted in these tests (no upload-route test in this file), just needs
// to exist so construction doesn't throw.
const FAKE_MINIO_CONFIG = {
  minioEndpoint: 'localhost:9000',
  minioAccessKey: 'test',
  minioSecretKey: 'test',
  minioUseSSL: false,
  minioBucket: 'erp-local',
} as never;

function buildMultipart(file: { filename: string; contentType: string; content: string }): {
  body: Buffer;
  contentType: string;
} {
  const boundary = '----logouploadtestboundary';
  const parts: string[] = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${file.filename}"`,
    `Content-Type: ${file.contentType}`,
    '',
    file.content,
    `--${boundary}--`,
    '',
  ];
  return {
    body: Buffer.from(parts.join('\r\n')),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'admin@erp.local', roles: [], permissions })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuedAt(nowSec)
    .setIssuer('erp-auth-service')
    .setExpirationTime(nowSec + 900)
    .sign(privateKey);
}

// Emulates the "no tenant row found" path so assertUnderBranchLimit's getMaxLimit() returns
// null (unlimited) and exits before ever touching a branch-count query.
function noTenantSelect(): unknown {
  return { from: () => ({ where: () => Promise.resolve([]) }) };
}

beforeAll(async () => {
  const { privateKey: priv, publicKey: pub } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(priv, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pub;
});

describe('F11 — audit_log coverage on tenant-service mutations', () => {
  beforeEach(() => {
    storageUploadMock.mockClear();
    storageDeleteMock.mockClear();
    storageSignedUrlMock.mockClear();
  });

  it('POST /branches writes a CREATE audit_log entry', async () => {
    const auditLog = vi.fn().mockResolvedValue(undefined);
    const createdBranch = { id: 42, tenantId: 1, name: 'New Branch', code: 'NB1' };

    const db = {
      select: () => noTenantSelect(),
      execute: async () => [],
      insert: () => ({
        values: () => ({ returning: async () => [createdBranch] }),
      }),
      transaction: async (cb: (trx: typeof db) => unknown) => cb(db),
    };

    // withTenantConnection (called by tenantScopedHandler) calls ctxFactory.rawDb.transaction(cb)
    // expecting cb's param to have .execute() directly — that's `db` itself. The route's own
    // nested ctx.db.transaction() (branch.routes.ts's TOCTOU lock) expects its callback's param
    // to have a `.raw` property instead — a separate wrapper reusing the same underlying db.
    const ctxFactory = {
      rawDb: db,
      create: (
        tenant: { tenantId: number; userId: number; correlationId: string },
        dbOverride?: typeof db
      ) => {
        const scopedDb = dbOverride ?? db;
        return {
          db: {
            raw: scopedDb,
            transaction: (cb: (trx: { raw: typeof db }) => unknown) =>
              scopedDb.transaction((trx) => cb({ raw: trx })),
          },
          tenant,
          events: { publish: vi.fn().mockResolvedValue(undefined) },
          audit: { log: auditLog },
        };
      },
    } as never;

    const app: FastifyInstance = Fastify({ logger: false });
    await branchRoutes(app, ctxFactory);

    const token = await makeToken(['BRANCH_MANAGE']);
    const res = await app.inject({
      method: 'POST',
      url: '/branches',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name: 'New Branch', code: 'nb1' },
    });

    expect(res.statusCode).toBe(201);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityType: 'branch', entityId: 42 })
    );
    await app.close();
  });

  it('PUT /organization (first-time create path) writes a CREATE audit_log entry', async () => {
    const auditLog = vi.fn().mockResolvedValue(undefined);
    const createdOrg = { id: 7, tenantId: 1, orgName: 'Acme Textiles' };

    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      insert: () => ({
        values: () => ({ returning: async () => [createdOrg] }),
      }),
      execute: async () => [],
      transaction: async (cb: (trx: typeof db) => unknown) => cb(db),
    };

    const ctxFactory = {
      rawDb: db,
      create: (tenant: { tenantId: number; userId: number; correlationId: string }) => ({
        db: { raw: db },
        tenant,
        events: { publish: vi.fn().mockResolvedValue(undefined) },
        audit: { log: auditLog },
      }),
    } as never;

    const app: FastifyInstance = Fastify({ logger: false });
    await organizationRoutes(app, ctxFactory, FAKE_MINIO_CONFIG);

    const token = await makeToken(['ORG_SETTINGS_EDIT']);
    const res = await app.inject({
      method: 'PUT',
      url: '/organization',
      headers: { Authorization: `Bearer ${token}` },
      payload: { orgName: 'Acme Textiles' },
    });

    expect(res.statusCode).toBe(200);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entityType: 'organization_settings',
        entityId: 7,
      })
    );
    await app.close();
  });

  it('PUT /sso-config (first-time create path) writes a CREATE audit_log entry, never the raw secret', async () => {
    const auditLog = vi.fn().mockResolvedValue(undefined);
    const createdConfig = {
      id: 5,
      tenantId: 1,
      provider: 'OKTA',
      issuerUrl: 'https://acme.okta.com',
      clientId: 'abc123',
      clientSecretEncrypted: 'iv:tag:ciphertext',
      enabled: true,
      bypassLocalMfa: false,
    };

    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      insert: () => ({
        values: () => ({ returning: async () => [createdConfig] }),
      }),
      execute: async () => [],
      transaction: async (cb: (trx: typeof db) => unknown) => cb(db),
    };

    const ctxFactory = {
      rawDb: db,
      create: (tenant: { tenantId: number; userId: number; correlationId: string }) => ({
        db: { raw: db },
        tenant,
        events: { publish: vi.fn().mockResolvedValue(undefined) },
        audit: { log: auditLog },
      }),
    } as never;

    const app: FastifyInstance = Fastify({ logger: false });
    await ssoConfigRoutes(app, ctxFactory);

    const token = await makeToken(['SSO_CONFIG_MANAGE']);
    const res = await app.inject({
      method: 'PUT',
      url: '/sso-config',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        provider: 'OKTA',
        issuerUrl: 'https://acme.okta.com',
        clientId: 'abc123',
        clientSecret: 'super-secret',
        enabled: true,
        bypassLocalMfa: false,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(auditLog).toHaveBeenCalledTimes(1);
    const call = auditLog.mock.calls[0]![0] as {
      action: string;
      entityType: string;
      entityId: number;
      after: Record<string, unknown>;
    };
    expect(call.action).toBe('CREATE');
    expect(call.entityType).toBe('sso_config');
    expect(call.entityId).toBe(5);
    expect(call.after['clientSecretEncrypted']).toBeUndefined();
    expect(call.after['hasClientSecret']).toBe(true);
    await app.close();
  });

  it('DELETE /sso-config writes a DELETE audit_log entry', async () => {
    const auditLog = vi.fn().mockResolvedValue(undefined);
    const deletedConfig = {
      id: 5,
      tenantId: 1,
      provider: 'OKTA',
      clientSecretEncrypted: 'iv:tag:ciphertext',
    };

    const db = {
      delete: () => ({
        where: () => ({ returning: async () => [deletedConfig] }),
      }),
      execute: async () => [],
      transaction: async (cb: (trx: typeof db) => unknown) => cb(db),
    };

    const ctxFactory = {
      rawDb: db,
      create: (tenant: { tenantId: number; userId: number; correlationId: string }) => ({
        db: { raw: db },
        tenant,
        events: { publish: vi.fn().mockResolvedValue(undefined) },
        audit: { log: auditLog },
      }),
    } as never;

    const app: FastifyInstance = Fastify({ logger: false });
    await ssoConfigRoutes(app, ctxFactory);

    const token = await makeToken(['SSO_CONFIG_MANAGE']);
    const res = await app.inject({
      method: 'DELETE',
      url: '/sso-config',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entityType: 'sso_config', entityId: 5 })
    );
    await app.close();
  });

  it('POST /organization/logo/upload stores the file via StorageClient and persists logoObjectKey', async () => {
    const auditLog = vi.fn().mockResolvedValue(undefined);
    const existingOrg = { id: 7, tenantId: 1, version: 3, logoObjectKey: null };
    const updatedOrg = { ...existingOrg, logoObjectKey: 'tenants/1/logo/123-logo.png', version: 4 };

    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([existingOrg]) }) }),
      update: () => ({
        set: () => ({ where: () => ({ returning: async () => [updatedOrg] }) }),
      }),
    };

    const ctxFactory = {
      create: () => ({
        db: { raw: db },
        events: { publish: vi.fn().mockResolvedValue(undefined) },
        audit: { log: auditLog },
      }),
    } as never;

    const app: FastifyInstance = Fastify({ logger: false });
    await app.register(multipart);
    await organizationRoutes(app, ctxFactory, FAKE_MINIO_CONFIG);

    const token = await makeToken(['ORG_SETTINGS_EDIT']);
    const { body, contentType } = buildMultipart({
      filename: 'logo.png',
      contentType: 'image/png',
      content: 'fake-binary-logo-bytes',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/organization/logo/upload',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(storageUploadMock).toHaveBeenCalledWith(
      1,
      'logo',
      'logo.png',
      expect.any(Buffer),
      'image/png'
    );
    expect(res.json().data.logoObjectKey).toBe('tenants/1/logo/123-logo.png');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        entityType: 'organization_settings',
        metadata: { action: 'LOGO_UPLOAD', fileName: 'logo.png' },
      })
    );
    await app.close();
  });

  it('POST /organization/logo/upload rejects an unsupported MIME type without uploading', async () => {
    const existingOrg = { id: 7, tenantId: 1, version: 3, logoObjectKey: null };
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([existingOrg]) }) }),
    };
    const ctxFactory = {
      create: () => ({
        db: { raw: db },
        events: { publish: vi.fn() },
        audit: { log: vi.fn() },
      }),
    } as never;

    const app: FastifyInstance = Fastify({ logger: false });
    await app.register(multipart);
    await organizationRoutes(app, ctxFactory, FAKE_MINIO_CONFIG);

    const token = await makeToken(['ORG_SETTINGS_EDIT']);
    const { body, contentType } = buildMultipart({
      filename: 'logo.pdf',
      contentType: 'application/pdf',
      content: '%PDF-1.4',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/organization/logo/upload',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      payload: body,
    });

    expect(res.statusCode).toBe(422);
    expect(storageUploadMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /organization/logo redirects to a freshly-signed URL', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ logoObjectKey: 'tenants/1/logo/123-logo.png' }]),
        }),
      }),
    };
    const ctxFactory = {
      create: () => ({ db: { raw: db }, events: { publish: vi.fn() }, audit: { log: vi.fn() } }),
    } as never;

    const app: FastifyInstance = Fastify({ logger: false });
    await organizationRoutes(app, ctxFactory, FAKE_MINIO_CONFIG);

    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/organization/logo',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://minio.local/signed-logo-url');
    expect(storageSignedUrlMock).toHaveBeenCalledWith('tenants/1/logo/123-logo.png');
    await app.close();
  });

  it('GET /organization/logo returns 404 when no logo is set', async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ logoObjectKey: null }]) }) }),
    };
    const ctxFactory = {
      create: () => ({ db: { raw: db }, events: { publish: vi.fn() }, audit: { log: vi.fn() } }),
    } as never;

    const app: FastifyInstance = Fastify({ logger: false });
    await organizationRoutes(app, ctxFactory, FAKE_MINIO_CONFIG);

    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/organization/logo',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
