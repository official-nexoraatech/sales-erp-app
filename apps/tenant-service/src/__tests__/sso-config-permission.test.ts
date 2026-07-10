// PG-020 (Session A) — SSO configuration is an admin-only surface (unlike GET
// /organization, which is authenticate-only with field stripping): every route here must
// require SSO_CONFIG_MANAGE, since issuer URL/client ID are not reference data any
// authenticated user needs, and the client secret must never leave the server encrypted or
// otherwise.

import { describe, it, expect, beforeAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';

vi.mock('@erp/db', () => ({
  ssoConfigs: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => '__eq__'),
}));

vi.mock('@erp/utils', () => ({
  encryptField: vi.fn(() => 'iv:tag:ciphertext'),
}));

vi.mock('@erp/config', () => ({
  requireEnv: vi.fn(() => '0'.repeat(64)),
}));

vi.mock('@erp/sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, assertTenantActive: vi.fn().mockResolvedValue(undefined) };
});

import { ssoConfigRoutes } from '../api/sso-config.routes.js';

const FAKE_CONFIG = {
  id: 1,
  tenantId: 1,
  provider: 'OKTA',
  issuerUrl: 'https://acme.okta.com',
  clientId: 'abc123',
  clientSecretEncrypted: 'iv:tag:ciphertext',
  enabled: true,
  bypassLocalMfa: false,
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
        select: () => ({ from: () => ({ where: () => Promise.resolve([FAKE_CONFIG]) }) }),
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

describe('PG-020 — GET /sso-config permission gating', () => {
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
    await ssoConfigRoutes(app, mockCtxFactory);
  });

  it('a caller without SSO_CONFIG_MANAGE gets 403', async () => {
    const token = await makeToken(['INVOICE_VIEW']);
    const res = await app.inject({
      method: 'GET',
      url: '/sso-config',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a caller with SSO_CONFIG_MANAGE gets the config but never the raw/encrypted secret', async () => {
    const token = await makeToken(['SSO_CONFIG_MANAGE']);
    const res = await app.inject({
      method: 'GET',
      url: '/sso-config',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.issuerUrl).toBe('https://acme.okta.com');
    expect(body.data.hasClientSecret).toBe(true);
    expect(body.data.clientSecretEncrypted).toBeUndefined();
  });

  it('an unauthenticated request gets 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/sso-config' });
    expect(res.statusCode).toBe(401);
  });

  it('PUT without SSO_CONFIG_MANAGE gets 403', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'PUT',
      url: '/sso-config',
      headers: { Authorization: `Bearer ${token}` },
      payload: { provider: 'OKTA', issuerUrl: 'https://acme.okta.com', clientId: 'abc', enabled: true, bypassLocalMfa: false },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT rejects a non-https issuer URL', async () => {
    const token = await makeToken(['SSO_CONFIG_MANAGE']);
    const res = await app.inject({
      method: 'PUT',
      url: '/sso-config',
      headers: { Authorization: `Bearer ${token}` },
      payload: { provider: 'OKTA', issuerUrl: 'http://acme.okta.com', clientId: 'abc', clientSecret: 'shh', enabled: true, bypassLocalMfa: false },
    });
    expect(res.statusCode).toBe(422);
  });

  it('DELETE without SSO_CONFIG_MANAGE gets 403', async () => {
    const token = await makeToken([]);
    const res = await app.inject({
      method: 'DELETE',
      url: '/sso-config',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
