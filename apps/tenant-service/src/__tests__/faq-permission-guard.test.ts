// FAQ content management — GET /public/faqs must work with no auth at all (it's public
// marketing content); every /admin/platform/faqs route must require PLATFORM_CONTENT_MANAGE.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPairSync } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyLike } from 'jose';
import type * as ErpTypes from '@erp/types';

vi.mock('@erp/db', () => ({
  faqItems: { __name: 'faqItems' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ __eq__: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ __and__: args })),
  asc: vi.fn((a: unknown) => ({ __asc__: a })),
}));

vi.mock('@erp/types', async (importOriginal) => {
  const actual = await importOriginal<typeof ErpTypes>();
  return {
    ...actual,
    PERMISSIONS: { ...actual.PERMISSIONS, PLATFORM_CONTENT_MANAGE: 'PLATFORM_CONTENT_MANAGE' },
  };
});

import { faqRoutes } from '../api/faq.routes.js';

let privateKey: KeyLike;

beforeAll(async () => {
  const { privateKey: priv, publicKey: pub } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKey = await importPKCS8(priv, 'RS256');
  process.env['JWT_PUBLIC_KEY'] = pub;
});

async function signToken(permissions: string[]): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ tenantId: 1, email: 'test@example.com', roles: [], permissions })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('1')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 900)
    .sign(privateKey);
}

const FAKE_FAQ = {
  id: 1,
  category: 'Getting Started',
  question: 'Q?',
  answer: 'A.',
  sortOrder: 0,
  isPublished: true,
  version: 0,
  createdBy: 0,
};

function makeFakeDb() {
  const chainable = {
    select: () => chainable,
    from: () => chainable,
    where: () => chainable,
    orderBy: () => Promise.resolve([FAKE_FAQ]),
    insert: () => chainable,
    values: () => chainable,
    update: () => chainable,
    set: () => chainable,
    delete: () => chainable,
    returning: () => Promise.resolve([FAKE_FAQ]),
    then: (resolve: (v: unknown) => void) => resolve([FAKE_FAQ]),
  };
  return chainable as never;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await faqRoutes(app, makeFakeDb());
  return app;
}

describe('GET /public/faqs — no auth required', () => {
  it('returns published FAQs with no Authorization header', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/public/faqs' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('/admin/platform/faqs — requirePermission(PLATFORM_CONTENT_MANAGE)', () => {
  it('GET without the permission → 403', async () => {
    const app = await buildApp();
    const token = await signToken([]);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/platform/faqs',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET with PLATFORM_CONTENT_MANAGE → 200', async () => {
    const app = await buildApp();
    const token = await signToken(['PLATFORM_CONTENT_MANAGE']);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/platform/faqs',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('POST without the permission → 403', async () => {
    const app = await buildApp();
    const token = await signToken([]);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/platform/faqs',
      headers: { Authorization: `Bearer ${token}` },
      payload: { category: 'x', question: 'q', answer: 'a', sortOrder: 0, isPublished: true },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('POST with PLATFORM_CONTENT_MANAGE → 201', async () => {
    const app = await buildApp();
    const token = await signToken(['PLATFORM_CONTENT_MANAGE']);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/platform/faqs',
      headers: { Authorization: `Bearer ${token}` },
      payload: { category: 'x', question: 'q', answer: 'a', sortOrder: 0, isPublished: true },
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it('DELETE without the permission → 403', async () => {
    const app = await buildApp();
    const token = await signToken([]);
    const res = await app.inject({
      method: 'DELETE',
      url: '/admin/platform/faqs/1',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
