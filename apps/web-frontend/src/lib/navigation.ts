import {
  LayoutDashboard,
  Building2,
  Store,
  Warehouse,
  Users,
  Handshake,
  Truck,
  Package,
  Tag,
  BarChart3,
  FolderOpen,
  Sparkles,
  Ruler,
  DollarSign,
  RefreshCw,
  Pencil,
  Search,
  Layers,
  ShoppingCart,
  Receipt,
  ClipboardList,
  CreditCard,
  Undo2,
  Archive,
  LockOpen,
  FileText,
  Calculator,
  ShoppingBag,
  ClipboardCheck,
  Wallet,
  RotateCcw,
  Banknote,
  BookOpen,
  Zap,
  RefreshCcw,
  CalendarCheck,
  UserCog,
  CalendarClock,
  CalendarDays,
  Wallet2,
  Scissors,
  UserCircle2,
  Megaphone,
  CalendarRange,
  Factory,
  PackageCheck,
  TrendingDown,
  PieChart,
  Clock,
  Database,
  Activity,
  GitBranch,
  ShieldCheck,
  Gauge,
  Inbox,
  Landmark,
  FileSpreadsheet,
  Coins,
  KeyRound,
  ScrollText,
  Barcode,
  Globe,
  Flag,
  Fingerprint,
  Settings,
  Webhook,
  HelpCircle,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { PERMISSIONS, type Permission } from '../constants/permissions.js';

type LucideIcon = ComponentType<{ size?: number; className?: string }>;

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  children?: NavItem[];
  /** Permission required for this exact link, matching the PermissionRoute guard in App.tsx. Omit for items with children (visibility is derived from children) or routes with no guard. */
  permission?: Permission;
}

