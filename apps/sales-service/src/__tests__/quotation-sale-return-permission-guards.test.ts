// QA session (2026-07-12) -- requireAnyPermission guard tests.
//
// GET /quotations, POST /quotations, GET /sale-returns, POST /sale-returns, and the
// credit-note apply/refund routes used to check only a broad INVOICE-family or PAYMENT_CREATE
// fallback, leaving the purpose-built QUOTATION, SALE_RETURN, and CREDIT_NOTE_ADJUST constants
// dead (granted to roles in role-defaults.ts, checked nowhere). Fixed with
// requireAnyPermission([granular, fallback]) so both keep working -- a caller holding ONLY the
// granular constant (no fallback) must now succeed, and a caller holding neither must still be
// rejected.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  quotations: {},
  quotationLines: {},
  saleReturns: {},
  creditNotes: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  desc: vi.fn(() => '__desc__'),
  eq: vi.fn(() => '__eq__'),
  ilike: vi.fn(() => '__ilike__'),
  or: vi.fn(() => '__or__'),
  sql: vi.fn(() => '__sql__'),
}));

import { quotationRoutes } from '../api/quotation.routes.js';
import { saleReturnRoutes } from '../api/sale-return.routes.js';

const TEST_ISSUER = 'erp-test';
const TEST_TTL = 900;
let privateKey: KeyLike;

const mockCtxFactory = {
  create: () => ({
    db: { raw: {} as never, transaction: vi.fn() },
    cache: { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() },
    events: { publish: vi.fn() },
    audit: { log: vi.fn() },
  }),
} as never;

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'test@erp.local', roles: [], permissions })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer(TEST_ISSUER)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + TEST_TTL)
    .sign(privateKey);
}

beforeAll(async () => {
  const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(privPem, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pubPem;
});

describe('GET /quotations — requireAnyPermission([QUOTATION_VIEW, INVOICE_VIEW])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await quotationRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/quotations',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with only QUOTATION_VIEW (no INVOICE_VIEW) — the constant now actually works', async () => {
    const token = await makeToken([PERMISSIONS.QUOTATION_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/quotations',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('does not 403 a caller with only the legacy INVOICE_VIEW fallback — no regression', async () => {
    const token = await makeToken([PERMISSIONS.INVOICE_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/quotations',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('POST /quotations — requireAnyPermission([QUOTATION_CREATE, INVOICE_CREATE])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await quotationRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'POST',
      url: '/quotations',
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with only QUOTATION_CREATE', async () => {
    const token = await makeToken([PERMISSIONS.QUOTATION_CREATE]);
    const res = await app.inject({
      method: 'POST',
      url: '/quotations',
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('GET /sale-returns — requireAnyPermission([SALE_RETURN_VIEW, INVOICE_VIEW])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await saleReturnRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/sale-returns',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with only SALE_RETURN_VIEW', async () => {
    const token = await makeToken([PERMISSIONS.SALE_RETURN_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/sale-returns',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('POST /sale-returns — requireAnyPermission([SALE_RETURN_CREATE, INVOICE_CANCEL])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await saleReturnRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'POST',
      url: '/sale-returns',
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with only SALE_RETURN_CREATE — CASHIER is granted this but never had INVOICE_CANCEL, so it was unreachable before this fix', async () => {
    const token = await makeToken([PERMISSIONS.SALE_RETURN_CREATE]);
    const res = await app.inject({
      method: 'POST',
      url: '/sale-returns',
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('POST /credit-notes/:id/apply — requireAnyPermission([CREDIT_NOTE_ADJUST, PAYMENT_CREATE])', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await saleReturnRoutes(app, mockCtxFactory);
  });
  afterAll(() => app.close());

  it('403s a caller with neither permission', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'POST',
      url: '/credit-notes/1/apply',
      headers: { Authorization: `Bearer ${token}` },
      payload: { invoiceId: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('does not 403 a caller with only CREDIT_NOTE_ADJUST', async () => {
    const token = await makeToken([PERMISSIONS.CREDIT_NOTE_ADJUST]);
    const res = await app.inject({
      method: 'POST',
      url: '/credit-notes/1/apply',
      headers: { Authorization: `Bearer ${token}` },
      payload: { invoiceId: 1 },
    });
    expect(res.statusCode).not.toBe(403);
  });
});
