/**
 * Busy Accounting → ERP Canonical Format Transformer
 *
 * Maps Busy's column names to ERP canonical column names.
 * Busy uses regional language headers in some exports — this handles
 * the most common English export format.
 */

import type { BusyRawRow } from './busy-extractor.js';
import type {
  CanonicalCustomer,
  CanonicalSupplier,
  CanonicalItem,
} from '../../types.js';

// ── Helper ────────────────────────────────────────────────────────────────────

function num(val: string | undefined): number {
  const n = parseFloat((val ?? '0').replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function str(val: string | undefined): string {
  return (val ?? '').trim();
}

// ── Customer mapping ──────────────────────────────────────────────────────────
// Busy account export columns (English mode):
//   Account Name, Group, Address, City, State, Pin Code,
//   Mobile, Email, GST Number, PAN Number, Opening Balance, Credit Limit

export function transformBusyCustomer(row: BusyRawRow): CanonicalCustomer {
  return {
    displayName: str(row['account_name'] ?? row['name'] ?? row['party_name']),
    companyName: str(row['company_name'] ?? row['firm_name']),
    gstin: str(row['gst_number'] ?? row['gstin'] ?? row['gst_no']),
    pan: str(row['pan_number'] ?? row['pan_no'] ?? row['pan']),
    phone: str(row['mobile'] ?? row['phone'] ?? row['mobile_no']),
    email: str(row['email'] ?? row['email_id']),
    address: str(row['address']),
    city: str(row['city']),
    state: str(row['state']),
    pincode: str(row['pin_code'] ?? row['pincode'] ?? row['pin']),
    creditLimit: num(row['credit_limit']),
    openingBalance: num(row['opening_balance'] ?? row['op_balance']),
  };
}

// ── Supplier mapping ──────────────────────────────────────────────────────────

export function transformBusySupplier(row: BusyRawRow): CanonicalSupplier {
  return {
    displayName: str(row['account_name'] ?? row['name'] ?? row['party_name']),
    companyName: str(row['company_name'] ?? row['firm_name']),
    gstin: str(row['gst_number'] ?? row['gstin'] ?? row['gst_no']),
    phone: str(row['mobile'] ?? row['phone']),
    email: str(row['email'] ?? row['email_id']),
    address: str(row['address']),
    city: str(row['city']),
    state: str(row['state']),
    pincode: str(row['pin_code'] ?? row['pincode']),
    openingBalance: num(row['opening_balance'] ?? row['op_balance']),
  };
}

// ── Item mapping ──────────────────────────────────────────────────────────────
// Busy stock item export columns:
//   Item Name, Group, Unit, HSN Code, GST Rate, Sale Rate, Purchase Rate

export function transformBusyItem(row: BusyRawRow): CanonicalItem {
  // Busy stores GST rate as "5%", "18%" etc — strip the %
  const gstRaw = str(row['gst_rate'] ?? row['gst_%'] ?? '0').replace('%', '');
  return {
    name: str(row['item_name'] ?? row['name']),
    sku: str(row['item_code'] ?? row['code'] ?? row['sku']),
    hsnCode: str(row['hsn_code'] ?? row['hsn'] ?? row['hsn/sac']),
    gstRate: num(gstRaw),
    unit: str(row['unit'] ?? row['uom'] ?? 'Pieces'),
    category: str(row['group'] ?? row['category']),
    brand: str(row['brand']),
    sellingPrice: num(row['sale_rate'] ?? row['selling_price'] ?? row['mrp']),
    costPrice: num(row['purchase_rate'] ?? row['cost_price']),
    minSalePrice: num(row['minimum_rate'] ?? row['min_price']),
  };
}
