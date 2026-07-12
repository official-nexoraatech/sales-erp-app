/**
 * PG-050 — GET /pos/sessions/active
 * Same real-Postgres, real-HTTP convention as sync-routes.integration.test.ts: a real DB
 * connection wrapped in a fake ctxFactory, route hit via app.inject(). Covers the three
 * behaviors the gap prompt's Testing section calls out: most-recent-OPEN-session-for-the-
 * caller, null when none exists, and isolation from other tenants/users.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { createDatabaseClient, posSessions, branches, warehouses } from '@erp/db';
import { eq } from 'drizzle-orm';
import { PERMISSIONS } from '@erp/types';
import { posRoutes } from '../api/pos.routes.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('PG-050 GET /pos/sessions/active — sales-service', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let app: FastifyInstance;
  let privateKey: KeyLike;
  const TENANT_A = 900_501 + Math.floor(Math.random() * 1000);
  const TENANT_B = TENANT_A + 1;
  let branchId: number;
  let warehouseId: number;

  const fakeCtxFactory = {
    create: ({ tenantId }: { tenantId: number }) => ({
      db: { raw: db, transaction: (fn: (tx: unknown) => unknown) => fn(db) },
      cache: { getJson: async () => null, setJson: async () => {} },
      events: { publish: async () => {} },
      audit: { log: async () => {} },
      tenantId,
    }),
  } as never;

  async function makeToken(
    userId: number,
    tenantId: number,
    branchIds: number[] = []
  ): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({
      tenantId,
      email: 'shift-test@erp.local',
      roles: [],
      permissions: [PERMISSIONS.POS_MANAGE],
      branchIds,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(String(userId))
      .setIssuer('erp-test')
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 900)
      .sign(privateKey);
  }

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });
    const { privateKey: privPem, publicKey: pubPem } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = await importPKCS8(privPem, 'RS256');
    process.env['JWT_PUBLIC_KEY'] = pubPem;

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TENANT_A,
        name: 'Shift Test Branch',
        code: 'SHB',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();
    branchId = branch!.id;
    const [warehouse] = await db
      .insert(warehouses)
      .values({
        tenantId: TENANT_A,
        branchId,
        name: 'Shift Test WH',
        code: 'SHWH',
        isActive: true,
        createdBy: 1,
      })
      .returning();
    warehouseId = warehouse!.id;

    app = Fastify({ logger: false });
    await posRoutes(app, fakeCtxFactory);
  });

  afterAll(async () => {
    await app.close();
    await db.delete(posSessions).where(eq(posSessions.tenantId, TENANT_A));
    await db.delete(posSessions).where(eq(posSessions.tenantId, TENANT_B));
    await db.delete(warehouses).where(eq(warehouses.tenantId, TENANT_A));
    await db.delete(branches).where(eq(branches.tenantId, TENANT_A));
  });

  it('returns null when the caller has no open session', async () => {
    const token = await makeToken(101, TENANT_A);
    const res = await app.inject({
      method: 'GET',
      url: '/pos/sessions/active',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown };
    expect(body.data).toBeNull();
  });

  it('returns the most recent OPEN session for the caller, ignoring older OPEN and CLOSED sessions', async () => {
    const userId = 102;
    await db.insert(posSessions).values([
      {
        tenantId: TENANT_A,
        branchId,
        warehouseId,
        sessionNumber: 'S-OLD-CLOSED',
        status: 'CLOSED',
        openedBy: userId,
        openingCash: '100',
        openedAt: new Date(Date.now() - 30_000),
      },
      {
        tenantId: TENANT_A,
        branchId,
        warehouseId,
        sessionNumber: 'S-OLDER-OPEN',
        status: 'OPEN',
        openedBy: userId,
        openingCash: '100',
        openedAt: new Date(Date.now() - 20_000),
      },
    ]);
    const [latest] = await db
      .insert(posSessions)
      .values({
        tenantId: TENANT_A,
        branchId,
        warehouseId,
        sessionNumber: 'S-LATEST-OPEN',
        status: 'OPEN',
        openedBy: userId,
        openingCash: '200',
        openedAt: new Date(),
      })
      .returning();

    const token = await makeToken(userId, TENANT_A);
    const res = await app.inject({
      method: 'GET',
      url: '/pos/sessions/active',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { id: number; sessionNumber: string } | null };
    expect(body.data?.id).toBe(latest!.id);
    expect(body.data?.sessionNumber).toBe('S-LATEST-OPEN');
  });

  it("never returns another user's or another tenant's open session", async () => {
    const otherUserId = 201;
    await db.insert(posSessions).values({
      tenantId: TENANT_A,
      branchId,
      warehouseId,
      sessionNumber: 'S-OTHER-USER',
      status: 'OPEN',
      openedBy: otherUserId,
      openingCash: '50',
    });
    await db.insert(posSessions).values({
      tenantId: TENANT_B,
      branchId,
      warehouseId,
      sessionNumber: 'S-OTHER-TENANT',
      status: 'OPEN',
      openedBy: 999,
      openingCash: '50',
    });

    const token = await makeToken(999, TENANT_A);
    const res = await app.inject({
      method: 'GET',
      url: '/pos/sessions/active',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown };
    expect(body.data).toBeNull();
  });
});
