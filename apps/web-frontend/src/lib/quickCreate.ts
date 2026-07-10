import {
  Receipt, Handshake, Tag, ShoppingBag, ClipboardList, Truck, CreditCard, Users,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { PERMISSIONS, type Permission } from '../constants/permissions.js';

type LucideIcon = ComponentType<{ size?: number; className?: string }>;

export interface QuickCreateItem {
  label: string;
  path: string;
  icon: LucideIcon;
  permission: Permission;
}

/**
 * Per ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §11 — the top ~8 most-created
 * entity types, permission-filtered. Also surfaced by ERPCommandPalette's `>create` /
 * `>new` action mode (one registry, two entry points).
 */
export const QUICK_CREATE_ITEMS: QuickCreateItem[] = [
  { label: 'Invoice', path: '/sales/invoices/new', icon: Receipt, permission: PERMISSIONS.INVOICE_CREATE },
  { label: 'Quotation', path: '/sales/quotations/new', icon: ClipboardList, permission: PERMISSIONS.INVOICE_CREATE },
  { label: 'Customer', path: '/customers/new', icon: Handshake, permission: PERMISSIONS.CUSTOMER_CREATE },
  { label: 'Item', path: '/inventory/items/new', icon: Tag, permission: PERMISSIONS.ITEM_CREATE },
  { label: 'Purchase Order', path: '/purchase/orders/new', icon: ShoppingBag, permission: PERMISSIONS.PO_CREATE },
  { label: 'Supplier', path: '/suppliers/new', icon: Truck, permission: PERMISSIONS.SUPPLIER_CREATE },
  { label: 'Payment', path: '/sales/payments/new', icon: CreditCard, permission: PERMISSIONS.PAYMENT_CREATE },
  { label: 'Employee', path: '/hr/employees/new', icon: Users, permission: PERMISSIONS.EMPLOYEE_CREATE },
];

export function filterQuickCreateItems(
  items: QuickCreateItem[],
  hasPermission: (permission: string) => boolean,
): QuickCreateItem[] {
  return items.filter((item) => hasPermission(item.permission));
}
