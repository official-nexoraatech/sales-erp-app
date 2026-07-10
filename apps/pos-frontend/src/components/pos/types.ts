export interface CartItem {
  itemId: number;
  itemName: string;
  quantity: number;
  unitPrice: number;
  gstRate: number;
  discountPct: number;
  lineTotal: number;
}

export interface POSItem {
  id: number;
  name: string;
  salePrice?: string;
  gstRate?: number;
  barcode?: string;
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
