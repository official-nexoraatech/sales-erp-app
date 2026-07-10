/**
 * PG-007 — DLQ replay actually republishes to Kafka via OutboxRelayWorker.publishRaw()
 * instead of only flipping a status column.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';
import type { OutboxRelayWorker } from '../outbox/OutboxRelayWorker.js';

// ── Module mocks ──────────────────────────────────────────────────────────

interface FakeDlqRow {
  id: number;
  topic: string;
  status: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  retryCount: number;
}

let rows: FakeDlqRow[] = [];

vi.mock('@erp/db', () => ({
  dlqItems: {
    id: 'id',
    topic: 'topic',
    status: 'status',
    payload: 'payload',
    headers: 'headers',
    retryCount: 'retryCount',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => '__and__'),
  eq: vi.fn(() => '__eq__'),
  sql: vi.fn(() => '__sql__'),
  desc: vi.fn(() => '__desc__'),
}));

// ── Route import (after mocks) ────────────────────────────────────────────

import { dlqRoutes } from '../api/dlq.routes.js';

// ── Test constants ────────────────────────────────────────────────────────

const TEST_TTL = 900;
let privateKey: KeyLike;

// The route always scopes each update to a single row via eq(dlqItems.id, row.id),
// but eq() is mocked to a constant, so this fake db just applies each patch to the
// first still-PENDING row — the route processes rows one at a time and awaits each
// update before moving to the next, so this stays correct across multiple rows.
function buildFakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rows.filter((r) => r.status === 'PENDING')),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          const target = rows.find((r) => r.status === 'PENDING');
          if (target) Object.assign(target, patch);
          return Promise.resolve();
        },
      }),
    }),
  };
}

let dbHandle: ReturnType<typeof buildFakeDb>;

const mockCtxFactory = {
  create: () => ({
    db: { raw: dbHandle, transaction: vi.fn() },
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

async function buildApp(worker: OutboxRelayWorker): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  dbHandle = buildFakeDb();
  await dlqRoutes(app, mockCtxFactory, worker);
  return app;
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

afterEach(() => {
  rows = [];
});

// ═══════════════════════════════════════════════════════════════════════════

describe('POST /admin/dlq/:topic/replay', () => {
  it('publishes each PENDING row and marks it REPLAYED when publish succeeds', async () => {
    rows = [
      { id: 1, topic: 'erp.test.event', status: 'PENDING', payload: { foo: 'bar' }, headers: { a: 'b' }, retryCount: 0 },
    ];

    const publishRaw = vi.fn().mockResolvedValue(undefined);
    const worker = { publishRaw } as unknown as OutboxRelayWorker;
    const app = await buildApp(worker);

    const token = await makeToken([PERMISSIONS.DLQ_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/dlq/erp.test.event/replay',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { replayed: number; failed: number; topic: string } };
    expect(body.data).toEqual({ replayed: 1, failed: 0, topic: 'erp.test.event' });
    expect(publishRaw).toHaveBeenCalledWith('erp.test.event', '1', { foo: 'bar' }, { a: 'b' });
    expect(rows[0]?.status).toBe('REPLAYED');

    await app.close();
  });

  it('leaves a row PENDING with retryCount incremented when publish throws', async () => {
    rows = [
      { id: 2, topic: 'erp.test.event', status: 'PENDING', payload: {}, headers: {}, retryCount: 0 },
    ];

    const publishRaw = vi.fn().mockRejectedValue(new Error('Kafka broker unavailable'));
    const worker = { publishRaw } as unknown as OutboxRelayWorker;
    const app = await buildApp(worker);

    const token = await makeToken([PERMISSIONS.DLQ_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/dlq/erp.test.event/replay',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { replayed: number; failed: number; topic: string } };
    expect(body.data).toEqual({ replayed: 0, failed: 1, topic: 'erp.test.event' });
    expect(rows[0]?.status).toBe('PENDING');
    expect(rows[0]?.retryCount).toBe(1);

    await app.close();
  });

  it('partial failure: one row replays, one stays PENDING', async () => {
    rows = [
      { id: 3, topic: 'erp.test.event', status: 'PENDING', payload: { n: 1 }, headers: {}, retryCount: 0 },
      { id: 4, topic: 'erp.test.event', status: 'PENDING', payload: { n: 2 }, headers: {}, retryCount: 2 },
    ];

    const publishRaw = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Kafka broker unavailable'));
    const worker = { publishRaw } as unknown as OutboxRelayWorker;
    const app = await buildApp(worker);

    const token = await makeToken([PERMISSIONS.DLQ_MANAGE]);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/dlq/erp.test.event/replay',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { replayed: number; failed: number; topic: string } };
    expect(body.data).toEqual({ replayed: 1, failed: 1, topic: 'erp.test.event' });

    const replayedRow = rows.find((r) => r.status === 'REPLAYED');
    const pendingRow = rows.find((r) => r.status === 'PENDING');
    expect(replayedRow).toBeDefined();
    expect(pendingRow?.retryCount).toBe(3);

    await app.close();
  });
});
