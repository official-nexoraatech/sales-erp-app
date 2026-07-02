import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'search-service' });

// Entities indexed in Elasticsearch per §4.9
export type SearchEntity =
  | 'customer'
  | 'supplier'
  | 'item'
  | 'invoice'
  | 'purchase_order'
  | 'stock'
  | 'employee';

export interface SearchHit {
  id: string;
  entity: SearchEntity;
  score: number;
  highlight?: Record<string, string[]>;
  source: Record<string, unknown>;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  took: number;
}

export interface SearchOptions {
  entity?: SearchEntity;
  size?: number;
  from?: number;
  filters?: Record<string, unknown>;
  fuzziness?: 'AUTO' | '0' | '1' | '2';
}

// ── Custom analyzer definition (erp_name_analyzer) ────────────────────────────
const ERP_ANALYSIS_SETTINGS = {
  analysis: {
    filter: {
      erp_synonyms: {
        type: 'synonym',
        synonyms: [
          'fabric,cloth,textile',
          'customer,client,buyer',
          'invoice,bill,receipt',
          'purchase order,po',
          'goods received note,grn',
          'challan,delivery challan',
        ],
      },
      erp_ngram: {
        type: 'ngram',
        min_gram: 3,
        max_gram: 12,
      },
      erp_shingle: {
        type: 'shingle',
        min_shingle_size: 2,
        max_shingle_size: 3,
      },
      hindi_stop: {
        type: 'stop',
        stopwords: ['ka', 'ki', 'ke', 'aur', 'se', 'ko', 'ne'],
      },
    },
    tokenizer: {
      erp_ngram_tokenizer: {
        type: 'ngram',
        min_gram: 3,
        max_gram: 12,
        token_chars: ['letter', 'digit'],
      },
    },
    analyzer: {
      erp_name_analyzer: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding', 'erp_synonyms', 'erp_shingle'],
      },
      erp_ngram_analyzer: {
        type: 'custom',
        tokenizer: 'erp_ngram_tokenizer',
        filter: ['lowercase', 'asciifolding'],
      },
      erp_search_analyzer: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'asciifolding', 'erp_synonyms'],
      },
    },
  },
};

