// Phase 2B (INVENTORY_BATCH capability) — POST/PUT /items gate the fefoEnabled: true write
// path behind requireCapability('INVENTORY_BATCH') + PERMISSIONS.BATCH_CONFIGURE, checked
// in-handler (not a preHandler) since the field is optional and most item writes never touch
// it. Mirrors auth-service's users-me-capabilities.test.ts (mock isCapabilityEnabled directly)
// and the warehouse-adjustment-transfer-permission-guards.test.ts route-injection style —
// these are pure authorization-branch tests, not business-logic tests, so a mocked
// isCapabilityEnabled/checkPermission is the right tool (real-DB FEFO ordering behavior is
// covered separately by the *-fefo.test.ts integration suite).
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';
import type * as ErpSdk from '@erp/sdk';
import type * as ErpLogger from '@erp/logger';

const { isCapabilityEnabledMock, incMock } = vi.hoisted(() => ({
  isCapabilityEnabledMock: vi.fn<(key: string, tenantId: number) => Promise<boolean>>(),
  incMock: vi.fn(),
}));

// Keeps verifyAccessToken/checkPermission/assertTenantActive real (pure/no-DB-required when
// initTenantStatusEnforcement() was never called, see tenantStatus.ts) so `authenticate` and
// `requirePermission` behave exactly as in production; only isCapabilityEnabled is
// test-controlled, since that's the one thing these tests need to drive per-case.
vi.mock('@erp/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpSdk>();
  return {
    ...actual,
    isUniqueConstraintViolation: () => false,
    isCapabilityEnabled: isCapabilityEnabledMock,
  };
});

vi.mock('@erp/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpLogger>();
  return { ...actual, erpCapabilityCheckDeniedTotal: { inc: incMock } };
});

vi.mock('@erp/db', () => ({
  items: { __name: 'items' },
  itemVariants: { __name: 'itemVariants' },
  itemsHistory: { __name: 'itemsHistory' },
  priceLists: { __name: 'priceLists' },
  priceListItems: { __name: 'priceListItems' },
  inventoryLedger: { __name: 'inventoryLedger' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  isNull: vi.fn(() => '__isNull__'),
  or: vi.fn(() => '__or__'),
  ilike: vi.fn(() => '__ilike__'),
  sql: vi.fn(() => '__sql__'),
  getTableColumns: vi.fn(() => ({})),
}));

import { itemRoutes } from '../api/item.routes.js';

let privateKey: KeyLike;

// Terminal chain node: awaitable (resolves `result`) AND still chainable via `.returning()` —
// covers both `insert(...).values(...)` (awaited directly, no .returning() in the
// itemsHistory-archive call) and `insert(...).values(...).returning()` (the items row itself).
function terminal(result: unknown) {
  return {
    then: (resolve: (v: unknown) => void) => resolve(result),
    returning: vi.fn(() => Promise.resolve(result)),
  };
}

function makeDbRaw(opts: { selectResult?: unknown[]; writeResult?: unknown[] }) {
  const raw: Record<string, unknown> = {};
  raw['select'] = vi.fn(() => raw);
  raw['from'] = vi.fn(() => raw);
  // Doubles as both a terminal (select().from().where(), awaited directly) and a link before
  // .returning() (update().set().where().returning()) — .returning() here intentionally
  // resolves selectResult too (not writeResult); good enough since these tests only assert
  // status codes, never response body content, for the PUT-allowed cases that reach this far.
  raw['where'] = vi.fn(() => terminal(opts.selectResult ?? []));
  raw['insert'] = vi.fn(() => raw);
  raw['update'] = vi.fn(() => raw);
  raw['set'] = vi.fn(() => raw);
  raw['values'] = vi.fn(() => terminal(opts.writeResult ?? []));
  return raw;
}

function makeCtxFactory(opts: { selectResult?: unknown[]; writeResult?: unknown[] }) {
  const dbRaw = makeDbRaw(opts);
  const ctx = {
    db: {
      raw: dbRaw,
      transaction: vi.fn(async (fn: (trx: { raw: unknown }) => Promise<void>) => {
        await fn({ raw: dbRaw });
      }),
    },
    cache: { del: vi.fn(), invalidate: vi.fn() },
    events: { publish: vi.fn() },
    audit: { log: vi.fn() },
  };
  return {
    create: () => ctx,
    rawDb: {},
    getRedis: () => ({}),
  } as never;
}

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({
    tenantId: 1,
    email: 'test@erp.local',
    roles: [],
    permissions,
    branchIds: [],
  })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer('erp-auth-service')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 900)
    .sign(privateKey);
}

const VALID_ITEM_BODY = {
  name: 'Test Item',
  unitId: 1,
  hsnCode: '1234',
  gstRate: 5,
};