export interface NavGroup {
  groupLabel: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    groupLabel: 'WORKSPACE',
    items: [
      {
        label: 'Home',
        path: '/dashboard',
        icon: LayoutDashboard,
        permission: PERMISSIONS.DASHBOARD_VIEW,
      },
    ],
  },
  {
    groupLabel: 'SALES & CRM',
    items: [
      {
        label: 'Customers',
        path: '/customers',
        icon: Handshake,
        permission: PERMISSIONS.CUSTOMER_VIEW,
      },
      {
        label: 'Sales',
        path: '/sales',
        icon: ShoppingCart,
        children: [
          {
            label: 'Invoices',
            path: '/sales/invoices',
            icon: Receipt,
            permission: PERMISSIONS.INVOICE_VIEW,
          },
          {
            label: 'Quotations',
            path: '/sales/quotations',
            icon: ClipboardList,
            permission: PERMISSIONS.INVOICE_VIEW,
          },
          {
            label: 'Payments',
            path: '/sales/payments',
            icon: CreditCard,
            permission: PERMISSIONS.PAYMENT_VIEW,
          },
          {
            label: 'Returns',
            path: '/sales/returns',
            icon: Undo2,
            permission: PERMISSIONS.INVOICE_VIEW,
          },
          {
            label: 'Delivery Challans',
            path: '/sales/delivery-challans',
            icon: Archive,
            permission: PERMISSIONS.INVOICE_VIEW,
          },
        ],
      },
      {
        label: 'CRM',
        path: '/crm',
        icon: Megaphone,
        children: [
          {
            label: 'Segments',
            path: '/crm/segments',
            icon: UserCircle2,
            permission: PERMISSIONS.CRM_SEGMENT_VIEW,
          },
          {
            label: 'Campaigns',
            path: '/crm/campaigns',
            icon: Megaphone,
            permission: PERMISSIONS.CRM_VIEW,
          },
          {
            label: 'Seasons',
            path: '/crm/seasons',
            icon: CalendarRange,
            permission: PERMISSIONS.CRM_SEASON_VIEW,
          },
          {
            label: 'Campaign Settings',
            path: '/crm/campaign-settings',
            icon: Settings,
            permission: PERMISSIONS.CRM_AUTOMATION_MANAGE,
          },
        ],
      },
    ],
  },
  {
    groupLabel: 'INVENTORY',
    items: [
      {
        label: 'Inventory',
        path: '/inventory',
        icon: Package,
        children: [
          {
            label: 'Items',
            path: '/inventory/items',
            icon: Tag,
            permission: PERMISSIONS.ITEM_VIEW,
          },
          {
            label: 'Stock Levels',
            path: '/inventory/stock',
            icon: BarChart3,
            permission: PERMISSIONS.ITEM_VIEW,
          },
          {
            label: 'Categories',
            path: '/inventory/categories',
            icon: FolderOpen,
            permission: PERMISSIONS.CATEGORY_VIEW,
          },
          {
            label: 'Brands',
            path: '/inventory/brands',
            icon: Sparkles,
            permission: PERMISSIONS.BRAND_VIEW,
          },
          {
            label: 'Units',
            path: '/inventory/units',
            icon: Ruler,
            permission: PERMISSIONS.UNIT_VIEW,
          },
          {
            label: 'Price Lists',
            path: '/inventory/price-lists',
            icon: DollarSign,
            permission: PERMISSIONS.PRICE_LIST_VIEW,
          },
          {
            label: 'Transfers',
            path: '/inventory/transfers',
            icon: RefreshCw,
            permission: PERMISSIONS.WAREHOUSE_MANAGE,
          },
          {
            label: 'Adjustments',
            path: '/inventory/adjustments',
            icon: Pencil,
            permission: PERMISSIONS.WAREHOUSE_MANAGE,
          },
          {
            label: 'Physical Verification',
            path: '/inventory/physical-verifications',
            icon: Search,
            permission: PERMISSIONS.WAREHOUSE_MANAGE,
          },
          {
            label: 'Fabric Rolls',
            path: '/inventory/fabric-rolls',
            icon: Layers,
            permission: PERMISSIONS.ITEM_VIEW,
          },
          {
            label: 'Stock Valuation',
            path: '/inventory/valuation',
            icon: Coins,
            permission: PERMISSIONS.REPORT_VIEW,
          },
        ],
      },
      {
        label: 'Suppliers',
        path: '/suppliers',
        icon: Truck,
        permission: PERMISSIONS.SUPPLIER_VIEW,
      },
    ],
  },
  {
    groupLabel: 'PURCHASE',
    items: [
      {
        label: 'Purchase',
        path: '/purchase',
        icon: ShoppingBag,
        children: [
          {
            label: 'Purchase Orders',
            path: '/purchase/orders',
            icon: ClipboardList,
            permission: PERMISSIONS.PO_VIEW,
          },
          {
            label: 'GRNs',
            path: '/purchase/grns',
            icon: ClipboardCheck,
            permission: PERMISSIONS.GRN_VIEW,
          },
          {
            label: 'Supplier Payments',
            path: '/purchase/payments',
            icon: Wallet,
            permission: PERMISSIONS.PAYMENT_OUT_VIEW,
          },
          {
            label: 'Returns',
            path: '/purchase/returns',
            icon: RotateCcw,
            permission: PERMISSIONS.PURCHASE_RETURN_VIEW,
          },
          {
            label: 'Expenses',
            path: '/purchase/expenses',
            icon: Banknote,
            permission: PERMISSIONS.EXPENSE_VIEW,
          },
        ],
      },
    ],
  },
  {
    groupLabel: 'ACCOUNTING',
    items: [
      {
        label: 'GST',
        path: '/gst',
        icon: Calculator,
        children: [
          {
            label: 'GST Register',
            path: '/gst/register',
            icon: BookOpen,
            permission: PERMISSIONS.GST_VIEW,
          },
          {
            label: 'GSTR-1',
            path: '/gst/gstr1',
            icon: FileText,
            permission: PERMISSIONS.GSTR1_VIEW,
          },
          {
            label: 'GSTR-3B',
            path: '/gst/gstr3b',
            icon: FileText,
            permission: PERMISSIONS.GSTR3B_VIEW,
          },
          {
            label: 'GSTR-9 (Annual)',
            path: '/gst/gstr9',
            icon: FileText,
            permission: PERMISSIONS.GSTR9_VIEW,
          },
          {
            label: 'e-Invoice (IRN)',
            path: '/gst/einvoice',
            icon: Zap,
            permission: PERMISSIONS.GST_VIEW,
          },
          {
            label: 'GSTR-2A Recon',
            path: '/gst/gstr2a',
            icon: RefreshCcw,
            permission: PERMISSIONS.GSTR2A_RECONCILE,
          },
          {
            label: 'Compliance Calendar',
            path: '/gst/compliance',
            icon: CalendarCheck,
            permission: PERMISSIONS.GST_VIEW,
          },
        ],
      },
      {
        label: 'Accounting',
        path: '/accounting',
        icon: FileText,
        children: [
          {
            label: 'Chart of Accounts',
            path: '/accounting/chart-of-accounts',
            icon: FolderOpen,
            permission: PERMISSIONS.ACCOUNT_VIEW,
          },
          {
            label: 'Opening Balances',
            path: '/accounting/opening-balances',
            icon: LockOpen,
            permission: PERMISSIONS.OPENING_BALANCE_LOCK,
          },
          {
            label: 'Journal Entries',
            path: '/accounting/journals',
            icon: FileText,
            permission: PERMISSIONS.JOURNAL_VIEW,
          },
          {
            label: 'Trial Balance',
            path: '/accounting/reports/trial-balance',
            icon: FileText,
            permission: PERMISSIONS.TRIAL_BALANCE_VIEW,
          },
          {
            label: 'Profit & Loss',
            path: '/accounting/reports/profit-loss',
            icon: FileText,
            permission: PERMISSIONS.PROFIT_LOSS_VIEW,
          },
          {
            label: 'Balance Sheet',
            path: '/accounting/reports/balance-sheet',
            icon: FileText,
            permission: PERMISSIONS.BALANCE_SHEET_VIEW,
          },
          {
            label: 'Cash Flow',
            path: '/accounting/reports/cash-flow',
            icon: FileText,
            permission: PERMISSIONS.CASH_FLOW_VIEW,
          },
          {
            label: 'Bank Reconciliation',
            path: '/accounting/bank-reconciliation',
            icon: FileText,
            permission: PERMISSIONS.BANK_RECONCILIATION_VIEW,
          },
          {
            label: 'Financial Years',
            path: '/accounting/financial-years',
            icon: FileText,
            permission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
          },
          {
            label: 'Fixed Assets',
            path: '/accounting/fixed-assets',
            icon: FileText,
            permission: PERMISSIONS.FIXED_ASSET_VIEW,
          },
          {
            label: 'TDS',
            path: '/accounting/tds',
            icon: FileText,
            permission: PERMISSIONS.TDS_VIEW,
          },
          {
            label: 'Cost Centers',
            path: '/accounting/cost-centers',
            icon: FileText,
            permission: PERMISSIONS.COST_CENTER_VIEW,
          },
        ],
      },
    ],
  },
  {
    groupLabel: 'PRODUCTION',
    items: [
      {
        label: 'Job Work',
        path: '/production/job-work',
        icon: Factory,
        children: [
          {
            label: 'Orders',
            path: '/production/job-work',
            icon: ClipboardList,
            permission: PERMISSIONS.JOB_WORK_VIEW,
          },
          {
            label: 'New Order',
            path: '/production/job-work/new',
            icon: Pencil,
            permission: PERMISSIONS.JOB_WORK_CREATE,
          },
        ],
      },
      {
        label: 'Consignment',
        path: '/production/consignment',
        icon: PackageCheck,
        children: [
          {
            label: 'Stock',
            path: '/production/consignment/stock',
            icon: Package,
            permission: PERMISSIONS.CONSIGNMENT_VIEW,
          },
          {
            label: 'Settlements',
            path: '/production/consignment/settlements',
            icon: Wallet,
            permission: PERMISSIONS.CONSIGNMENT_VIEW,
          },
        ],
      },
      {
        label: 'Reorder Report',
        path: '/production/reorder',
        icon: TrendingDown,
        permission: PERMISSIONS.REORDER_VIEW,
      },
      {
        label: 'Barcode Labels',
        path: '/production/barcode-labels',
        icon: Barcode,
        permission: PERMISSIONS.BARCODE_GENERATE,
      },
    ],
  },
  {
    groupLabel: 'ANALYTICS',
    items: [
      {
        label: 'Dashboard',
        path: '/dashboard',
        icon: LayoutDashboard,
        permission: PERMISSIONS.DASHBOARD_VIEW,
      },
      {
        label: 'Reports',
        path: '/reports',
        icon: PieChart,
        children: [
          {
            label: 'Reports Browser',
            path: '/reports',
            icon: BarChart3,
            permission: PERMISSIONS.REPORT_VIEW,
          },
          {
            label: 'Schedules',
            path: '/reports/schedules',
            icon: Clock,
            permission: PERMISSIONS.REPORT_SCHEDULE,
          },
        ],
      },
    ],
  },
  {
    groupLabel: 'HR & PAYROLL',
    items: [
      {
        label: 'HR',
        path: '/hr',
        icon: UserCog,
        children: [
          {
            label: 'Employees',
            path: '/hr/employees',
            icon: Users,
            permission: PERMISSIONS.EMPLOYEE_VIEW,
          },
          {
            label: 'Attendance',
            path: '/hr/attendance',
            icon: CalendarClock,
            permission: PERMISSIONS.ATTENDANCE_VIEW,
          },
          {
            label: 'Leave',
            path: '/hr/leaves',
            icon: CalendarDays,
            permission: PERMISSIONS.LEAVE_VIEW,
          },
          {
            label: 'Payroll',
            path: '/hr/payroll',
            icon: Wallet2,
            permission: PERMISSIONS.PAYROLL_VIEW,
          },
          {
            label: 'PF Challan',
            path: '/hr/pf-challans',
            icon: Landmark,
            permission: PERMISSIONS.HR_STATUTORY,
          },
          {
            label: 'ESI Challan',
            path: '/hr/esi-challans',
            icon: Landmark,
            permission: PERMISSIONS.HR_STATUTORY,
          },
          {
            label: 'Form 16',
            path: '/hr/form16',
            icon: FileSpreadsheet,
            permission: PERMISSIONS.VIEW_SALARY_DETAILS,
          },
          {
            label: 'Alterations',
            path: '/hr/alterations',
            icon: Scissors,
            permission: PERMISSIONS.ALTERATION_VIEW,
          },
        ],
      },
    ],
  },
  {
    groupLabel: 'SETTINGS',
    items: [
      {
        label: 'Organization',
        path: '/settings/organization',
        icon: Building2,
        permission: PERMISSIONS.ORGANIZATION_VIEW,
      },
      {
        label: 'Branches',
        path: '/settings/branches',
        icon: Store,
        permission: PERMISSIONS.BRANCH_VIEW,
      },
      {
        label: 'Warehouses',
        path: '/settings/warehouses',
        icon: Warehouse,
        permission: PERMISSIONS.WAREHOUSE_VIEW,
      },
      { label: 'Users', path: '/users', icon: Users, permission: PERMISSIONS.USER_VIEW },
      {
        label: 'GST Config',
        path: '/gst/config',
        icon: Calculator,
        permission: PERMISSIONS.GST_VIEW,
      },
      {
        label: 'Feature Flags',
        path: '/admin/feature-flags',
        icon: Flag,
        permission: PERMISSIONS.FEATURE_FLAG_VIEW,
      },
      {
        label: 'SSO Configuration',
        path: '/settings/sso',
        icon: Fingerprint,
        permission: PERMISSIONS.SSO_CONFIG_MANAGE,
      },
      {
        label: 'Integrations',
        path: '/settings/integrations',
        icon: Webhook,
        permission: PERMISSIONS.INTEGRATION_WEBHOOK_MANAGE,
      },
      {
        label: 'FAQ Management',
        path: '/settings/faqs',
        icon: HelpCircle,
        permission: PERMISSIONS.PLATFORM_CONTENT_MANAGE,
      },
      { label: 'Security Settings', path: '/security', icon: KeyRound },
    ],
  },
  {
    groupLabel: 'SECURITY',
    items: [
      {
        label: 'Security Audit Log',
        path: '/admin/security-audit-log',
        icon: ScrollText,
        permission: PERMISSIONS.VIEW_AUDIT_LOG,
      },
      {
        label: 'Audit Logs',
        path: '/admin/audit-logs',
        icon: FileText,
        permission: PERMISSIONS.VIEW_AUDIT_LOG,
      },
    ],
  },
  {
    groupLabel: 'DISTRIBUTED SYSTEMS',
    items: [
      {
        label: 'Event Store',
        path: '/admin/distributed/events',
        icon: Database,
        permission: PERMISSIONS.EVENT_STORE_VIEW,
      },
      {
        label: 'Dead Letter Queue',
        path: '/admin/distributed/dlq',
        icon: Inbox,
        permission: PERMISSIONS.DLQ_VIEW,
      },
      {
        label: 'Saga Monitor',
        path: '/admin/distributed/sagas',
        icon: GitBranch,
        permission: PERMISSIONS.SAGA_VIEW,
      },
      {
        label: 'Schema Registry',
        path: '/admin/distributed/schemas',
        icon: ShieldCheck,
        permission: PERMISSIONS.SCHEMA_REGISTRY_VIEW,
      },
      {
        label: 'Projections',
        path: '/admin/distributed/projections',
        icon: Activity,
        permission: PERMISSIONS.PROJECTION_VIEW,
      },
      {
        label: 'Performance',
        path: '/admin/distributed/performance',
        icon: Gauge,
        permission: PERMISSIONS.PERFORMANCE_VIEW,
      },
      {
        label: 'Search Analytics',
        path: '/admin/search-analytics',
        icon: Search,
        permission: PERMISSIONS.SEARCH_REINDEX,
      },
    ],
  },
  {
    groupLabel: 'PLATFORM ADMIN',
    items: [
      {
        label: 'Tenants',
        path: '/admin/tenants',
        icon: Globe,
        permission: PERMISSIONS.PLATFORM_TENANT_MANAGE,
      },
    ],
  },
];

