/* global process */
// PG-013 — GET /organization used to return GSTIN/PAN/bank account details to any
// authenticated user regardless of role. Fix: strip those fields unless the caller
// holds ORGANIZATION_VIEW, while leaving the rest of the response (org name, theme
// config, etc.) available to every authenticated user — TenantThemeSync calls this
// endpoint for every logged-in session to sync branding, so it can't be permission-gated
// wholesale without breaking branding for non-admin roles.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';

vi.mock('@erp/db', () => ({
  organizationSettings: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
}));

// PG-012 (tenant-suspension enforcement) added an assertTenantActive() call inside
// authenticate() — irrelevant to this PG-013 field-authorization test and requires DB
// wiring this suite doesn't set up, so it's stubbed to a no-op here.
vi.mock('@erp/sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, assertTenantActive: vi.fn().mockResolvedValue(undefined) };
});

import { organizationRoutes } from '../api/organization.routes.js';

const FAKE_ORG = {
  id: 1,
  tenantId: 1,
  orgName: 'Acme Retail',
  legalName: 'Acme Retail Pvt Ltd',
  gstin: '27AAAAA0000A1Z5',
  pan: 'AAAAA0000A',
  tan: 'AAAA00000A',
  cin: 'U12345MH2020PTC000000',
  logoUrl: null,
  address: null,
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  fiscalYearStart: '04-01',
  dateFormat: 'DD/MM/YYYY',
  country: 'IN',
  language: 'en',
  bankDetails: { bankName: 'Test Bank', accountNumber: '000111222333', ifscCode: 'TEST0001', upiVpa: 'acme@upi' },
  invoiceFooter: null,
  termsAndConditions: null,
  themeConfig: { brandPrimary: '#4f46e5' },
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  createdBy: 1,
  updatedBy: null,
  version: 0,
};

const mockCtxFactory = {
  create: () => ({
    db: {
      raw: {
        select: () => ({ from: () => ({ where: () => Promise.resolve([FAKE_ORG]) }) }),
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

describe('PG-013 — GET /organization field-level authorization', () => {
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
    await organizationRoutes(app, mockCtxFactory);
  });

  it('a caller without ORGANIZATION_VIEW gets orgName/theme but not GSTIN/PAN/bank details', async () => {
    const token = await makeToken(['INVOICE_VIEW']);
    const res = await app.inject({
      method: 'GET',
      url: '/organization',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.orgName).toBe('Acme Retail');
    expect(body.data.themeConfig).toEqual({ brandPrimary: '#4f46e5' });
    expect(body.data.gstin).toBeUndefined();
    expect(body.data.pan).toBeUndefined();
    expect(body.data.tan).toBeUndefined();
    expect(body.data.cin).toBeUndefined();
    expect(body.data.bankDetails).toBeUndefined();
  });

  it('a caller with ORGANIZATION_VIEW gets the full record including bank details', async () => {
    const token = await makeToken(['ORGANIZATION_VIEW']);
    const res = await app.inject({
      method: 'GET',
      url: '/organization',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.gstin).toBe('27AAAAA0000A1Z5');
    expect(body.data.bankDetails.accountNumber).toBe('000111222333');
  });

  it('an unauthenticated request gets 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/organization' });
    expect(res.statusCode).toBe(401);
  });
});
