// Phase 4 — search.full-reindex / search.incremental-sync job logic. Verifies pagination
// through a source's search-sync endpoint, and — the subtlest part — that a multi-source
// entity ('payment': sales-service customer payments + purchase-service supplier payments)
// gets all its documents combined into ONE reindex call rather than one call per source
// (a second per-source reindex call would delete-and-recreate the index, wiping out the
// first source's just-indexed documents).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runSearchFullReindex, runSearchIncrementalSync } from '../jobs/searchSyncJobs.js';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ data }),
  } as unknown as Response;
}

describe('runSearchFullReindex', () => {
  beforeEach(() => {
    process.env['INTERNAL_API_KEY'] = 'test-key';
    process.env['SEARCH_SERVICE_URL'] = 'http://search-service';
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('paginates a single-source entity until hasMore is false, then reindexes once with all pages combined', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/internal/search-sync/customer')) {
        if (u.includes('page=0')) {
          return jsonResponse({ content: [{ id: '1', doc: { name: 'A' } }], hasMore: true });
        }
        if (u.includes('page=1')) {
          return jsonResponse({ content: [{ id: '2', doc: { name: 'B' } }], hasMore: false });
        }
      }
      if (u.includes('/internal/search/reindex/')) {
        return jsonResponse({ indexed: 2, failed: 0 });
      }
      return jsonResponse({}, false);
    }) as unknown as typeof fetch;

    await runSearchFullReindex(5);

    const reindexCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url]) => String(url).includes('/internal/search/reindex/customer')
    );
    expect(reindexCall).toBeDefined();
    const [, options] = reindexCall!;
    const body = JSON.parse((options as RequestInit).body as string) as { tenantId: number; documents: unknown[] };
    expect(body.tenantId).toBe(5);
    expect(body.documents).toEqual([{ id: '1', doc: { name: 'A' } }, { id: '2', doc: { name: 'B' } }]);

    // Confirms pagination actually walked both pages instead of stopping at page 0.
    expect(calls.some((c) => c.includes('/internal/search-sync/customer') && c.includes('page=0'))).toBe(true);
    expect(calls.some((c) => c.includes('/internal/search-sync/customer') && c.includes('page=1'))).toBe(true);
  });

  it('combines a two-source entity (payment) into a single reindex call, not one per source', async () => {
    const reindexBodies: Array<{ tenantId: number; documents: Array<{ id: string }> }> = [];

    global.fetch = vi.fn(async (url: string | URL, options?: RequestInit) => {
      const u = String(url);
      if (u.includes('/internal/search-sync/payment') && u.includes('3013')) {
        return jsonResponse({ content: [{ id: 'in-1', doc: { amount: 100 } }], hasMore: false });
      }
      if (u.includes('/internal/search-sync/payment') && u.includes('3020')) {
        return jsonResponse({ content: [{ id: 'out-1', doc: { amount: 200 } }], hasMore: false });
      }
      if (u.includes('/internal/search/reindex/payment')) {
        reindexBodies.push(JSON.parse((options?.body as string) ?? '{}'));
        return jsonResponse({ indexed: 2, failed: 0 });
      }
      // Every other entity's sources — return empty so the test stays focused on 'payment'.
      return jsonResponse({ content: [], hasMore: false });
    }) as unknown as typeof fetch;

    await runSearchFullReindex(7);

    // Exactly one reindex call for 'payment', containing documents from BOTH sources.
    expect(reindexBodies.length).toBe(1);
    expect(reindexBodies[0]!.documents).toEqual(
      expect.arrayContaining([{ id: 'in-1', doc: { amount: 100 } }, { id: 'out-1', doc: { amount: 200 } }])
    );
  });

  it('a source that fails is skipped without crashing the rest of the run', async () => {
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/internal/search-sync/customer')) {
        throw new Error('ECONNREFUSED');
      }
      if (u.includes('/internal/search/reindex/')) {
        return jsonResponse({ indexed: 0, failed: 0 });
      }
      return jsonResponse({ content: [], hasMore: false });
    }) as unknown as typeof fetch;

    await expect(runSearchFullReindex(1)).resolves.toBeUndefined();
  });
});

describe('runSearchIncrementalSync', () => {
  beforeEach(() => {
    process.env['INTERNAL_API_KEY'] = 'test-key';
    process.env['SEARCH_SERVICE_URL'] = 'http://search-service';
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('calls bulk-index (not reindex) and passes a modifiedSince cutoff', async () => {
    let bulkIndexCalled = false;
    let sawModifiedSince = false;

    global.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/internal/search-sync/') ) {
        if (u.includes('modifiedSince=')) sawModifiedSince = true;
        return jsonResponse({ content: [], hasMore: false });
      }
      if (u.includes('/internal/search/bulk-index')) {
        bulkIndexCalled = true;
        return jsonResponse({ indexed: 0, failed: 0 });
      }
      if (u.includes('/internal/search/reindex/')) {
        throw new Error('incremental sync must never call the full-reindex endpoint');
      }
      return jsonResponse({ content: [], hasMore: false });
    }) as unknown as typeof fetch;

    await runSearchIncrementalSync(3);

    expect(bulkIndexCalled).toBe(true);
    expect(sawModifiedSince).toBe(true);
  });
});