beforeAll(async () => {
  const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(privPem, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pubPem;
});

afterEach(() => {
  isCapabilityEnabledMock.mockReset();
  incMock.mockReset();
});

async function buildApp(ctxFactory: ReturnType<typeof makeCtxFactory>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await itemRoutes(app, ctxFactory);
  return app;
}

describe('POST /items — fefoEnabled: true gating', () => {
  it('omitted fefoEnabled never calls isCapabilityEnabled (existing behavior unaffected)', async () => {
    const app = await buildApp(makeCtxFactory({ writeResult: [{ id: 1, tenantId: 1 }] }));
    const token = await makeToken([PERMISSIONS.ITEM_CREATE]);

    const res = await app.inject({
      method: 'POST',
      url: '/items',
      headers: { Authorization: `Bearer ${token}` },
      payload: VALID_ITEM_BODY,
    });

    expect(res.statusCode).toBe(201);
    expect(isCapabilityEnabledMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('fefoEnabled: true + capability disabled -> 403 CAPABILITY_NOT_ENABLED, never reaches insert', async () => {
    isCapabilityEnabledMock.mockResolvedValue(false);
    const app = await buildApp(makeCtxFactory({}));
    const token = await makeToken([PERMISSIONS.ITEM_CREATE, PERMISSIONS.BATCH_CONFIGURE]);

    const res = await app.inject({
      method: 'POST',
      url: '/items',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_ITEM_BODY, fefoEnabled: true },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: {
        code: 'CAPABILITY_NOT_ENABLED',
        message: "This tenant's plan does not include INVENTORY_BATCH.",
        details: { capabilityKey: 'INVENTORY_BATCH' },
      },
    });
    expect(incMock).toHaveBeenCalledWith({
      capability_key: 'INVENTORY_BATCH',
      outcome: 'disabled',
    });
    await app.close();
  });

  it('fefoEnabled: true + capability enabled but missing BATCH_CONFIGURE -> 403 FORBIDDEN', async () => {
    isCapabilityEnabledMock.mockResolvedValue(true);
    const app = await buildApp(makeCtxFactory({}));
    const token = await makeToken([PERMISSIONS.ITEM_CREATE]);

    const res = await app.inject({
      method: 'POST',
      url: '/items',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_ITEM_BODY, fefoEnabled: true },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'FORBIDDEN', message: `Missing permission: ${PERMISSIONS.BATCH_CONFIGURE}` },
    });
    await app.close();
  });

  it('fefoEnabled: true + capability resolution throws -> 503 CAPABILITY_RESOLUTION_UNAVAILABLE', async () => {
    isCapabilityEnabledMock.mockRejectedValue(new Error('Simulated DB/Redis failure'));
    const app = await buildApp(makeCtxFactory({}));
    const token = await makeToken([PERMISSIONS.ITEM_CREATE, PERMISSIONS.BATCH_CONFIGURE]);

    const res = await app.inject({
      method: 'POST',
      url: '/items',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_ITEM_BODY, fefoEnabled: true },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: {
        code: 'CAPABILITY_RESOLUTION_UNAVAILABLE',
        message: 'Unable to determine capability state. Please retry.',
        details: { capabilityKey: 'INVENTORY_BATCH' },
      },
    });
    expect(incMock).toHaveBeenCalledWith({
      capability_key: 'INVENTORY_BATCH',
      outcome: 'resolution_error',
    });
    await app.close();
  });

  it('fefoEnabled: true + capability enabled + BATCH_CONFIGURE granted -> 201, creates the item', async () => {
    isCapabilityEnabledMock.mockResolvedValue(true);
    const app = await buildApp(
      makeCtxFactory({ writeResult: [{ id: 1, tenantId: 1, fefoEnabled: true }] })
    );
    const token = await makeToken([PERMISSIONS.ITEM_CREATE, PERMISSIONS.BATCH_CONFIGURE]);

    const res = await app.inject({
      method: 'POST',
      url: '/items',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_ITEM_BODY, fefoEnabled: true },
    });

    expect(res.statusCode).toBe(201);
    await app.close();
  });
});

describe('PUT /items/:id — fefoEnabled transition gating', () => {
  it('resubmitting fefoEnabled: true on an item that is already fefoEnabled: true does not re-check the capability (D4: disabling later must not break existing config)', async () => {
    const app = await buildApp(
      makeCtxFactory({
        selectResult: [
          { id: 1, tenantId: 1, fefoEnabled: true, version: 0, salePrice: '0', purchasePrice: '0' },
        ],
        writeResult: [{ id: 1, tenantId: 1, fefoEnabled: true, version: 1 }],
      })
    );
    // No BATCH_CONFIGURE, no INVENTORY_BATCH resolution stub — would 403/throw if the check ran.
    const token = await makeToken([PERMISSIONS.ITEM_EDIT]);

    const res = await app.inject({
      method: 'PUT',
      url: '/items/1',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_ITEM_BODY, fefoEnabled: true, version: 0 },
    });

    expect(res.statusCode).toBe(200);
    expect(isCapabilityEnabledMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('flipping fefoEnabled false -> true is gated the same as POST (403 when capability disabled)', async () => {
    isCapabilityEnabledMock.mockResolvedValue(false);
    const app = await buildApp(
      makeCtxFactory({
        selectResult: [
          {
            id: 1,
            tenantId: 1,
            fefoEnabled: false,
            version: 0,
            salePrice: '0',
            purchasePrice: '0',
          },
        ],
      })
    );
    const token = await makeToken([PERMISSIONS.ITEM_EDIT, PERMISSIONS.BATCH_CONFIGURE]);

    const res = await app.inject({
      method: 'PUT',
      url: '/items/1',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_ITEM_BODY, fefoEnabled: true, version: 0 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'CAPABILITY_NOT_ENABLED' } });
    await app.close();
  });

  it('flipping fefoEnabled true -> false never checks the capability (turning off never gated)', async () => {
    const app = await buildApp(
      makeCtxFactory({
        selectResult: [
          { id: 1, tenantId: 1, fefoEnabled: true, version: 0, salePrice: '0', purchasePrice: '0' },
        ],
        writeResult: [{ id: 1, tenantId: 1, fefoEnabled: false, version: 1 }],
      })
    );
    const token = await makeToken([PERMISSIONS.ITEM_EDIT]);

    const res = await app.inject({
      method: 'PUT',
      url: '/items/1',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_ITEM_BODY, fefoEnabled: false, version: 0 },
    });

    expect(res.statusCode).toBe(200);
    expect(isCapabilityEnabledMock).not.toHaveBeenCalled();
    await app.close();
  });
});
