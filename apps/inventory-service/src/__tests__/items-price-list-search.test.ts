// H-4 fix: a customer's assigned price list was stored (customers.priceListId) but never
// applied anywhere outside POS — back-office Invoice/Quotation item search always fell back to
// the item's flat salePrice. GET /items now accepts an optional priceListId query param and,
// only when present, LEFT JOINs price_list_items and returns COALESCE(priceListItems.salePrice,
// items.salePrice) — the exact same conditional-join pattern pos.routes.ts's
// /pos/items/search already uses. Every existing caller (no priceListId) must see the
// identical query shape as before — no join, no COALESCE.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import { PERMISSIONS } from '@erp/types';

vi.mock('@erp/db', () => ({
  items: {
    id: 'id',
    tenantId: 'tenant_id',
    deletedAt: 'deleted_at',
    name: 'name',
    itemCode: 'item_code',
    barcode: 'barcode',
    salePrice: 'sale_price',
  },
  itemVariants: {},
  itemsHistory: {},
  priceLists: {},
  priceListItems: {
    itemId: 'item_id',
    tenantId: 'tenant_id',
    priceListId: 'price_list_id',
    salePrice: 'sale_price',
  },
  inventoryLedger: {},
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ type: 'eq', col, val })),
  isNull: vi.fn((col: unknown) => ({ type: 'isNull', col })),
  or: vi.fn((...args: unknown[]) => ({ type: 'or', args })),
  ilike: vi.fn((col: unknown, val: unknown) => ({ type: 'ilike', col, val })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { raw: vi.fn() }
  ),
  getTableColumns: vi.fn((table: Record<string, unknown>) => ({ ...table })),
}));

import { itemRoutes } from '../api/item.routes.js';

let privateKey: KeyLike;

async function makeToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'test@erp.local', roles: [], permissions })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuer('erp-test')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 900)
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

// Mimics drizzle's mutating dynamic-query builder: every chain method returns the same
// object (so it can be called in any order/combination like the real query builder), and the
// chain itself is thenable, resolving once the terminal `.offset()` is reached.
function makeItemsQueryChain(rows: unknown[], leftJoinCalls: unknown[][]) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  chain['from'] = () => chain;
  chain['$dynamic'] = () => chain;
  chain['leftJoin'] = (...args: unknown[]) => {
    leftJoinCalls.push(args);
    return chain;
  };
  chain['where'] = () => chain;
  chain['limit'] = () => chain;
  chain['offset'] = () => Promise.resolve(rows);
  return chain;
}

function makeCtxFactory(rows: unknown[], leftJoinCalls: unknown[][]) {
  let selectCallCount = 0;
  return {
    create: () => ({
      db: {
        raw: {
          select: () => {
            selectCallCount += 1;
            // 1st select() = item rows (dynamic, possibly joined); 2nd = the count query
            // (plain, no join needed).
            if (selectCallCount % 2 === 1) return makeItemsQueryChain(rows, leftJoinCalls);
            return { from: () => ({ where: () => Promise.resolve([{ count: rows.length }]) }) };
          },
        },
      },
      cache: { getJson: vi.fn().mockResolvedValue(null), setJson: vi.fn() },
      events: { publish: vi.fn() },
      audit: { log: vi.fn() },
    }),
  } as never;
}

describe('GET /items — priceListId', () => {
  it('does not LEFT JOIN price_list_items when priceListId is omitted (no regression)', async () => {
    const leftJoinCalls: unknown[][] = [];
    const app = Fastify({ logger: false });
    await itemRoutes(
      app,
      makeCtxFactory([{ id: 1, name: 'Item A', salePrice: '100' }], leftJoinCalls)
    );

    const token = await makeToken([PERMISSIONS.ITEM_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/items?search=shirt',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(leftJoinCalls).toHaveLength(0);
    await app.close();
  });

  it('LEFT JOINs price_list_items when priceListId is provided', async () => {
    const leftJoinCalls: unknown[][] = [];
    const app = Fastify({ logger: false });
    await itemRoutes(
      app,
      makeCtxFactory([{ id: 1, name: 'Item A', salePrice: '90' }], leftJoinCalls)
    );

    const token = await makeToken([PERMISSIONS.ITEM_VIEW]);
    const res = await app.inject({
      method: 'GET',
      url: '/items?search=shirt&priceListId=5',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(leftJoinCalls).toHaveLength(1);
    await app.close();
  });
});
