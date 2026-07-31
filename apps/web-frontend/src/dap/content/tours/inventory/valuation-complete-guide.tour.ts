import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `inventory-valuation-overview`. Grounded against ValuationService.ts
// and valuation.routes.ts (apps/inventory-service): this PAGE calls inventory-service's own
// live GET /inventory/valuation endpoint, which reads items.availableQty/waccCost directly —
// confirmed accurate and real-time. This is a materially different code path from a
// separately-audited, broken report-service query that happens to share a similar name — that
// one references database columns that don't exist and would error if run; it does not power
// this page. Do not conflate the two. Also grounded: Stock Adjustments never touch valuation
// (quantity-only), while Stock Transfers and GRN receipts both do.
const tour: TourDefinition = {
  id: 'inventory-valuation-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Stock Valuation — complete guide',
  description:
    'What your stock is actually worth, how that figure is calculated, and which actions change it.',
  module: 'inventory',
  estimatedMinutes: 5,
  requiredPermissions: [PERMISSIONS.REPORT_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'inventory/valuation',
      title: 'Why this page exists',
      body: "This shows the real, current cost value of everything you have on hand — quantity × unit cost, per item, using weighted-average costing. It's a live figure, not a scheduled/cached report; it reads the same cost fields every stock movement updates directly.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'who-uses-it',
      route: 'inventory/valuation',
      title: 'Who this is for',
      body: 'Accountants reconciling inventory as a balance-sheet asset, and owners/managers checking how much capital is tied up in stock — this figure is what typically feeds your Inventory line on the Balance Sheet.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'warehouse-filter',
      route: 'inventory/valuation',
      target: '[data-tour-id="inventory-valuation-warehouse-filter"]',
      title: 'Filter by warehouse',
      body: 'See value at one location instead of the tenant-wide total — useful for comparing how much capital is tied up at each branch.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'estimated-badge',
      route: 'inventory/valuation',
      title: 'The "Estimated" badge',
      body: "A row marked Estimated means this warehouse doesn't have its own tracked cost layer yet — you're seeing the tenant-wide average cost applied proportionally, not a true warehouse-specific figure. It's a reasonable approximation, not an error.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'export',
      route: 'inventory/valuation',
      title: 'Export CSV',
      body: "Downloads exactly what's currently on screen (respecting your warehouse and date filters) as a CSV, for sharing with accounts or archiving a point-in-time snapshot.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
    },
    {
      id: 'business-impact',
      route: 'inventory/valuation',
      title: 'What actually moves this number',
      body: 'Not every stock movement recalculates cost — only some do.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'GRN receipts and confirmed Sale invoices both recompute average cost — a GRN adds a new cost layer, a sale consumes one.',
        'Stock Transfers recompute cost on both legs — consuming cost basis at the source warehouse, creating a fresh layer at the destination.',
        "Stock Adjustments and Physical Verification variances do NOT recompute cost — they correct quantity only, so this page's per-unit cost is untouched by them even though quantity changes elsewhere.",
        'This page reads live, real-time figures — it is not the same data path as some other inventory reports elsewhere in the app, which may lag or be unreliable; trust this page specifically for current valuation.',
      ],
    },
    {
      id: 'common-mistakes',
      route: 'inventory/valuation',
      title: 'Common mistakes',
      body: 'Assuming every quantity change also updates cost is the main one.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        "Expecting a Stock Adjustment to correct the unit cost, not just the quantity — it doesn't; if the cost itself is wrong, that needs a different conversation with accounts.",
        'Reading an "Estimated" row as if it were a precise warehouse-specific figure — it\'s a proportional average, treat it as directionally useful, not exact.',
        'Confusing this page with other, similarly-named inventory reports elsewhere in the app — they may not read from the same live data this page does.',
      ],
    },
    {
      id: 'best-practices',
      route: 'inventory/valuation',
      title: 'Best practices',
      body: 'Use this as your real-time source, and export before any month-end close.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.REPORT_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Export a CSV snapshot at each month-end for your own audit trail, since this page always shows the current figure, not a historical one.',
        "Filter by warehouse when reconciling a specific branch's books rather than reading the tenant-wide total.",
        'If a value looks wrong, check whether it was a Stock Adjustment (quantity-only, cost untouched) or a real receipt/sale (which does recompute cost) before assuming the page is broken.',
      ],
    },
  ],
};

export default tour;
