import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `inventory-adjustments-overview`. Grounded against
// StockAdjustmentService.ts (apps/inventory-service): approve() is the only step that touches
// stock, via InventoryLedgerService.adjustStock() — which writes inventory_ledger and
// projection_stock_level, but never calls ValuationService (unlike GRN/transfer receipt). An
// adjustment is a pure quantity correction; it never recomputes your average cost. No
// accounting journal is posted despite a STOCK_ADJUSTMENT_LOSS posting-matrix rule existing —
// accounting-service's Kafka consumer never subscribes to a stock-adjustment topic, so that
// rule is dead config. There's also no permission split between creating and approving — both
// use the same STOCK_ADJUST/WAREHOUSE_MANAGE check, even though a real STOCK_ADJUST_APPROVE
// permission exists in the catalog and is simply never enforced anywhere.
const tour: TourDefinition = {
  id: 'inventory-adjustments-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Stock Adjustments — complete guide',
  description:
    "Why adjustments exist, the submit-then-approve workflow, what approving actually changes (and doesn't), and the real risk of one person doing both steps.",
  module: 'inventory',
  estimatedMinutes: 7,
  requiredPermissions: [PERMISSIONS.WAREHOUSE_MANAGE, PERMISSIONS.STOCK_ADJUST],
  steps: [
    {
      id: 'purpose',
      route: 'inventory/adjustments',
      title: 'Why this page exists',
      body: 'An adjustment corrects your recorded stock quantity to match reality — damage, wastage, theft, expiry, a physical count discrepancy, or a quality rejection. It changes how much you have on paper; it does not explain why, which is what the Notes and Reason fields are for.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'when-to-use',
      route: 'inventory/adjustments',
      title: 'When to use an Adjustment',
      body: "Use it whenever the system's quantity is wrong and there's no other document to correct it through — a sale, purchase, or transfer already has its own flow. A Physical Verification with variances creates these automatically; create one directly here only for a one-off correction outside a formal count.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'prerequisites',
      route: 'inventory/adjustments',
      title: 'Before you start',
      body: "Know exactly what changed and why before opening the form — there's no detail page to review this later.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
      calloutTitle: 'Before you start',
      calloutVariant: 'warning',
      businessImpact: [
        "Once created, an adjustment can't be reopened to review its line items — there's no detail/view page for it, only the list. Note the number down if you'll need to reference it later.",
        "Pick the right Adjustment Type (Damage, Expiry, Theft, Shortage, Excess, Quality Issue, Sample Issued, Return to Vendor) — it's what shows up in any future reporting on why stock moved.",
        "Adjustments over ₹50,000 in value automatically route to PENDING_APPROVAL instead of SUBMITTED — same next step (Approve), just a signal that it's a bigger correction.",
      ],
    },
    {
      id: 'create-save',
      route: 'inventory/adjustments/new',
      title: 'Creating an adjustment',
      body: 'Pick the warehouse and type, add each affected item with a Direction (In to increase, Out to decrease) and quantity, then Save as Draft — nothing happens to stock yet.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.STOCK_ADJUST,
    },
    {
      id: 'submit',
      route: 'inventory/adjustments',
      target: '[data-tour-id="inventory-adjustments-submit-button"]',
      title: 'Submit',
      body: 'Moves a DRAFT to SUBMITTED (or PENDING_APPROVAL if the total value is over ₹50,000). Still no stock effect — submitting only makes it visible for approval.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.STOCK_ADJUST,
    },
    {
      id: 'approve',
      route: 'inventory/adjustments',
      target: '[data-tour-id="inventory-adjustments-approve-button"]',
      title: 'Approve — the moment stock actually changes',
      body: "This is the only step that touches real stock. It updates quantity on hand immediately and cannot be undone — there's no cancel once approved. It does not recompute your average cost; that stays exactly as it was.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.STOCK_ADJUST,
    },
    {
      id: 'business-impact',
      route: 'inventory/adjustments',
      title: 'What approving an adjustment touches',
      body: 'Less than you might assume — this is a quantity-only correction.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Inventory: available quantity changes immediately at the chosen warehouse.',
        'Valuation: untouched — your average cost per unit does not change, only the quantity it applies to.',
        'Accounting: no journal entry is posted today, even for a Damage/Theft/Expiry write-off — there is currently no accounting integration for adjustments.',
        'GST: no effect.',
        "Reports: Dashboard's low-stock and stock-value widgets update immediately (they read live from the item record); the dedicated Stock Movement/Adjustment reports elsewhere in the app may not currently return correct data — verify with your admin before relying on them for this.",
        'Customer Outstanding: no effect.',
      ],
    },
    {
      id: 'common-mistakes',
      route: 'inventory/adjustments',
      title: 'Common mistakes',
      body: 'The lack of a review step after approval is what trips people up.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        "Approving your own submission without a second person checking it — the system doesn't require a different approver, so this only happens if your team enforces it as a process.",
        "Expecting a write-off adjustment to hit an expense account — it doesn't; if you need the financial impact reflected, coordinate a manual journal entry with accounts.",
        "Forgetting there's no detail page — once approved, the only record is the list row (number, type, status, value, date), so keep external notes if you need the line-item detail later.",
      ],
    },
    {
      id: 'best-practices',
      route: 'inventory/adjustments',
      title: 'Best practices',
      body: "Compensate in process for what the system doesn't enforce.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Have a different person approve than the one who submitted, even though the system allows the same person to do both — treat the ₹50,000 threshold as a minimum bar, not the only trigger for a second look.',
        'Write a specific Note, not just a Type — "Damage" alone won\'t tell you six months from now what actually happened.',
        "Prefer a Physical Verification over a manual adjustment when you're correcting more than a couple of items — it gives you a system-qty-vs-counted comparison instead of typing in a guessed correction.",
      ],
    },
  ],
};

export default tour;
