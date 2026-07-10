// Which service(s) own each searchable entity's row data, for the search.full-reindex /
// search.incremental-sync jobs. Each source is a GET /api/v2/internal/search-sync/:entity
// endpoint (x-internal-key gated, same convention as every other internal.routes.ts in this
// codebase) that this job pages through. Most entities have exactly one owning service;
// 'payment' has two (customer payments in sales-service, supplier payments in
// purchase-service) — see SearchSyncConsumer's idPrefix comment for why their doc ids don't
// collide despite sharing one search index.
export interface SearchSyncSource {
  envVar: string;
  defaultUrl: string;
}

export const ENTITY_SOURCES: Record<string, SearchSyncSource[]> = {
  customer: [{ envVar: 'SALES_SERVICE_URL', defaultUrl: 'http://localhost:3013' }],
  supplier: [{ envVar: 'SALES_SERVICE_URL', defaultUrl: 'http://localhost:3013' }],
  invoice: [{ envVar: 'SALES_SERVICE_URL', defaultUrl: 'http://localhost:3013' }],
  quotation: [{ envVar: 'SALES_SERVICE_URL', defaultUrl: 'http://localhost:3013' }],
  crm_interaction: [{ envVar: 'SALES_SERVICE_URL', defaultUrl: 'http://localhost:3013' }],
  crm_segment: [{ envVar: 'SALES_SERVICE_URL', defaultUrl: 'http://localhost:3013' }],
  crm_campaign: [{ envVar: 'SALES_SERVICE_URL', defaultUrl: 'http://localhost:3013' }],
  item: [{ envVar: 'INVENTORY_SERVICE_URL', defaultUrl: 'http://localhost:3012' }],
  category: [{ envVar: 'INVENTORY_SERVICE_URL', defaultUrl: 'http://localhost:3012' }],
  brand: [{ envVar: 'INVENTORY_SERVICE_URL', defaultUrl: 'http://localhost:3012' }],
  unit: [{ envVar: 'INVENTORY_SERVICE_URL', defaultUrl: 'http://localhost:3012' }],
  warehouse: [{ envVar: 'INVENTORY_SERVICE_URL', defaultUrl: 'http://localhost:3012' }],
  stock_transfer: [{ envVar: 'INVENTORY_SERVICE_URL', defaultUrl: 'http://localhost:3012' }],
  stock_adjustment: [{ envVar: 'INVENTORY_SERVICE_URL', defaultUrl: 'http://localhost:3012' }],
  purchase_order: [{ envVar: 'PURCHASE_SERVICE_URL', defaultUrl: 'http://localhost:3020' }],
  grn: [{ envVar: 'PURCHASE_SERVICE_URL', defaultUrl: 'http://localhost:3020' }],
  purchase_return: [{ envVar: 'PURCHASE_SERVICE_URL', defaultUrl: 'http://localhost:3020' }],
  account: [{ envVar: 'ACCOUNTING_SERVICE_URL', defaultUrl: 'http://localhost:3019' }],
  journal_entry: [{ envVar: 'ACCOUNTING_SERVICE_URL', defaultUrl: 'http://localhost:3019' }],
  payment: [
    { envVar: 'SALES_SERVICE_URL', defaultUrl: 'http://localhost:3013' },
    { envVar: 'PURCHASE_SERVICE_URL', defaultUrl: 'http://localhost:3020' },
  ],
  employee: [{ envVar: 'HR_SERVICE_URL', defaultUrl: 'http://localhost:3021' }],
  attendance: [{ envVar: 'HR_SERVICE_URL', defaultUrl: 'http://localhost:3021' }],
  payroll_run: [{ envVar: 'HR_SERVICE_URL', defaultUrl: 'http://localhost:3021' }],
  leave_application: [{ envVar: 'HR_SERVICE_URL', defaultUrl: 'http://localhost:3021' }],
  user: [{ envVar: 'AUTH_SERVICE_URL', defaultUrl: 'http://localhost:3010' }],
  role: [{ envVar: 'AUTH_SERVICE_URL', defaultUrl: 'http://localhost:3010' }],
  branch: [{ envVar: 'TENANT_SERVICE_URL', defaultUrl: 'http://localhost:3011' }],
  organization: [{ envVar: 'TENANT_SERVICE_URL', defaultUrl: 'http://localhost:3011' }],
  // 'stock' (live per-warehouse quantity) and 'attachment' (no owning-entity listing
  // endpoint built in Phase 4) are intentionally absent — see search-sync.internal.routes.ts
  // in inventory-service for why 'stock' doesn't fit this row-based backfill mechanism.
};
