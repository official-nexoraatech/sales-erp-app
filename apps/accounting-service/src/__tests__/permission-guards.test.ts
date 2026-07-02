/**
 * ES-07 — Permission Guard Tests: accounting-service
 * Covers: CANCEL_POSTED_JOURNAL
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

// ── Module mocks ──────────────────────────────────────────────────────────

vi.mock('@erp/db', () => ({
  journals: {},
  financialEntries: {},
  accounts: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  sql: vi.fn(() => '__sql__'),
}));

// ── Route imports ─────────────────────────────────────────────────────────

import { journalRoutes } from '../api/journal.routes.js';

// ── Test constants ────────────────────────────────────────────────────────

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
    .setIssuer('erp-test')
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

// ═══════════════════════════════════════════════════════════════════════════
// CANCEL_POSTED_JOURNAL
// ═══════════════════════════════════════════════════════════════════════════

describe('CANCEL_POSTED_JOURNAL guard on POST /journals/:id/reverse', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await journalRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it('returns 403 when user lacks CANCEL_POSTED_JOURNAL', async () => {
    const token = await makeToken([PERMISSIONS.JOURNAL_VIEW, PERMISSIONS.JOURNAL_CREATE]);

    const res = await app.inject({
      method: 'POST',
      url: '/journals/JRN-2026-001/reverse',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'Correction' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toMatch(/CANCEL_POSTED_JOURNAL/);
  });

  it('does not return 403 when user has CANCEL_POSTED_JOURNAL', async () => {
    const token = await makeToken([PERMISSIONS.CANCEL_POSTED_JOURNAL]);

    const res = await app.inject({
      method: 'POST',
      url: '/journals/JRN-2026-001/reverse',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'Correction' },
    });

    expect(res.statusCode).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// No regression — accountants can still create/view journals
// ═══════════════════════════════════════════════════════════════════════════

describe('No regression — accountant can create and view journals', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await journalRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it('returns 200 listing journals for user with JOURNAL_VIEW (not 403)', async () => {
    const token = await makeToken([PERMISSIONS.JOURNAL_VIEW]);

    const res = await app.inject({
      method: 'GET',
      url: '/journals',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).not.toBe(403);
  });

  it('does not block journal CREATE for user with JOURNAL_CREATE (not 403)', async () => {
    const token = await makeToken([PERMISSIONS.JOURNAL_CREATE]);

    const res = await app.inject({
      method: 'POST',
      url: '/journals',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        description: 'Test entry',
        lines: [
          { accountId: 1, debitAmount: 500, creditAmount: 0 },
          { accountId: 2, debitAmount: 0, creditAmount: 500 },
        ],
      },
    });

    expect(res.statusCode).not.toBe(403);
  });

  it('CANCEL_POSTED_JOURNAL guard blocks reversal for ACCOUNTANT lacking the permission', async () => {
    const token = await makeToken([PERMISSIONS.JOURNAL_VIEW, PERMISSIONS.JOURNAL_CREATE]);

    const res = await app.inject({
      method: 'POST',
      url: '/journals/JRN-REGRESS-001/reverse',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'Test regression' },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ACCOUNTANT_SUPERVISOR (has CANCEL_POSTED_JOURNAL) can reverse
// ═══════════════════════════════════════════════════════════════════════════

describe('Admin role — can reverse posted journals', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await journalRoutes(app, mockCtxFactory);
  });

  afterAll(() => app.close());

  it('admin (has CANCEL_POSTED_JOURNAL) is not blocked on reversal', async () => {
    const token = await makeToken([
      PERMISSIONS.JOURNAL_VIEW,
      PERMISSIONS.JOURNAL_CREATE,
      PERMISSIONS.CANCEL_POSTED_JOURNAL,
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/journals/JRN-ADMIN-001/reverse',
      headers: { Authorization: `Bearer ${token}` },
      payload: { reason: 'Admin correction' },
    });

    expect(res.statusCode).not.toBe(403);
  });
});
