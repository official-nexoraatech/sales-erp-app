import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { searchRoutes } from '../api/search.routes.js';
import type { SearchEngine } from '../domain/SearchEngine.js';

// Mock the authenticate middleware so tests don't need a real JWT key
vi.mock('../middleware/authenticate.js', () => ({
  authenticate: async (request: { headers: { authorization?: string } }, reply: { code: (n: number) => { send: (b: unknown) => void } }): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }
    // Accept any Bearer token in tests and synthesize auth payload
    (request as Record<string, unknown>)['auth'] = {
      sub: '1',
      tenantId: 1,
      email: 'test@example.com',
      roles: ['ADMIN'],
      permissions: ['SEARCH_GLOBAL', 'SEARCH_REINDEX'],
      userId: 1,
    };
  },
}));

// Minimal SearchEngine stub — we only care about auth, not search results
const mockEngine = {
  search: vi.fn().mockResolvedValue({ hits: [], total: 0, took: 1 }),
  fullReindex: vi.fn().mockResolvedValue({ indexed: 0 }),
  createTenantIndices: vi.fn().mockResolvedValue(undefined),
  deleteTenantIndices: vi.fn().mockResolvedValue(undefined),
  getIndexStats: vi.fn().mockResolvedValue({}),
  index: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
} as unknown as SearchEngine;

describe('Search service — authentication', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await searchRoutes(app, mockEngine);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search?q=cotton',
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when Authorization header is malformed (no Bearer prefix)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search?q=cotton',
      headers: { authorization: 'Basic abc123' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 200 when a valid Bearer token is provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/search?q=cotton',
      headers: { authorization: 'Bearer valid-test-token' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { hits: unknown[]; total: number } };
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data.hits)).toBe(true);
  });
});
