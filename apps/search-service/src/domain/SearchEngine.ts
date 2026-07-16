import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'search-service' });

// customers/suppliers/employees are published to their CREATED/UPDATED outbox events as raw
// DB rows, whose display-name column is `displayName` (see packages/db-client schema) — but
// every ENTITY_MAPPINGS text field and the multi_match query below search on `name`. Without
// this alias those three entities index fine (doc_as_upsert never fails) but are permanently
// unsearchable by the one field a real user actually types into the search box.
function normalizeDocumentFields(document: Record<string, unknown>): Record<string, unknown> {
  if (document.name === undefined && typeof document.displayName === 'string') {
    return { ...document, name: document.displayName };
  }
  return document;
}

// Entities indexed in Elasticsearch per §4.9
export type SearchEntity =
  | 'customer'
  | 'supplier'
  | 'item'
  | 'invoice'
  | 'purchase_order'
  | 'stock'
  | 'employee'
  | 'quotation'
  | 'crm_interaction'
  | 'crm_segment'
  | 'crm_campaign'
  | 'category'
  | 'brand'
  | 'unit'
  | 'warehouse'
  | 'stock_transfer'
  | 'stock_adjustment'
  | 'grn'
  | 'purchase_return'
  | 'account'
  | 'journal_entry'
  | 'payment'
  | 'attendance'
  | 'payroll_run'
  | 'leave_application'
  | 'user'
  | 'role'
  | 'branch'
  | 'organization'
  | 'attachment';

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
  // Restricts an untyped (no `entity`) search to this subset of indices — used by
  // search.routes.ts to pass only the entities the caller's permissions allow, instead of
  // querying every tenant index and filtering after the fact.
  entities?: SearchEntity[];
  size?: number;
  from?: number;
  filters?: Record<string, unknown>;
  fuzziness?: 'AUTO' | '0' | '1' | '2';
  // Restricts results to these branch IDs. Only applied when `entity` is a single,
  // branch-scoped entity (see BRANCH_SCOPED_ENTITIES) — search.routes.ts never passes this
  // alongside `entities` (multi-index search), since a `terms` filter on `branchId` would
  // incorrectly exclude documents from entities that don't have that field at all.
  branchIds?: number[];
  // Part 6 advanced-search date filter (e.g. invoiceDate/quotationDate/grnDate) — `filters`
  // above only expresses exact-match `term` clauses, which can't do a "between two dates"
  // range, so this gets its own ES `range` clause instead of being folded into `filters`.
  dateRange?: { field: string; from?: string; to?: string };
  // Restricts an `entity: 'attachment'` search to only the parent-record types
  // (INVOICE/PURCHASE_ORDER/GRN) the caller holds view permission for — an attachment
  // document's visibility depends on its parent type, not one fixed per-entity permission
  // (see ENTITY_PERMISSION['attachment'] in search.routes.ts). Same restriction as
  // `branchIds`: only meaningful for a single `entity` search, never alongside `entities`
  // (multi-index), since a `terms` filter on `entityType` would incorrectly exclude
  // documents from entities that don't have that field at all.
  attachmentEntityTypes?: string[];
  // Smart Search ranking boost: document IDs this tenant's users have previously clicked on
  // for this exact query text (see search.routes.ts, sourced from the search_analytics table
  // that's already populated on every search + click). Purely additive — when empty/omitted,
  // ranking is identical to the plain multi_match query below.
  boostedIds?: string[];
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
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: {
        keyword: { type: 'keyword' },
        ngram: { type: 'text', analyzer: 'erp_ngram_analyzer' },
      },
    },
    phone: { type: 'keyword' },
    email: { type: 'keyword' },
    gstin: { type: 'keyword' },
    creditLimit: { type: 'double' },
    tenantId: { type: 'keyword' },
  },
  supplier: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: {
        keyword: { type: 'keyword' },
        ngram: { type: 'text', analyzer: 'erp_ngram_analyzer' },
      },
    },
    phone: { type: 'keyword' },
    email: { type: 'keyword' },
    gstin: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  item: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: {
        keyword: { type: 'keyword' },
        ngram: { type: 'text', analyzer: 'erp_ngram_analyzer' },
      },
    },
    sku: { type: 'keyword' },
    barcode: { type: 'keyword' },
    category: { type: 'keyword' },
    brand: { type: 'keyword' },
    salePrice: { type: 'double' },
    tenantId: { type: 'keyword' },
  },
  invoice: {
    invoiceNumber: { type: 'keyword' },
    customerName: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
    },
    amount: { type: 'double' },
    status: { type: 'keyword' },
    invoiceDate: { type: 'date' },
    branchId: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  purchase_order: {
    poNumber: { type: 'keyword' },
    supplierName: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
    },
    amount: { type: 'double' },
    status: { type: 'keyword' },
    poDate: { type: 'date' },
    branchId: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  stock: {
    itemName: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
    },
    sku: { type: 'keyword' },
    warehouse: { type: 'keyword' },
    quantity: { type: 'double' },
    tenantId: { type: 'keyword' },
  },
  employee: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    employeeCode: { type: 'keyword' },
    designation: { type: 'keyword' },
    department: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  quotation: {
    quotationNumber: { type: 'keyword' },
    customerName: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
    },
    amount: { type: 'double' },
    status: { type: 'keyword' },
    quotationDate: { type: 'date' },
    branchId: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  crm_interaction: {
    customerName: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
    },
    type: { type: 'keyword' },
    notes: { type: 'text', analyzer: 'erp_name_analyzer', search_analyzer: 'erp_search_analyzer' },
    interactionDate: { type: 'date' },
    tenantId: { type: 'keyword' },
  },
  crm_segment: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    code: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  crm_campaign: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    channel: { type: 'keyword' },
    status: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  category: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    code: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  brand: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    code: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  unit: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    abbreviation: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  warehouse: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    code: { type: 'keyword' },
    branchId: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  stock_transfer: {
    transferNumber: { type: 'keyword' },
    fromWarehouseId: { type: 'keyword' },
    toWarehouseId: { type: 'keyword' },
    status: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  stock_adjustment: {
    adjustmentNumber: { type: 'keyword' },
    warehouseId: { type: 'keyword' },
    adjustmentType: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  grn: {
    grnNumber: { type: 'keyword' },
    supplierName: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
    },
    status: { type: 'keyword' },
    grnDate: { type: 'date' },
    branchId: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  purchase_return: {
    returnNumber: { type: 'keyword' },
    supplierName: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
    },
    status: { type: 'keyword' },
    returnDate: { type: 'date' },
    branchId: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  account: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    accountCode: { type: 'keyword' },
    accountType: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  journal_entry: {
    journalId: { type: 'keyword' },
    description: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
    },
    referenceType: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  payment: {
    paymentNumber: { type: 'keyword' },
    customerName: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
    },
    amount: { type: 'double' },
    paymentMode: { type: 'keyword' },
    paymentDate: { type: 'date' },
    branchId: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  attendance: {
    employeeName: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
    },
    attendanceDate: { type: 'date' },
    tenantId: { type: 'keyword' },
  },
  payroll_run: {
    periodMonth: { type: 'integer' },
    periodYear: { type: 'integer' },
    status: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  leave_application: {
    employeeName: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
    },
    startDate: { type: 'date' },
    endDate: { type: 'date' },
    status: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  user: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    email: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  role: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    tenantId: { type: 'keyword' },
  },
  branch: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    code: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
  organization: {
    name: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    tenantId: { type: 'keyword' },
  },
  attachment: {
    fileName: {
      type: 'text',
      analyzer: 'erp_name_analyzer',
      search_analyzer: 'erp_search_analyzer',
      fields: { keyword: { type: 'keyword' } },
    },
    entityType: { type: 'keyword' },
    entityId: { type: 'keyword' },
    tenantId: { type: 'keyword' },
  },
};