/** Keeps an item only if the user can access it: leaves need their own permission (or none, for unguarded routes); parents are kept if any child survives. */
export function filterNavItem(
  item: NavItem,
  hasPermission: (permission: string) => boolean
): NavItem | null {
  if (item.children) {
    const children = item.children
      .map((child) => filterNavItem(child, hasPermission))
      .filter((child): child is NavItem => child !== null);
    return children.length > 0 ? { ...item, children } : null;
  }
  if (item.permission && !hasPermission(item.permission)) return null;
  return item;
}

/** Finds the nav item (leaf or child leaf) exactly matching a path — used to resolve a
 * human label + icon for a route the user just visited (recent-pages tracking, §10). */
export function findNavItemByPath(groups: NavGroup[], path: string): NavItem | null {
  for (const group of groups) {
    for (const item of group.items) {
      if (item.path === path) return item;
      if (item.children) {
        const child = item.children.find((c) => c.path === path);
        if (child) return child;
      }
    }
  }
  return null;
}

export function filterNavGroups(
  groups: NavGroup[],
  hasPermission: (permission: string) => boolean
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) => filterNavItem(item, hasPermission))
        .filter((item): item is NavItem => item !== null),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * First leaf path the user can reach, in NAV_GROUPS declaration order — that order is the
 * configurable module priority for the post-login landing page. Returns null if the user
 * has no accessible *permission-gated* nav item at all.
 *
 * Deliberately ignores leaves with no `permission` (e.g. "Security Settings" — a personal
 * account page open to every logged-in user, not a business module the user was granted
 * access to). Landing there — or counting it as "the user has access to something" — would
 * defeat the point of the "no modules assigned" fallback for a genuinely permission-less
 * new user.
 */
export function getFirstAccessiblePath(
  groups: NavGroup[],
  hasPermission: (permission: string) => boolean
): string | null {
  function firstLeafPath(item: NavItem): string | null {
    if (!item.children) return item.permission && hasPermission(item.permission) ? item.path : null;
    for (const child of item.children) {
      const path = firstLeafPath(child);
      if (path) return path;
    }
    return null;
  }

  for (const group of groups) {
    for (const item of group.items) {
      const path = firstLeafPath(item);
      if (path) return path;
    }
  }
  return null;
}
