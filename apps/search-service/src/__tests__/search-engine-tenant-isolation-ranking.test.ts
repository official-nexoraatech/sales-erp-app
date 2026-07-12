// Phase 9 — dedicated coverage for the two properties that make cross-tenant leakage and
// bad ranking structurally impossible: every query is scoped to a tenant-specific index (or
// wildcard) AND carries an explicit `term: { tenantId }` filter clause, and the multi_match
// field list carries the boost weights the design relies on for relevance ranking.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SearchEngine } from '../domain/SearchEngine.js';

const originalFetch = global.fetch;

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}

function captureRequest() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse((init?.body as string) ?? '{}') });
    return jsonResponse({ hits: { total: { value: 0 }, hits: [] } });
  }) as unknown as typeof fetch;
  return calls;
}

describe('SearchEngine.search — tenant isolation', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('single-entity search hits only that tenant+entity index, never another tenant', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.search(7, 'ramesh', { entity: 'customer' });

    expect(calls[0]!.url).toContain('/erp_7_customer/_search');
    expect(calls[0]!.url).not.toContain('erp_8_');
  });

  it('multi-entity search only includes indices for the requesting tenant', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.search(7, 'ramesh', { entities: ['customer', 'invoice'] });

    expect(calls[0]!.url).toContain('/erp_7_customer,erp_7_invoice/_search');
  });

  it("untyped global search wildcards only within the requesting tenant's own prefix", async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.search(7, 'ramesh', {});

    expect(calls[0]!.url).toContain('/erp_7_*/_search');
  });

  it("always adds an exact-match tenantId filter clause matching the caller's own tenant", async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.search(7, 'ramesh', { entity: 'customer' });

    const filter = (calls[0]!.body['query'] as { bool: { filter: unknown[] } }).bool.filter;
    expect(filter).toContainEqual({ term: { tenantId: '7' } });
  });

  it('a different tenantId produces a disjoint index path and filter clause', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.search(42, 'ramesh', { entity: 'customer' });

    expect(calls[0]!.url).toContain('/erp_42_customer/_search');
    const filter = (calls[0]!.body['query'] as { bool: { filter: unknown[] } }).bool.filter;
    expect(filter).toContainEqual({ term: { tenantId: '42' } });
    expect(filter).not.toContainEqual({ term: { tenantId: '7' } });
  });
});

describe('SearchEngine.search — ranking', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('boosts exact identifiers (name/sku/phone/invoiceNumber/poNumber) above generic text fields', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.search(7, 'ramesh', { entity: 'customer' });

    const must = (calls[0]!.body['query'] as { bool: { must: unknown[] } }).bool.must;
    const multiMatch = must[0] as { multi_match: { fields: string[]; type: string } };
    expect(multiMatch.multi_match.fields).toEqual(
      expect.arrayContaining(['name^3', 'sku^2', 'phone^2', 'invoiceNumber^2', 'poNumber^2'])
    );
    expect(multiMatch.multi_match.type).toBe('best_fields');
  });

  it('includes the ngram field at a lower weight than the exact name field, for partial/typo matches', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.search(7, 'ram', { entity: 'customer' });

    const must = (calls[0]!.body['query'] as { bool: { must: unknown[] } }).bool.must;
    const multiMatch = must[0] as { multi_match: { fields: string[] } };
    expect(multiMatch.multi_match.fields).toContain('name.ngram^1');
  });

  it('defaults fuzziness to AUTO for typo tolerance unless overridden', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.search(7, 'ramesh', { entity: 'customer' });

    const must = (calls[0]!.body['query'] as { bool: { must: unknown[] } }).bool.must;
    const multiMatch = must[0] as { multi_match: { fuzziness: string } };
    expect(multiMatch.multi_match.fuzziness).toBe('AUTO');
  });

  it('preserves ES relevance ordering and score on returned hits', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse({
        hits: {
          total: { value: 2 },
          hits: [
            {
              _id: '5',
              _index: 'erp_7_customer',
              _score: 9.2,
              _source: { name: 'Ramesh Textiles' },
            },
            { _id: '9', _index: 'erp_7_customer', _score: 3.1, _source: { name: 'Ramu Traders' } },
          ],
        },
      })
    ) as unknown as typeof fetch;

    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    const result = await engine.search(7, 'ram', { entity: 'customer' });

    expect(result.hits.map((h) => h.id)).toEqual(['5', '9']);
    expect(result.hits[0]!.score).toBeGreaterThan(result.hits[1]!.score);
  });
});

// PG-049 — index creation must explicitly set shard/replica counts rather than relying on ES
// cluster defaults. number_of_replicas: 0 is deliberate: search data is always re-derivable
// from Postgres via fullReindex(), so a lost replica shard costs a slower recovery, not data
// loss, and halving shard count matters once tenant_count × 30 entities accumulates.
describe('SearchEngine — index creation settings', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('createTenantIndices sets explicit shard/replica counts on every entity index', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.createTenantIndices(7);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const settings = call.body['settings'] as {
        number_of_shards: number;
        number_of_replicas: number;
      };
      expect(settings.number_of_shards).toBe(1);
      expect(settings.number_of_replicas).toBe(0);
    }
  });

  it('fullReindex sets explicit shard/replica counts when recreating the index', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.fullReindex(7, 'customer', async () => []);

    const putCall = calls.find((c) => c.body['settings'] !== undefined);
    expect(putCall).toBeDefined();
    const settings = putCall!.body['settings'] as {
      number_of_shards: number;
      number_of_replicas: number;
    };
    expect(settings.number_of_shards).toBe(1);
    expect(settings.number_of_replicas).toBe(0);
  });
});
