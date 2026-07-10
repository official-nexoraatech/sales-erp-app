/* global process */
// PG-013 — GET /branches used to return GSTIN/address/phone/email to any authenticated
// user regardless of role. Fix: strip those fields unless the caller holds BRANCH_VIEW,
// while leaving id/name/code/isHeadOffice/isActive available to every authenticated user —
// invoice/PO/customer forms fetch this endpoint (gated on their own feature permission, not
// BRANCH_VIEW) just to populate a branch dropdown, so it can't be permission-gated wholesale
// without breaking those. Mirrors the same pattern already used on GET /organization.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';

vi.mock('@erp/db', () => ({
  branches: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  isNull: vi.fn(() => '__isNull__'),
  or: vi.fn(() => '__or__'),
  ilike: vi.fn(() => '__ilike__'),
  sql: Object.assign(vi.fn(() => '__sql__'), { raw: vi.fn() }),
}));

// PG-012 (tenant-suspension enforcement) added an assertTenantActive() call inside
// authenticate() — irrelevant to this PG-013 field-authorization test and requires DB
// wiring this suite doesn't set up, so it's stubbed to a no-op here.
vi.mock('@erp/sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, assertTenantActive: vi.fn().mockResolvedValue(undefined) };
});

import { branchRoutes } from '../api/branch.routes.js';

const FAKE_BRANCH = {
  id: 1,
  tenantId: 1,
  name: 'Main Store',
  code: 'MAIN',
  address: { line1: '1 MG Road', city: 'Pune', state: 'MH', pincode: '411001' },
  phone: '9999999999',
  email: 'main@acme.test',
  gstin: '27AAAAA0000A1Z5',
  isHeadOffice: true,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  createdBy: 1,
  updatedBy: null,
  deletedAt: null,
  deletedBy: null,
  version: 0,
};

const mockCtxFactory = {
  create: () => ({
    db: {
      raw: {
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([FAKE_BRANCH]),
            limit: () => ({ offset: () => Promise.resolve([FAKE_BRANCH]) }),
          }),
        }),
      },
    },
    events: { publish: vi.fn() },
  }),
} as never;

let privateKey: KeyLike;

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'test@erp.local', roles: [], permissions })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 900)
    .sign(privateKey);
}

describe('PG-013 — GET /branches field-level authorization', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { privateKey: priv, publicKey: pub } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = await importPKCS8(priv, 'RS256');
    process.env['JWT_PUBLIC_KEY'] = pub;

    app = Fastify({ logger: false });
    await branchRoutes(app, mockCtxFactory);
  });

  it('a caller without BRANCH_VIEW gets id/name/code but not GSTIN/address/phone/email', async () => {
    const token = await makeToken(['INVOICE_VIEW']);
    const res = await app.inject({
      method: 'GET',
      url: '/branches',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const branch = body.data.content[0];
    expect(branch.name).toBe('Main Store');
    expect(branch.code).toBe('MAIN');
    expect(branch.isHeadOffice).toBe(true);
    expect(branch.gstin).toBeUndefined();
    expect(branch.address).toBeUndefined();
    expect(branch.phone).toBeUndefined();
    expect(branch.email).toBeUndefined();
  });

  it('a caller with BRANCH_VIEW gets the full record including GSTIN/address', async () => {
    const token = await makeToken(['BRANCH_VIEW']);
    const res = await app.inject({
      method: 'GET',
      url: '/branches',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const branch = body.data.content[0];
    expect(branch.gstin).toBe('27AAAAA0000A1Z5');
    expect(branch.address).toEqual(FAKE_BRANCH.address);
  });

  it('GET /branches/:id also strips sensitive fields for a caller without BRANCH_VIEW', async () => {
    const token = await makeToken(['INVOICE_VIEW']);
    const res = await app.inject({
      method: 'GET',
      url: '/branches/1',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.name).toBe('Main Store');
    expect(body.data.gstin).toBeUndefined();
  });

  it('an unauthenticated request gets 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/branches' });
    expect(res.statusCode).toBe(401);
  });
});
