// Live E2E testing (2026-07-12) found customer/supplier/employee search returning zero
// results for real, correctly-indexed documents. Root cause: CUSTOMER_CREATED/SUPPLIER_CREATED
// publish the raw DB row (display-name column is `displayName`), and EMPLOYEE_JOINED publishes
// a hand-built payload with the same `displayName` key — but ENTITY_MAPPINGS and the
// multi_match query in SearchEngine.search only ever look at `name`. Docs indexed fine
// (doc_as_upsert never errors) but were permanently unsearchable by the one field a real user
// types into the search box. Fixed by aliasing displayName -> name at the index()/bulkIndex()
// choke point so no producer needs to change.
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
    return jsonResponse({ result: 'updated' });
  }) as unknown as typeof fetch;
  return calls;
}

describe('SearchEngine.index — displayName aliasing', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('aliases displayName to name when the document has no name field', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.index(7, 'customer', '5', { displayName: 'Ramesh Textiles', phone: '9876543210' });

    const doc = calls[0]!.body['doc'] as Record<string, unknown>;
    expect(doc['name']).toBe('Ramesh Textiles');
    expect(doc['displayName']).toBe('Ramesh Textiles');
  });

  it('does not override an explicitly provided name field', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.index(7, 'item', '9', { name: 'Cotton Saree', displayName: 'ignored' });

    const doc = calls[0]!.body['doc'] as Record<string, unknown>;
    expect(doc['name']).toBe('Cotton Saree');
  });

  it('leaves documents without a displayName field untouched', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.index(7, 'invoice', '1', { invoiceNumber: 'INV-001' });

    const doc = calls[0]!.body['doc'] as Record<string, unknown>;
    expect(doc['name']).toBeUndefined();
  });
});

describe('SearchEngine.bulkIndex — displayName aliasing', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('aliases displayName to name for every document in the batch', async () => {
    const calls = captureRequest();
    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.bulkIndex(7, 'supplier', [
      { id: '1', doc: { displayName: 'Acme Fabrics' } },
      { id: '2', doc: { displayName: 'Bharat Traders' } },
    ]);

    const raw = calls[0]!.body as unknown as string;
    const lines = raw
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines[1].name).toBe('Acme Fabrics');
    expect(lines[3].name).toBe('Bharat Traders');
  });
});
