export interface CartItem {
  itemId: number;
  itemName: string;
  quantity: number;
  unitPrice: number;
  // Multi-vertical platform audit 2026-08-16, Phase 2: MRP existed on items but was never
  // carried into the cart/receipt — a near-universal Indian retail/grocery display
  // expectation. null when the item has no MRP set (e.g. most cloth-retail items today).
  mrp: number | null;
  gstRate: number;
  cessRate: number;
  discountPct: number;
  lineTotal: number;
}

export interface POSItem {
  id: number;
  name: string;
  salePrice?: string;
  mrp?: number | null;
  gstRate?: number;
  cessRate?: number;
  barcode?: string;
}

// GET /pos/items/search result row — see pos.routes.ts
export interface POSSearchResult {
  itemId: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  alias: string | null;
  supplierCode: string | null;
  customCode: string | null;
  price: number;
  mrp: number | null;
  gstRate: number;
  cessRate: number;
  // null when this result came from the offline catalog fallback (useItemSearch.ts) — no
  // stock quantity is synced to the client (no /sync/stock endpoint exists), so a live count
  // is only ever available when the search actually reached the server.
  stock: { qty: number | null };
  matchedOn: 'code' | 'supplierCode' | 'customCode' | 'alias' | 'name';
}

export interface Customer {
  id: number;
  displayName: string;
  phone: string;
  loyaltyPoints?: number;
}

export interface CompletedSale {
  invoiceId: number;
  invoiceNumber: string;
  grandTotal: number;
  lines: CartItem[];
  customer: Customer | null;
  paymentMode: 'CASH' | 'CARD' | 'UPI';
  amountTendered: number;
  change: number;
  // OFFLINE-05: false for a sale that was queued locally and hasn't reached the server
  // yet — there is no real invoice to attach a WhatsApp/Email receipt-send to until it syncs.
  synced: boolean;
}