// ── Entity-specific mappings ───────────────────────────────────────────────────
const ENTITY_MAPPINGS: Record<SearchEntity, Record<string, unknown>> = {
  customer: {
    name: { type: 'text', analyzer: 'erp_name_analyzer', search_analyzer: 'erp_search_analyzer', fields: { keyword: { type: 'keyword' }, ngram: { type: 'text', analyzer: 'erp_ngram_analyzer' } } },
    phone: { type: 'keyword' },
    email: { type: 'keyword' },
    gstin: { type: 'keyword' },
    creditLimit: { type: 'double' },
    tenantId: { type: 'keyword' },
  },
  supplier: {
    name: { type: 'text', analyzer: 'erp_name_analyzer', search_analyzer: 'erp_search_analyzer', fields: { keyword: { type: 'keyword' }, ngram: { type: 'text', analyzer: 'erp_ngram_analyzer' } } },
    phone: { type: 'keyword' },
    email: { type: 'keyword' },
    gstin: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  item: {
    name: { type: 'text', analyzer: 'erp_name_analyzer', search_analyzer: 'erp_search_analyzer', fields: { keyword: { type: 'keyword' }, ngram: { type: 'text', analyzer: 'erp_ngram_analyzer' } } },
    sku: { type: 'keyword' },
    barcode: { type: 'keyword' },
    category: { type: 'keyword' },
    brand: { type: 'keyword' },
    salePrice: { type: 'double' },
    tenantId: { type: 'keyword' },
  },
  invoice: {
    invoiceNumber: { type: 'keyword' },
    customerName: { type: 'text', analyzer: 'erp_name_analyzer', search_analyzer: 'erp_search_analyzer' },
    amount: { type: 'double' },
    status: { type: 'keyword' },
    invoiceDate: { type: 'date' },
    tenantId: { type: 'keyword' },
  },
  purchase_order: {
    poNumber: { type: 'keyword' },
    supplierName: { type: 'text', analyzer: 'erp_name_analyzer', search_analyzer: 'erp_search_analyzer' },
    amount: { type: 'double' },
    status: { type: 'keyword' },
    poDate: { type: 'date' },
    tenantId: { type: 'keyword' },
  },
  stock: {
    itemName: { type: 'text', analyzer: 'erp_name_analyzer', search_analyzer: 'erp_search_analyzer' },
    sku: { type: 'keyword' },
    warehouse: { type: 'keyword' },
    quantity: { type: 'double' },
    tenantId: { type: 'keyword' },
  },
  employee: {
    name: { type: 'text', analyzer: 'erp_name_analyzer', search_analyzer: 'erp_search_analyzer', fields: { keyword: { type: 'keyword' } } },
    employeeCode: { type: 'keyword' },
    designation: { type: 'keyword' },
    department: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
};

export class SearchEngine {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(config: { elasticsearchUrl: string; apiKey?: string }) {
    this.baseUrl = config.elasticsearchUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  private indexName(tenantId: number, entity: SearchEntity): string {
    return `erp_${tenantId}_${entity}`;
  }

  private async esRequest(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ ok: boolean; status: number; data: unknown }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `ApiKey ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : null,
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  }

  async createTenantIndices(tenantId: number): Promise<void> {
    const entities: SearchEntity[] = ['customer', 'supplier', 'item', 'invoice', 'purchase_order', 'stock', 'employee'];
    for (const entity of entities) {
      const index = this.indexName(tenantId, entity);
      const result = await this.esRequest('PUT', `/${index}`, {
        settings: { number_of_shards: 1, number_of_replicas: 1, ...ERP_ANALYSIS_SETTINGS },
        mappings: { properties: ENTITY_MAPPINGS[entity] },
      });
      if (!result.ok && (result.data as { status?: number }).status !== 400) {
        logger.warn({ index, result: result.data }, 'Index creation returned non-ok');
      } else {
        logger.info({ index }, 'ES index created');
      }
    }
  }

  async deleteTenantIndices(tenantId: number): Promise<void> {
    const entities: SearchEntity[] = ['customer', 'supplier', 'item', 'invoice', 'purchase_order', 'stock', 'employee'];
    for (const entity of entities) {
      const index = this.indexName(tenantId, entity);
      await this.esRequest('DELETE', `/${index}`);
      logger.info({ index }, 'ES index deleted');
    }
  }

  async index(
    tenantId: number,
    entity: SearchEntity,
    id: string,
    document: Record<string, unknown>
  ): Promise<void> {
    const index = this.indexName(tenantId, entity);
    const result = await this.esRequest('PUT', `/${index}/_doc/${id}`, {
      ...document,
      tenantId: String(tenantId),
      _indexed_at: new Date().toISOString(),
    });
    if (!result.ok) {
      logger.warn({ index, id, result: result.data }, 'Failed to index document');
    }
  }

  async bulkIndex(
    tenantId: number,
    entity: SearchEntity,
    documents: Array<{ id: string; doc: Record<string, unknown> }>
  ): Promise<{ indexed: number; failed: number }> {
    if (documents.length === 0) return { indexed: 0, failed: 0 };

    const index = this.indexName(tenantId, entity);
    const body = documents.flatMap(({ id, doc }) => [
      { index: { _index: index, _id: id } },
      { ...doc, tenantId: String(tenantId), _indexed_at: new Date().toISOString() },
    ]);

    const result = await this.esRequest('POST', '/_bulk', body.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const resp = result.data as { errors?: boolean; items?: Array<{ index?: { error?: unknown } }> };
    const failed = resp.items?.filter((i) => i.index?.error).length ?? 0;
    return { indexed: documents.length - failed, failed };
  }

  async delete(tenantId: number, entity: SearchEntity, id: string): Promise<void> {
    const index = this.indexName(tenantId, entity);
    await this.esRequest('DELETE', `/${index}/_doc/${id}`);
  }

  async search(
    tenantId: number,
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResult> {
    const { entity, size = 20, from = 0, filters = {}, fuzziness = 'AUTO' } = options;

    const indices = entity
      ? this.indexName(tenantId, entity)
      : `erp_${tenantId}_*`;

    const must: unknown[] = [
      {
        multi_match: {
          query,
          fields: ['name^3', 'name.ngram^1', 'sku^2', 'phone^2', 'invoiceNumber^2', 'poNumber^2', 'customerName', 'supplierName', 'itemName'],
          type: 'best_fields',
          fuzziness,
          prefix_length: 1,
        },
      },
    ];

    for (const [key, value] of Object.entries(filters)) {
      must.push({ term: { [key]: value } });
    }

    const startTime = Date.now();
    const result = await this.esRequest('POST', `/${indices}/_search`, {
      from,
      size,
      query: { bool: { must, filter: [{ term: { tenantId: String(tenantId) } }] } },
      highlight: {
        fields: {
          name: {},
          customerName: {},
          supplierName: {},
          itemName: {},
        },
      },
    });

    const took = Date.now() - startTime;
    const resp = result.data as {
      hits?: {
        total?: { value: number };
        hits?: Array<{
          _id: string;
          _index: string;
          _score: number;
          _source: Record<string, unknown>;
          highlight?: Record<string, string[]>;
        }>;
      };
    };

    const hits: SearchHit[] = (resp.hits?.hits ?? []).map((h) => ({
      id: h._id,
      entity: h._index.split('_').pop() as SearchEntity,
      score: h._score,
      ...(h.highlight !== undefined ? { highlight: h.highlight } : {}),
      source: h._source,
    }));

    return { hits, total: resp.hits?.total?.value ?? 0, took };
  }

  async fullReindex(
    tenantId: number,
    entity: SearchEntity,
    dataFetcher: () => Promise<Array<{ id: string; doc: Record<string, unknown> }>>
  ): Promise<{ indexed: number; failed: number }> {
    const index = this.indexName(tenantId, entity);

    // Delete and recreate index for clean reindex
    await this.esRequest('DELETE', `/${index}`);
    await this.esRequest('PUT', `/${index}`, {
      settings: { number_of_shards: 1, number_of_replicas: 1, ...ERP_ANALYSIS_SETTINGS },
      mappings: { properties: ENTITY_MAPPINGS[entity] },
    });

    const documents = await dataFetcher();
    const BATCH_SIZE = 500;
    let totalIndexed = 0;
    let totalFailed = 0;

    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE);
      const { indexed, failed } = await this.bulkIndex(tenantId, entity, batch);
      totalIndexed += indexed;
      totalFailed += failed;
    }

    logger.info({ tenantId, entity, indexed: totalIndexed, failed: totalFailed }, 'Full reindex complete');
    return { indexed: totalIndexed, failed: totalFailed };
  }

  async getIndexStats(tenantId: number, entity: SearchEntity): Promise<unknown> {
    const index = this.indexName(tenantId, entity);
    const result = await this.esRequest('GET', `/${index}/_stats`);
    return result.data;
  }
}
