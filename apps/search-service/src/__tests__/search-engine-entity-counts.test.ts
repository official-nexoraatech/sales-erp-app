// A multi-index (`entities`) search previously had no way to show true per-entity match
// totals — the frontend command palette grouped whatever fraction of one flat, `size`-capped
// page of combined-relevance hits happened to be each type, so a high-volume but
// lower-scoring entity could be entirely absent from the visible groups despite having real
// matches. Adds an ES `_index` terms aggregation (only for multi-index searches, where it's
// meaningful) and parses it into `SearchResult.entityCounts`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SearchEngine } from '../domain/SearchEngine.js';

const originalFetch = global.fetch;

describe('SearchEngine.search — entityCounts aggregation', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requests a by_entity terms aggregation on _index for a multi-index search', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          hits: { total: { value: 2 }, hits: [] },
          aggregations: {
            by_entity: {
              buckets: [
                { key: 'erp_2_customer', doc_count: 5 },
                { key: 'erp_2_purchase_order', doc_count: 3 },
              ],
            },
          },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    const result = await engine.search(2, 'ramesh', { entities: ['customer', 'purchase_order'] });

    expect(capturedBody?.['aggs']).toEqual({
      by_entity: { terms: { field: '_index', size: 2 } },
    });
    // Entity names recovered from the index name the same way hits.entity already is —
    // 'purchase_order' itself contains an underscore, so this must survive that split.
    expect(result.entityCounts).toEqual({ customer: 5, purchase_order: 3 });
  });

  it('omits the aggregation entirely for a single-entity search', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({ hits: { total: { value: 0 }, hits: [] } }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    const result = await engine.search(2, 'ramesh', { entity: 'customer' });

    expect(capturedBody?.['aggs']).toBeUndefined();
    expect(result.entityCounts).toBeUndefined();
  });
});
