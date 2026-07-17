// Found in live QA 2026-07-17: bulkIndex() pre-formats its own NDJSON string (the _bulk
// API's required wire format), but esRequest() unconditionally JSON.stringify'd whatever it
// was given — double-encoding the NDJSON into a single invalid JSON string value. ES 400'd
// every bulk write ("bulk request must be terminated by a newline"), but bulkIndex()'s
// success count fell back to "0 failed" whenever there was no `items` array to inspect (a
// request-level failure, not per-item ones) — so every scheduled full-reindex/
// incremental-sync silently wrote zero documents for every entity, every tenant, while
// logging "indexed: N, failed: 0" as if it had worked.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SearchEngine } from '../domain/SearchEngine.js';

const originalFetch = global.fetch;

describe('SearchEngine.bulkIndex', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends raw NDJSON as the request body, not a JSON.stringify-wrapped string', async () => {
    let capturedBody: unknown;
    let capturedContentType: string | undefined;
    global.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = init?.body;
      capturedContentType = (init?.headers as Record<string, string>)?.['Content-Type'];
      return {
        ok: true,
        status: 200,
        json: async () => ({ errors: false, items: [{ index: { _id: '1' } }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    await engine.bulkIndex(2, 'category', [{ id: '1', doc: { name: 'Test Category' } }]);

    expect(typeof capturedBody).toBe('string');
    const body = capturedBody as string;
    // A double-JSON.stringify'd NDJSON body would be wrapped in an outer pair of quotes
    // with escaped internal newlines (\\n) instead of real ones — the exact bug this guards.
    expect(body.startsWith('"')).toBe(false);
    const lines = body.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ index: { _index: 'erp_2_category', _id: '1' } });
    expect(JSON.parse(lines[1]!)).toMatchObject({ name: 'Test Category', tenantId: '2' });
    expect(capturedContentType).toBe('application/x-ndjson');
  });

  it('reports every document as failed on a request-level ES failure, not "0 failed"', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: { reason: 'bulk request must be terminated by a newline' },
        status: 400,
      }),
    })) as unknown as typeof fetch;

    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    const result = await engine.bulkIndex(2, 'category', [
      { id: '1', doc: { name: 'A' } },
      { id: '2', doc: { name: 'B' } },
    ]);

    expect(result).toEqual({ indexed: 0, failed: 2 });
  });

  it('still correctly counts real per-item failures on a successful bulk response', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        errors: true,
        items: [
          { index: { _id: '1' } },
          { index: { _id: '2', error: { type: 'mapper_parsing_exception' } } },
        ],
      }),
    })) as unknown as typeof fetch;

    const engine = new SearchEngine({ elasticsearchUrl: 'http://es:9200' });
    const result = await engine.bulkIndex(2, 'category', [
      { id: '1', doc: { name: 'A' } },
      { id: '2', doc: { name: 'B' } },
    ]);

    expect(result).toEqual({ indexed: 1, failed: 1 });
  });
});
