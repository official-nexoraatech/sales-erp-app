/**
 * ES-07 — Permission Guard Tests: sales-service
 * Covers: CREDIT_LIMIT_OVERRIDE, PRICE_FLOOR_OVERRIDE, EXPORT_CUSTOMER_DATA
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

// ── Module mocks (hoisted before imports by Vitest) ───────────────────────

vi.mock('@erp/db', () => ({
  invoices: {},
  invoiceHistory: {},
  customers: {},
  customersHistory: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  desc: vi.fn(() => '__desc__'),
  eq: vi.fn(() => '__eq__'),
  ilike: vi.fn(() => '__ilike__'),
  sql: vi.fn(() => '__sql__'),
  or: vi.fn(() => '__or__'),
  isNull: vi.fn(() => '__isNull__'),
}));

// ── Route imports (after mocks) ───────────────────────────────────────────

import { invoiceRoutes } from '../api/invoice.routes.js';
import { customerRoutes } from '../api/customer.routes.js';

// ── Test constants ────────────────────────────────────────────────────────

const TEST_ISSUER = 'erp-test';
const TEST_TTL = 900;

let privateKey: KeyLike;

// ── Mock PlatformContextFactory ───────────────────────────────────────────

const mockCtxFactory = {
  create: () => ({
    db: { raw: {} as never, transaction: vi.fn() },
    cache: { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() },
    events: { publish: vi.fn() },
    audit: { log: vi.fn() },
  }),
} as never;

// ── Helpers ───────────────────────────────────────────────────────────────

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

const VALID_INVOICE_BODY = {
  customerId: 1,
  branchId: 1,
  warehouseId: 1,
  placeOfSupply: 'MH',
  sellerStateCode: 'MH',
  invoiceDate: '2026-07-02T00:00:00.000Z',
  dueDate: '2026-07-30T00:00:00.000Z',
  lines: [{ itemId: 1, quantity: 1, unitPrice: 100, gstRate: 18 }],
};

// ── Setup ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(privPem, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pubPem;
});

// ═══════════════════════════════════════════════════════════════════════════
// CREDIT_LIMIT_OVERRIDE
// ═══════════════════════════════════════════════════════════════════════════

describe('CREDIT_LIMIT_OVERRIDE guard on POST /invoices', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await invoiceRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it('returns 403 when user lacks CREDIT_LIMIT_OVERRIDE and sends overrideCreditLimit:true', async () => {
    const token = await makeToken([PERMISSIONS.INVOICE_CREATE]);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_INVOICE_BODY, overrideCreditLimit: true },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toMatch(/CREDIT_LIMIT_OVERRIDE/);
  });

  it('does not return 403 when user has CREDIT_LIMIT_OVERRIDE and sends overrideCreditLimit:true', async () => {
    const token = await makeToken([PERMISSIONS.INVOICE_CREATE, PERMISSIONS.CREDIT_LIMIT_OVERRIDE]);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_INVOICE_BODY, overrideCreditLimit: true },
    });

    expect(res.statusCode).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PRICE_FLOOR_OVERRIDE
// ═══════════════════════════════════════════════════════════════════════════

describe('PRICE_FLOOR_OVERRIDE guard on POST /invoices', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await invoiceRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it('returns 403 when user lacks PRICE_FLOOR_OVERRIDE and sends overridePriceFloor:true', async () => {
    const token = await makeToken([PERMISSIONS.INVOICE_CREATE]);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_INVOICE_BODY, overridePriceFloor: true },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toMatch(/PRICE_FLOOR_OVERRIDE/);
  });

  it('does not return 403 when user has PRICE_FLOOR_OVERRIDE and sends overridePriceFloor:true', async () => {
    const token = await makeToken([PERMISSIONS.INVOICE_CREATE, PERMISSIONS.PRICE_FLOOR_OVERRIDE]);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_INVOICE_BODY, overridePriceFloor: true },
    });

    expect(res.statusCode).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT_CUSTOMER_DATA
// ═══════════════════════════════════════════════════════════════════════════

describe('EXPORT_CUSTOMER_DATA guard on GET /customers/export', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await customerRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it('returns 403 when user lacks EXPORT_CUSTOMER_DATA', async () => {
    const token = await makeToken([PERMISSIONS.CUSTOMER_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/customers/export',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toMatch(/EXPORT_CUSTOMER_DATA/);
  });

  it('returns 202 when user has EXPORT_CUSTOMER_DATA', async () => {
    const token = await makeToken([PERMISSIONS.EXPORT_CUSTOMER_DATA]);

    const res = await app.inject({
      method: 'GET',
      url: '/customers/export',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin role — all new guarded routes accessible
// ═══════════════════════════════════════════════════════════════════════════

describe('Admin role — access to all new guarded routes', () => {
  let invoiceApp: FastifyInstance;
  let customerApp: FastifyInstance;

  beforeAll(async () => {
    invoiceApp = Fastify({ logger: false });
    await invoiceRoutes(invoiceApp, mockCtxFactory);

    customerApp = Fastify({ logger: false });
    await customerRoutes(customerApp, mockCtxFactory);
  });

  afterAll(() => Promise.all([invoiceApp.close(), customerApp.close()]));

  it('admin can override credit limit (not 403)', async () => {
    const token = await makeToken([
      PERMISSIONS.INVOICE_CREATE,
      PERMISSIONS.CREDIT_LIMIT_OVERRIDE,
      PERMISSIONS.PRICE_FLOOR_OVERRIDE,
      PERMISSIONS.EXPORT_CUSTOMER_DATA,
    ]);

    const res = await invoiceApp.inject({
      method: 'POST',
      url: '/invoices',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_INVOICE_BODY, overrideCreditLimit: true },
    });

    expect(res.statusCode).not.toBe(403);
  });

  it('admin can override price floor (not 403)', async () => {
    const token = await makeToken([
      PERMISSIONS.INVOICE_CREATE,
      PERMISSIONS.PRICE_FLOOR_OVERRIDE,
    ]);

    const res = await invoiceApp.inject({
      method: 'POST',
      url: '/invoices',
      headers: { Authorization: `Bearer ${token}` },
      payload: { ...VALID_INVOICE_BODY, overridePriceFloor: true },
    });

    expect(res.statusCode).not.toBe(403);
  });

  it('admin can export customer data (202)', async () => {
    const token = await makeToken([PERMISSIONS.EXPORT_CUSTOMER_DATA]);

    const res = await customerApp.inject({
      method: 'GET',
      url: '/customers/export',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(202);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// No regression — regular invoice create without override flags
// ═══════════════════════════════════════════════════════════════════════════

describe('No regression — invoice create without override flags', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await invoiceRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it('CASHIER can create invoice without override flags (does not get 403)', async () => {
    const token = await makeToken([PERMISSIONS.INVOICE_CREATE]);

    const res = await app.inject({
      method: 'POST',
      url: '/invoices',
      headers: { Authorization: `Bearer ${token}` },
      payload: VALID_INVOICE_BODY,
    });

    // 403 would mean the guard incorrectly blocked a normal invoice create
    expect(res.statusCode).not.toBe(403);
  });
});
