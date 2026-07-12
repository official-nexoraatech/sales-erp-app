import { useLocation, Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

// Kept for any code that imported it — no longer used at runtime
export type RouteHandle = Record<string, never>;

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  settings: 'Settings',
  organization: 'Organization',
  branches: 'Branches',
  warehouses: 'Warehouses',
  users: 'Users',
  customers: 'Customers',
  suppliers: 'Suppliers',
  inventory: 'Inventory',
  categories: 'Categories',
  brands: 'Brands',
  units: 'Units',
  items: 'Items',
  'price-lists': 'Price Lists',
  stock: 'Stock Levels',
  transfers: 'Transfers',
  adjustments: 'Adjustments',
  'physical-verifications': 'Physical Verifications',
  'fabric-rolls': 'Fabric Rolls',
  gst: 'GST',
  config: 'Configuration',
  accounting: 'Accounting',
  'chart-of-accounts': 'Chart of Accounts',
  accounts: 'Accounts',
  'opening-balances': 'Opening Balances',
  'cost-centers': 'Cost Centers',
  sales: 'Sales',
  quotations: 'Quotations',
  invoices: 'Invoices',
  payments: 'Payments',
  returns: 'Returns',
  'delivery-challans': 'Delivery Challans',
  new: 'New',
  edit: 'Edit',
  receive: 'Receive',
};

function toLabel(seg: string): string {
  if (/^\d+$/.test(seg)) return 'Detail';
  return SEGMENT_LABELS[seg] ?? seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ERPBreadcrumb() {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  // Only show breadcrumbs when there are at least 2 segments (not on /dashboard alone)
  if (segments.length <= 1) return null;

  let path = '';
  const crumbs = segments.map((seg, i) => {
    path += `/${seg}`;
    const isLast = i === segments.length - 1;
    return { label: toLabel(seg), to: isLast ? undefined : path };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-secondary">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} className="text-disabled shrink-0" />}
            {isLast || !crumb.to ? (
              <span className={isLast ? 'font-medium text-primary' : 'text-secondary'}>
                {crumb.label}
              </span>
            ) : (
              <Link to={crumb.to} className="text-secondary hover:text-primary transition-colors">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
