import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `production-consignment-stock-overview` and
// `production-consignment-settlements-overview` — covers both pages together since they share
// one root cause. Grounded against ConsignmentService.ts (apps/production-service). The central
// finding: ConsignmentService.recordSale() is the only method that increments a consignment
// record's soldQty, and it has no HTTP route and no caller anywhere in the codebase — confirmed
// dead code, including by the integration test's own docstring ("no route/caller yet, confirmed
// dead code"). This cascades directly into Settlements always computing ₹0.
const tour: TourDefinition = {
  id: 'production-consignment-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Consignment Stock & Settlements — complete guide',
  description:
    "How consigned stock is modeled, the real gap between a sale and this module, and what Settlements can and can't do today.",
  module: 'production',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.CONSIGNMENT_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'production/consignment/stock',
      title: 'Why consignment stock is tracked separately',
      body: "Consigned goods belong to the supplier until you sell them — they shouldn't count as your owned inventory value. So they live in their own record, not mixed into your regular item stock table.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_VIEW,
    },
    {
      id: 'receive',
      route: 'production/consignment/stock',
      target: '[data-tour-id="production-consignment-stock-receive-button"]',
      title: 'Receiving consignment stock',
      body: "Supplier, item, warehouse, quantity, and the rate you've agreed to pay per unit once sold. This never posts to your books — by design, it's not yours yet.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_RECEIVE,
    },
    {
      id: 'the-real-gap',
      route: 'production/consignment/stock',
      title: "The missing link: a sale doesn't mark consigned stock as sold",
      body: "There's a real, correctly-written method in the backend for this — it would deduct the consignment record, reduce your item stock, and log the movement. But nothing calls it. No route exists for it, and no sales-invoice or POS code path invokes it either. Selling a consigned item today behaves like selling any other item — normal stock deduction happens, but the consignment record's Sold quantity never moves.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'warning',
    },
    {
      id: 'settlements-are-zero',
      route: 'production/consignment/settlements',
      title: 'Settlements inherit this gap directly',
      body: 'Create Settlement sums Sold Quantity × Agreed Rate across consignment records for a supplier and period. Since Sold Quantity is never populated through any real flow, every settlement you create today totals ₹0 and 0 units — this is not a display bug, the underlying number genuinely never accumulates.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'return',
      route: 'production/consignment/stock',
      target: '[data-tour-id="production-consignment-stock-return-button"]',
      title: 'Return — this part works correctly',
      body: 'Unlike the sale-tracking gap above, returning unsold consigned stock to the supplier is fully implemented: it atomically reduces available quantity, increments returned quantity, and updates status.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_RETURN,
    },
    {
      id: 'mark-settled',
      route: 'production/consignment/settlements',
      target: '[data-tour-id="production-consignment-settlements-mark-settled-button"]',
      title: 'Mark Settled is bookkeeping, not payment',
      body: "Records a status flip and whatever payment reference you type in. It never posts an accounting entry and doesn't move any money — you (or your accountant) still handle the actual payment and its journal entry separately.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_SETTLE,
    },
    {
      id: 'best-practices',
      route: 'production/consignment/stock',
      title: 'Best practices until this is fixed',
      body: 'Track sold consigned stock manually for now.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CONSIGNMENT_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Keep a manual record (spreadsheet or notebook) of which consigned units you've actually sold, since the system won't track it for you yet.",
        'Compute what you owe a consignor by hand until Settlements reflects real sales data.',
        'Use Return promptly for unsold consigned stock going back — that part of the flow is fully reliable.',
      ],
    },
  ],
};

export default tour;
