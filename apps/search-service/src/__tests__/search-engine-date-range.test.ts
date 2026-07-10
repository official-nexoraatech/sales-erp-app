// Phase 6 — SearchEngine.search()'s dateRange option builds a real ES `range` clause
// (gte/lte), distinct from `filters`' exact-match `term` clauses which can't express "between
// two dates".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SearchEngine } from '../domain/SearchEngine.js';

const originalFetch = global.fetch;

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ data }) } as unknown as Response;
}

describe('SearchEngine.search — dateRange', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('adds a range clause with both gte and lte when both from/to are given', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ hits: { total: { value: 0 }, hits: [] } });
    }) as unknown as typeof fetch;

    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.search(1, 'test', { entity: 'invoice', dateRange: { field: 'invoiceDate', from: '2026-01-01', to: '2026-01-31' } });

    const must = (capturedBody?.['query'] as { bool: { must: unknown[] } }).bool.must;
    expect(must).toContainEqual({ range: { invoiceDate: { gte: '2026-01-01', lte: '2026-01-31' } } });
  });

  it('omits the missing bound when only one of from/to is given', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ hits: { total: { value: 0 }, hits: [] } });
    }) as unknown as typeof fetch;

    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.search(1, 'test', { entity: 'invoice', dateRange: { field: 'invoiceDate', from: '2026-01-01' } });

    const must = (capturedBody?.['query'] as { bool: { must: unknown[] } }).bool.must;
    expect(must).toContainEqual({ range: { invoiceDate: { gte: '2026-01-01' } } });
  });

  it('adds no range clause when dateRange is entirely omitted', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return jsonResponse({ hits: { total: { value: 0 }, hits: [] } });
    }) as unknown as typeof fetch;

    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.search(1, 'test', { entity: 'invoice' });

    const must = (capturedBody?.['query'] as { bool: { must: unknown[] } }).bool.must;
    expect(must.some((m) => typeof m === 'object' && m !== null && 'range' in m)).toBe(false);
  });
});
