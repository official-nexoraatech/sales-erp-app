import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `inventory-physical-verifications-overview`. Grounded against
// PhysicalVerificationService.ts (apps/inventory-service): approve() inserts a stockAdjustments
// row with status 'APPROVED' directly and immediately applies it via
// InventoryLedgerService.adjustStock() for every non-zero-variance line, all in one DB
// transaction — it skips the normal DRAFT→SUBMIT→PENDING_APPROVAL flow entirely, including the
// ₹50,000 approval-threshold gate that a manually-created adjustment would go through. This is
// the single most important fact to get across: approving a verification is not a two-step
// review process, it's instant and final. Also grounded: the detail page renders nothing for
// the REVIEW and CANCELLED statuses (a real, if minor, gap — REVIEW in particular is never
// reachable through any UI action).
const tour: TourDefinition = {
  id: 'inventory-physical-verifications-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Physical Verifications — complete guide',
  description:
    'Snapshot, count, and approve — and why approving is instant and final, not a second review step.',
  module: 'inventory',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.WAREHOUSE_MANAGE],
  steps: [
    {
      id: 'purpose',
      route: 'inventory/physical-verifications',
      title: 'Why this page exists',
      body: 'A physical verification is a formal stock count — you tell the system what a warehouse actually has, it compares that against what it expects, and the difference (the variance) becomes a stock correction. This is the structured way to reconcile stock; a manual Stock Adjustment is the unstructured, one-off way.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'when-to-use',
      route: 'inventory/physical-verifications',
      title: 'When to run one',
      body: 'Periodic full-warehouse counts, a spot-check on a specific item you suspect is wrong, or after a stock-related incident where you need a documented before/after — the snapshot itself is a record of what the system believed at that exact moment.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'start',
      route: 'inventory/physical-verifications',
      target: '[data-tour-id="inventory-physical-verifications-create-button"]',
      title: '+ Start Verification',
      body: 'This is a modal, not a separate page — pick a warehouse and it creates the record and takes you straight to it. There\'s no bookmarkable "new" URL, only this button.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'start-counting',
      route: 'inventory/physical-verifications',
      target: '[data-tour-id="inventory-pv-detail-start-counting-button"]',
      title: 'Start Counting (Take Snapshot)',
      body: 'Freezes the system\'s current quantity for every item at this warehouse as the "System Qty" you\'ll count against. Do this right before you actually start counting on the floor — anything that moves stock after the snapshot but before you finish counting will show up as a false variance.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'save-counts',
      route: 'inventory/physical-verifications',
      target: '[data-tour-id="inventory-pv-detail-save-counts-button"]',
      title: 'Save Counts',
      body: "Records your physical counts and computes the variance per line as you go — this is safe to do incrementally, it doesn't touch real stock yet.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'approve',
      route: 'inventory/physical-verifications',
      target: '[data-tour-id="inventory-pv-detail-approve-button"]',
      title: 'Approve & Generate Adjustment — instant, not a review step',
      body: 'This is the moment everything becomes real, and it happens in one click: every line with a variance is turned into an approved, already-applied stock adjustment — automatically, in the same instant. Unlike a manually-created adjustment, this skips the submit/approve workflow and the ₹50,000 threshold entirely. Double-check your counts before clicking this.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
    },
    {
      id: 'business-impact',
      route: 'inventory/physical-verifications',
      title: 'What approving a verification touches',
      body: 'Everything a manual adjustment would — applied instantly, for every variance at once.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Inventory: every line with a variance updates quantity on hand immediately, at the verified warehouse.',
        'Valuation: untouched, same as a manual adjustment — this corrects quantity, not average cost.',
        'Accounting: no journal entry — same gap as manual adjustments.',
        'GST: no effect.',
        "Reports: Dashboard's stock widgets update immediately.",
        'Customer Outstanding: no effect.',
      ],
    },
    {
      id: 'common-mistakes',
      route: 'inventory/physical-verifications',
      title: 'Common mistakes',
      body: 'Treating Approve as a "review before applying" step is the big one.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        "Assuming you can review the generated adjustments before they apply — you can't; Approve both creates and applies them in the same action.",
        'Taking the snapshot too early — stock movements between snapshot and count show up as variances that were never really there.',
        "Not double-checking a large variance before approving — there's no undo once approved.",
      ],
    },
    {
      id: 'best-practices',
      route: 'inventory/physical-verifications',
      title: 'Best practices',
      body: 'Time the snapshot carefully and review counts before the final click.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.WAREHOUSE_MANAGE,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Pause other stock activity at that warehouse (or count fast) between snapshot and finishing counts, to keep variances real rather than timing artifacts.',
        "Review every non-trivial variance with whoever did the physical count before clicking Approve — it's your only checkpoint.",
        "Use this instead of a manual Stock Adjustment whenever you're correcting more than a couple of items — it gives you the system-vs-counted comparison a manual adjustment doesn't.",
      ],
    },
  ],
};

export default tour;
