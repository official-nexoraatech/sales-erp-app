import { createLogger } from '@erp/logger';
import { ENTITY_SOURCES } from './searchSyncSources.js';

const logger = createLogger({ serviceName: 'scheduler-service' });

interface SearchSyncDoc {
  id: string;
  doc: Record<string, unknown>;
}

// Pages through one owning service's GET /internal/search-sync/:entity endpoint until
// hasMore is false. A single page/request failure stops pagination for *this source* only
// (logged, non-fatal) — one downed service shouldn't block reindexing every other entity.
async function fetchAllFromSource(
  baseUrl: string,
  entity: string,
  tenantId: number,
  apiKey: string,
  modifiedSince?: string
): Promise<SearchSyncDoc[]> {
  const all: SearchSyncDoc[] = [];
  const size = 500;
  let page = 0;

  for (;;) {
    const params = new URLSearchParams({ tenantId: String(tenantId), page: String(page), size: String(size) });
    if (modifiedSince) params.set('modifiedSince', modifiedSince);

    const res = await fetch(`${baseUrl}/api/v2/internal/search-sync/${entity}?${params.toString()}`, {
      headers: { 'x-internal-key': apiKey },
    });
    if (!res.ok) {
      logger.warn({ baseUrl, entity, status: res.status }, 'search-sync source returned non-ok — stopping pagination for this source');
      break;
    }

    const body = (await res.json()) as { data?: { content?: SearchSyncDoc[]; hasMore?: boolean } };
    const content = body.data?.content ?? [];
    all.push(...content);
    if (!body.data?.hasMore) break;
    page += 1;
  }

  return all;
}

// Gathers documents for one entity from every service that owns it (usually one, 'payment'
// has two — see ENTITY_SOURCES), then pushes the combined set to search-service in a single
// call. Combining first matters for multi-source entities: reindexing per-source would have
// each call's delete-and-recreate step wipe the other source's just-indexed documents.
async function syncEntityForTenant(
  entity: string,
  tenantId: number,
  apiKey: string,
  searchServiceUrl: string,
  mode: 'full' | 'incremental',
  modifiedSince?: string
): Promise<{ indexed: number; failed: number } | undefined> {
  const sources = ENTITY_SOURCES[entity];
  if (!sources || sources.length === 0) return undefined;

  const allDocs: SearchSyncDoc[] = [];
  for (const source of sources) {
    const baseUrl = process.env[source.envVar] ?? source.defaultUrl;
    try {
      allDocs.push(...(await fetchAllFromSource(baseUrl, entity, tenantId, apiKey, modifiedSince)));
    } catch (err) {
      logger.warn({ entity, baseUrl, err }, 'Failed to fetch a search-sync source — skipping (non-fatal)');
    }
  }

  const path = mode === 'full' ? `/internal/search/reindex/${entity}` : '/internal/search/bulk-index';
  const body = mode === 'full' ? { tenantId, documents: allDocs } : { tenantId, entity, documents: allDocs };

  try {
    const res = await fetch(`${searchServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ entity, status: res.status }, 'search-service reindex/bulk-index call failed');
      return undefined;
    }
    const result = (await res.json()) as { data?: { indexed?: number; failed?: number } };
    return { indexed: result.data?.indexed ?? 0, failed: result.data?.failed ?? 0 };
  } catch (err) {
    logger.warn({ entity, err }, 'search-service reindex/bulk-index call threw — skipping (non-fatal)');
    return undefined;
  }
}

// search.full-reindex (weekly): delete-and-recreate every entity's index from scratch,
// straight from each owning service's tables — the ground-truth catch-up for drift that
// incremental sync might have missed (e.g. events lost during a search-service outage).
export async function runSearchFullReindex(tenantId: number): Promise<void> {
  const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
  const searchServiceUrl = process.env['SEARCH_SERVICE_URL'] ?? 'http://localhost:3017';

  for (const entity of Object.keys(ENTITY_SOURCES)) {
    const result = await syncEntityForTenant(entity, tenantId, apiKey, searchServiceUrl, 'full');
    if (result) logger.info({ tenantId, entity, ...result }, 'Full reindex complete for entity');
  }
}

// search.incremental-sync (every 10 min): upsert-only reconciliation pass for rows changed
// in the lookback window. This is a safety net alongside the Kafka consumer's real-time
// sync (Phase 3), not a replacement for it — it exists to catch anything the consumer missed
// (e.g. a message that landed in the dead-letter queue). 15-minute lookback for a 10-minute
// job deliberately overlaps the previous run to absorb clock drift and job-runtime variance.
export async function runSearchIncrementalSync(tenantId: number): Promise<void> {
  const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
  const searchServiceUrl = process.env['SEARCH_SERVICE_URL'] ?? 'http://localhost:3017';
  const modifiedSince = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  for (const entity of Object.keys(ENTITY_SOURCES)) {
    const result = await syncEntityForTenant(entity, tenantId, apiKey, searchServiceUrl, 'incremental', modifiedSince);
    if (result && (result.indexed > 0 || result.failed > 0)) {
      logger.info({ tenantId, entity, ...result }, 'Incremental sync complete for entity');
    }
  }
}
