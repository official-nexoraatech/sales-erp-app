import {
  type LucideIcon,
  Users, Truck, Package, Tag, Bookmark, Ruler, Warehouse, ArrowLeftRight,
  SlidersHorizontal, FileText, ShoppingCart, Undo2, Landmark, BookOpen,
  CreditCard, UserCog, Shield, Building2, Building, Paperclip, MessageSquare,
  CalendarCheck, Wallet, CalendarOff,
} from 'lucide-react';
import type { SearchHit } from '../api/endpoints.js';

export interface SearchEntityConfig {
  label: string;
  groupLabel: string;
  icon: LucideIcon;
  // Not every entity has a dedicated detail page yet (e.g. GRN/purchase orders only have a
  // list page today) — routes to the closest real page. Returning undefined (or omitting
  // `route` entirely) renders an informational, non-navigable row instead of linking to
  // something that doesn't exist.
  route?: (hit: SearchHit) => string | undefined;
}

function titleField(hit: SearchHit, ...fields: string[]): string {
  for (const f of fields) {
    const v = hit.source[f];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return hit.entity;
}

export const SEARCH_ENTITY_CONFIG: Record<string, SearchEntityConfig> = {
  customer: { label: 'Customer', groupLabel: 'Customers', icon: Users, route: (h) => `/customers/${h.id}` },
  supplier: { label: 'Supplier', groupLabel: 'Suppliers', icon: Truck, route: (h) => `/suppliers/${h.id}/edit` },
  item: { label: 'Item', groupLabel: 'Inventory', icon: Package, route: (h) => `/inventory/items/${h.id}/edit` },
  category: { label: 'Category', groupLabel: 'Inventory', icon: Tag, route: () => '/inventory/categories' },
  brand: { label: 'Brand', groupLabel: 'Inventory', icon: Bookmark, route: () => '/inventory/brands' },
  unit: { label: 'Unit', groupLabel: 'Inventory', icon: Ruler, route: () => '/inventory/units' },
  warehouse: { label: 'Warehouse', groupLabel: 'Inventory', icon: Warehouse, route: () => '/settings/warehouses' },
  stock_transfer: { label: 'Stock Transfer', groupLabel: 'Inventory', icon: ArrowLeftRight, route: (h) => `/inventory/transfers/${h.id}` },
  stock_adjustment: { label: 'Stock Adjustment', groupLabel: 'Inventory', icon: SlidersHorizontal, route: () => '/inventory/adjustments' },
  invoice: { label: 'Invoice', groupLabel: 'Sales', icon: FileText, route: (h) => `/sales/invoices/${h.id}` },
  quotation: { label: 'Quotation', groupLabel: 'Sales', icon: FileText, route: (h) => `/sales/quotations/${h.id}` },
  crm_interaction: { label: 'Interaction', groupLabel: 'CRM', icon: MessageSquare, route: (h) => (h.source['customerId'] ? `/customers/${h.source['customerId']}` : undefined) },
  crm_segment: { label: 'Segment', groupLabel: 'CRM', icon: MessageSquare },
  crm_campaign: { label: 'Campaign', groupLabel: 'CRM', icon: MessageSquare },
  purchase_order: { label: 'Purchase Order', groupLabel: 'Purchase', icon: ShoppingCart, route: () => '/purchase/orders' },
  grn: { label: 'GRN', groupLabel: 'Purchase', icon: Truck, route: () => '/purchase/grns' },
  purchase_return: { label: 'Purchase Return', groupLabel: 'Purchase', icon: Undo2, route: () => '/purchase/returns' },
  account: { label: 'Account', groupLabel: 'Accounting', icon: Landmark, route: (h) => `/accounting/accounts/${h.id}/ledger` },
  journal_entry: { label: 'Journal Entry', groupLabel: 'Accounting', icon: BookOpen },
  payment: { label: 'Payment', groupLabel: 'Accounting', icon: CreditCard },
  employee: { label: 'Employee', groupLabel: 'HR', icon: Users, route: (h) => `/hr/employees/${h.id}` },
  attendance: { label: 'Attendance', groupLabel: 'HR', icon: CalendarCheck, route: () => '/hr/attendance' },
  payroll_run: { label: 'Payroll Run', groupLabel: 'HR', icon: Wallet, route: () => '/hr/payroll' },
  leave_application: { label: 'Leave', groupLabel: 'HR', icon: CalendarOff, route: () => '/hr/leaves' },
  user: { label: 'User', groupLabel: 'Settings', icon: UserCog, route: () => '/users' },
  role: { label: 'Role', groupLabel: 'Settings', icon: Shield },
  branch: { label: 'Branch', groupLabel: 'Settings', icon: Building2, route: () => '/settings/branches' },
  organization: { label: 'Organization', groupLabel: 'Settings', icon: Building, route: () => '/settings/organization' },
  attachment: { label: 'Attachment', groupLabel: 'Documents', icon: Paperclip },
};

export function getSearchResultTitle(hit: SearchHit): string {
  return titleField(
    hit,
    'name', 'displayName', 'invoiceNumber', 'quotationNumber', 'poNumber', 'grnNumber',
    'returnNumber', 'transferNumber', 'adjustmentNumber', 'paymentNumber', 'employeeName',
    'journalId', 'fileName', 'description', 'notes',
    // Fallbacks for entities whose number is assigned late (e.g. a GRN/purchase return's
    // number isn't generated until approval — see grn.routes.ts/purchase-return.routes.ts) —
    // shows the party name instead of the bare entity string for that DRAFT window.
    'supplierName', 'customerName', 'itemName'
  );
}

export function getSearchResultSubtitle(hit: SearchHit): string | undefined {
  const parts: string[] = [];
  const s = hit.source;
  if (typeof s['status'] === 'string') parts.push(s['status']);
  if (typeof s['amount'] === 'string' || typeof s['amount'] === 'number') parts.push(`₹${s['amount']}`);
  if (typeof s['phone'] === 'string') parts.push(s['phone']);
  if (typeof s['email'] === 'string') parts.push(s['email']);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function getSearchResultRoute(hit: SearchHit): string | undefined {
  const config = SEARCH_ENTITY_CONFIG[hit.entity];
  if (!config?.route) return undefined;
  const route = config.route(hit);
  return route || undefined;
}
