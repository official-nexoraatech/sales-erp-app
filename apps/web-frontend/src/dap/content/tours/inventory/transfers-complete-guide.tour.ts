import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `inventory-transfers-overview`. Grounded against
// StockTransferService.ts (apps/inventory-service): dispatch() deducts stock from the source
// warehouse immediately; receive() only adds it to the destination once someone explicitly
// confirms receipt there. Between those two actions there's a real window where the stock is
// deducted from source but not yet present at destination — a genuine in-transit gap, not a
// display quirk. Unlike Stock Adjustments, transfers DO flow through ValuationService on both
// legs (consuming cost basis at source, creating a new layer at destination). Cancelling a
// dispatched-but-not-received transfer correctly adds the stock back to the source warehouse
// (a real bug fix, per the code comment in cancel()).
const tour: TourDefinition = {
  id: 'inventory-transfers-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Stock Transfers — complete guide',
  description:
    'The full Draft→Submit→Approve→Dispatch→Receive lifecycle, the real in-transit gap between dispatch and receipt, and what each step does to cost and quantity.',
  module: 'inventory',
  estimatedMinutes: 7,
  requiredPermissions: [PERMISSIONS.WAREHOUSE_MANAGE, PERMISSIONS.STOCK_TRANSFER],
  steps: [
    {
      id: 'purpose',
      route: 'inventory/transfers',
      title: 'Why this page exists',
      body: "A transfer moves stock from one of your warehouses to another — rebalancing inventory between branches, consolidating for a big order, or restocking a location that's running low.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'lifecycle',
      route: 'inventory/transfers',
      title: 'The five-step lifecycle',
      body: 'Draft → Submit → Approve → Dispatch → Receive. Each step is a separate, explicit action — nothing auto-advances, and each one is gated by its own button that only appears at the right status.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'create-save',
      route: 'inventory/transfers/new',
      title: 'Creating a transfer',
      body: 'Pick a From and To warehouse (they must differ) and add line items with quantities. Saving creates it as DRAFT — no stock has moved.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.STOCK_TRANSFER,
    },
    {
      id: 'submit-approve',
      route: 'inventory/transfers',
      target: '[data-tour-id="inventory-transfer-detail-submit-button"]',
      title: 'Submit, then Approve',
      body: "On the transfer's own detail page: Submit moves DRAFT to SUBMITTED, and Approve moves it to APPROVED. Neither step touches stock — they exist to get sign-off before anything physically moves.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.STOCK_TRANSFER,
    },
    {
      id: 'dispatch',
      route: 'inventory/transfers',
      target: '[data-tour-id="inventory-transfer-detail-dispatch-button"]',
      title: 'Dispatch — stock leaves the source warehouse now',
      body: "This is the first step that actually touches stock: quantity is deducted from the source warehouse immediately. It does not yet exist at the destination — that only happens on Receive. Between Dispatch and Receive, this stock genuinely isn't counted anywhere.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.STOCK_TRANSFER,
    },
    {
      id: 'receive',
      route: 'inventory/transfers',
      target: '[data-tour-id="inventory-transfer-detail-receive-button"]',
      title: 'Receive',
      body: 'Confirms what actually arrived and adds it to the destination warehouse. There are two ways to reach this: the "Receive" button right here on the detail page, or the list\'s row action, which opens a separate full-page form — both call the same action underneath.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.STOCK_TRANSFER,
    },
    {
      id: 'cancel',
      route: 'inventory/transfers',
      target: '[data-tour-id="inventory-transfer-detail-cancel-button"]',
      title: 'Cancel',
      body: "Available at any status except RECEIVED. If the transfer had already been dispatched, cancelling correctly adds that stock back to the source warehouse — it doesn't strand it in transit.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.STOCK_TRANSFER,
    },
    {
      id: 'business-impact',
      route: 'inventory/transfers',
      title: 'What each step touches',
      body: 'Dispatch and Receive are the two moments that matter — everything before them is just sign-off.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        "Inventory: Dispatch deducts from source immediately; Receive adds to destination only when confirmed — there's a real gap between the two where the stock is in neither location's count.",
        'Valuation: both legs run through the costing engine — Dispatch consumes cost basis at the source, Receive creates a fresh cost layer at the destination.',
        'Accounting: no journal entry — a transfer between your own warehouses has no financial effect.',
        'GST: no effect.',
        'Reports: Dashboard widgets reflect Dispatch/Receive immediately since they read the item record live.',
        'Customer Outstanding: no effect.',
      ],
    },
    {
      id: 'common-mistakes',
      route: 'inventory/transfers',
      title: 'Common mistakes',
      body: 'The in-transit gap is the one thing worth internalizing here.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        "Assuming dispatched stock is still available at the source — it's already deducted, even though it hasn't arrived anywhere else yet.",
        "Not receiving promptly after physical delivery — until someone clicks Receive, that stock is invisible to both warehouses' counts, which can cause a false stockout at the destination.",
        'Using the standalone "/receive" page without double-checking quantities against the item names — that page identifies items less clearly than the detail page\'s inline Receive.',
      ],
    },
    {
      id: 'best-practices',
      route: 'inventory/transfers',
      title: 'Best practices',
      body: 'Keep the in-transit window as short as possible.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Dispatch only when goods are actually leaving, not in advance — every hour between dispatch and receipt is stock neither warehouse can see.',
        'Receive the same day physical goods arrive, even if final put-away takes longer.',
        "Use Cancel (not just leaving it dispatched) if a transfer genuinely isn't going to be received — it correctly restores stock to the source instead of leaving it stranded.",
      ],
    },
  ],
};

export default tour;
