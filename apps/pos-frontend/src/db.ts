import Dexie, { type Table } from 'dexie';

// OFFLINE-07: recorded on a stuck PendingSale when its sync failure was specifically a
// stock conflict (server-side INSUFFICIENT_STOCK), as opposed to a network/auth/other
// failure — lets the UI route it to conflict resolution instead of blind retry.
export interface StockConflict {
  itemId: number;
  available: number;
  requested: number;
}

// OFFLINE-02's queued-sale shape, unchanged by the OFFLINE-03 storage migration.
export interface PendingSale {
  id?: number;
  payload: Record<string, unknown>;
  // Client-generated at queue time and carried through every retry of this same queued
  // item, so the server can dedupe a repeated sync (see pos.routes.ts's POST /pos/sales).
  operationId: string;
  createdAt: number;
  retries: number;
  status: 'pending' | 'stuck';
  conflict?: StockConflict;
}

// Mirrors packages/db-client/src/schema/master.ts's `items` fields relevant to POS
// scan/sale (catalog browsing + tax calculation), not a redesign of the item model.
export interface CatalogItem {
  id: number;
  tenantId: number;
  itemCode?: string;
  name: string;
  barcode?: string;
  hsnCode: string;
  gstRate: number;
  cessRate: number;
  mrp?: number;
  salePrice: number;
  unitId: number;
  categoryId?: number;
  brandId?: number;
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  updatedAt: string;
}

// Mirrors packages/db-client/src/schema/master.ts's `customers` fields the POS needs
// for offline customer lookup at checkout.
export interface CachedCustomer {
  id: number;
  tenantId: number;
  branchId: number;
  displayName: string;
  phone: string;
  altPhone?: string;
  email?: string;
  customerType: 'RETAIL' | 'WHOLESALE' | 'B2B' | 'GOVERNMENT' | 'EXPORT';
  updatedAt: string;
}

// Mirrors packages/db-client/src/schema/master.ts's `priceListItems`.
export interface CachedPriceListItem {
  id: number;
  tenantId: number;
  priceListId: number;
  itemId: number;
  variantId?: number;
  salePrice: number;
  minQty: number;
  discountPercent: number;
  updatedAt: string;
}

// The backend has no separate tax-rate master — GST/cess rates live directly on
// `items` (see InvoiceService.ts). This store mirrors those two fields keyed by HSN
// code, for POS tax lookups that don't have a full cached item at hand.
export interface CachedTaxRate {
  hsnCode: string;
  tenantId: number;
  gstRate: number;
  cessRate: number;
  updatedAt: string;
}

// OFFLINE-05: local-only held sales (park/resume). Source of truth for park/resume —
// backend /pos/held-sales is only a best-effort audit copy, not required for this to work.
export interface HeldSale {
  id?: number;
  tenantId: number;
  branchId: number;
  label?: string;
  cart: unknown;
  customerId?: number;
  createdAt: number;
  updatedAt: number;
}

// OFFLINE-05: offline-queued customer creation, mirroring PendingSale's operationId
// dedupe pattern. localCustomerId is the negative placeholder id used in the `customers`
// table until the real server-assigned id comes back from sync.
export interface PendingCustomer {
  id?: number;
  payload: Record<string, unknown>;
  operationId: string;
  localCustomerId: number;
  createdAt: number;
  retries: number;
  status: 'pending' | 'stuck';
}

// Per-store sync cursor, for OFFLINE-04's delta sync to resume from.
export interface SyncMeta {
  store: string;
  lastSyncedAt: number;
  cursor?: string;
}

// OFFLINE-06: a mirror of auth.ts's localStorage-held tokens, readable from the service
// worker (which has no localStorage access) so Background Sync can authenticate a sync
// attempt fired after the tab that queued it has closed. Single fixed-key row.
export interface AuthTokenRecord {
  id: 'current';
  accessToken: string;
  refreshToken: string;
}

export class PosDatabase extends Dexie {
  pendingSales!: Table<PendingSale, number>;
  catalogItems!: Table<CatalogItem, number>;
  customers!: Table<CachedCustomer, number>;
  priceListItems!: Table<CachedPriceListItem, number>;
  taxRates!: Table<CachedTaxRate, string>;
  heldSales!: Table<HeldSale, number>;
  syncMeta!: Table<SyncMeta, string>;
  pendingCustomers!: Table<PendingCustomer, number>;
  authTokens!: Table<AuthTokenRecord, string>;

  constructor() {
    super('pos-offline');

    // Version 1 matches the pre-Dexie raw-IndexedDB schema exactly (same store name,
    // same autoIncrement keyPath) so Dexie recognizes an existing on-disk database
    // instead of colliding with it.
    this.version(1).stores({
      pending_sales: '++id',
    });

    // Version 2 renames pending_sales -> pendingSales (Dexie table-name convention)
    // and adds every OFFLINE-03 reference-data store. The upgrade callback copies any
    // already-queued sales across so devices with pending offline sales don't lose them.
    this.version(2)
      .stores({
        pending_sales: null,
        pendingSales: '++id',
        catalogItems: 'id, tenantId, barcode',
        customers: 'id, tenantId, phone, displayName',
        priceListItems: 'id, tenantId, priceListId, itemId',
        taxRates: 'hsnCode, tenantId',
        heldSales: '++id, tenantId, branchId',
        syncMeta: 'store',
      })
      .upgrade(async (tx) => {
        const old = await tx.table('pending_sales').toArray();
        if (old.length) {
          await tx.table('pendingSales').bulkAdd(old);
        }
      });

    // Version 3 (OFFLINE-05): queue for offline-created customers awaiting sync.
    this.version(3).stores({
      pendingCustomers: '++id, localCustomerId',
    });

    // Version 4 (OFFLINE-06): token mirror for the service worker's Background Sync handler.
    this.version(4).stores({
      authTokens: 'id',
    });
  }
}

export const db = new PosDatabase();