export const ALL_SEARCH_ENTITIES = Object.keys(ENTITY_MAPPINGS) as SearchEntity[];

// Entities whose owning table has a `branch_id` column — the only ones a branch-scope
// filter can be applied to. See SearchOptions.branchIds and search.routes.ts for how this
// is used to keep global (multi-entity) search safe-by-exclusion for branch-restricted users.
export const BRANCH_SCOPED_ENTITIES: ReadonlySet<SearchEntity> = new Set([
  'invoice',
  'quotation',
  'purchase_order',
  'grn',
  'purchase_return',
  'payment',
  'warehouse',
]);

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
    for (const entity of ALL_SEARCH_ENTITIES) {
      const index = this.indexName(tenantId, entity);
      // number_of_replicas: 0 — search data is always re-derivable from Postgres via
      // fullReindex(), so a lost replica shard costs a slower recovery, not data loss. Halving
      // shard count this way matters at tenant-scale (see PG-049): tenant_count × 30 entities
      // × 2 shards/index accumulates into ES cluster-state bloat well before it's an incident.
      const result = await this.esRequest('PUT', `/${index}`, {
        settings: { number_of_shards: 1, number_of_replicas: 0, ...ERP_ANALYSIS_SETTINGS },
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
    for (const entity of ALL_SEARCH_ENTITIES) {
      const index = this.indexName(tenantId, entity);
      await this.esRequest('DELETE', `/${index}`);
      logger.info({ index }, 'ES index deleted');
    }
  }

  // Partial update (with upsert) rather than a full `_doc` PUT: lifecycle events for the
  // same entity often carry different subsets of fields (e.g. a status-change event may
  // only send {id, status}) — a full-document PUT would silently erase every field the
  // triggering event didn't happen to include. `_update` merges into whatever's already
  // indexed instead of replacing it, and `doc_as_upsert` creates the document on first sync.
  async index(
    tenantId: number,
    entity: SearchEntity,
    id: string,
    document: Record<string, unknown>
  ): Promise<void> {
    const index = this.indexName(tenantId, entity);
    const result = await this.esRequest('POST', `/${index}/_update/${id}`, {
      doc: {
        ...normalizeDocumentFields(document),
        tenantId: String(tenantId),
        _indexed_at: new Date().toISOString(),
      },
      doc_as_upsert: true,
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
      {
        ...normalizeDocumentFields(doc),
        tenantId: String(tenantId),
        _indexed_at: new Date().toISOString(),
      },
    ]);

    const result = await this.esRequest(
      'POST',
      '/_bulk',
      body.map((l) => JSON.stringify(l)).join('\n') + '\n'
    );
    const resp = result.data as {
      errors?: boolean;
      items?: Array<{ index?: { error?: unknown } }>;
    };
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
    const {
      entity,
      entities,
      size = 20,
      from = 0,
      filters = {},
      fuzziness = 'AUTO',
      branchIds,
      dateRange,
      attachmentEntityTypes,
      boostedIds,
    } = options;

    // Caller (search.routes.ts) passes `entities` for an untyped global search, restricted
    // to whatever the caller's permissions allow. An empty list means no entity is visible
    // to this caller — short-circuit rather than send ES an empty index-list path.
    if (entities && entities.length === 0) {
      return { hits: [], total: 0, took: 0 };
    }

    const indices = entity
      ? this.indexName(tenantId, entity)
      : entities
        ? entities.map((e) => this.indexName(tenantId, e)).join(',')
        : `erp_${tenantId}_*`;

    // Every text/keyword field declared across ENTITY_MAPPINGS must be listed here — ES simply
    // ignores a field that doesn't exist in a given index (safe for multi-index searches), but
    // a field missing from this list is never searchable at all, no matter what's indexed.
    const must: unknown[] = [
      {
        multi_match: {
          query,
          fields: [
            'name^3',
            'name.ngram^1',
            'sku^2',
            'barcode^2',
            'code^2',
            'gstin^2',
            'phone^2',
            'email^2',
            'invoiceNumber^2',
            'poNumber^2',
            'quotationNumber^2',
            'grnNumber^2',
            'returnNumber^2',
            'transferNumber^2',
            'adjustmentNumber^2',
            'paymentNumber^2',
            'journalId^2',
            'accountCode^2',
            'employeeCode^2',
            'customerName',
            'supplierName',
            'itemName',
            'employeeName',
            'description',
            'notes',
            'fileName',
          ],
          type: 'best_fields',
          fuzziness,
          prefix_length: 1,
        },
      },
    ];

    for (const [key, value] of Object.entries(filters)) {
      must.push({ term: { [key]: value } });
    }

    // Only meaningful for a single, branch-scoped `entity` search — see SearchOptions.branchIds.
    if (branchIds && branchIds.length > 0) {
      must.push({ terms: { branchId: branchIds.map(String) } });
    }

    // Only meaningful for `entity: 'attachment'` — see SearchOptions.attachmentEntityTypes.
    if (attachmentEntityTypes && attachmentEntityTypes.length > 0) {
      must.push({ terms: { entityType: attachmentEntityTypes } });
    }

    if (dateRange && (dateRange.from || dateRange.to)) {
      must.push({
        range: {
          [dateRange.field]: {
            ...(dateRange.from ? { gte: dateRange.from } : {}),
            ...(dateRange.to ? { lte: dateRange.to } : {}),
          },
        },
      });
    }

    const baseQuery = { bool: { must, filter: [{ term: { tenantId: String(tenantId) } }] } };
    // Smart Search: additive ranking boost for documents this tenant has previously clicked
    // on for this exact query text — falls back to plain BM25 ranking (baseQuery unchanged)
    // whenever there's no click history yet.
    const esQuery =
      boostedIds && boostedIds.length > 0
        ? {
            function_score: {
              query: baseQuery,
              boost_mode: 'sum' as const,
              functions: [{ filter: { terms: { _id: boostedIds } }, weight: 5 }],
            },
          }
        : baseQuery;

    const startTime = Date.now();
    const result = await this.esRequest('POST', `/${indices}/_search`, {
      from,
      size,
      query: esQuery,
      highlight: {
        fields: {
          name: {},
          customerName: {},
          supplierName: {},
          itemName: {},
          employeeName: {},
          invoiceNumber: {},
          poNumber: {},
          quotationNumber: {},
          grnNumber: {},
          returnNumber: {},
          transferNumber: {},
          adjustmentNumber: {},
          paymentNumber: {},
          journalId: {},
          accountCode: {},
          employeeCode: {},
          description: {},
          notes: {},
          fileName: {},
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
      // Index name is `erp_${tenantId}_${entity}` — entity itself may contain underscores
      // (e.g. 'purchase_order'), so drop only the fixed 'erp'/tenantId prefix segments.
      entity: h._index.split('_').slice(2).join('_') as SearchEntity,
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
    // number_of_replicas: 0 — see createTenantIndices() for rationale.
    await this.esRequest('PUT', `/${index}`, {
      settings: { number_of_shards: 1, number_of_replicas: 0, ...ERP_ANALYSIS_SETTINGS },
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

    logger.info(
      { tenantId, entity, indexed: totalIndexed, failed: totalFailed },
      'Full reindex complete'
    );
    return { indexed: totalIndexed, failed: totalFailed };
  }

  async getIndexStats(tenantId: number, entity: SearchEntity): Promise<unknown> {
    const index = this.indexName(tenantId, entity);
    const result = await this.esRequest('GET', `/${index}/_stats`);
    return result.data;
  }
}
