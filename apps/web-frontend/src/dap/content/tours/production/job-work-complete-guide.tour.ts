import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `production-job-work-overview`. Grounded against
// JobWorkOrderService.ts (apps/production-service). Key findings: the real lifecycle skips
// IN_PROGRESS entirely (defined but never set); Issue Materials and Complete are the only two
// moments that touch stock, both correctly implemented including a proper reversal on Cancel;
// QC results are a genuine audit log but have zero enforcement power over completion; no
// accounting entry is ever posted for job-work charges despite them being computed and stored.
const tour: TourDefinition = {
  id: 'production-job-work-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Job Work Orders — complete guide',
  description:
    "The real Draft→Issue→QC→Complete lifecycle, exactly when stock moves, and why QC doesn't block completion.",
  module: 'production',
  estimatedMinutes: 7,
  requiredPermissions: [PERMISSIONS.JOB_WORK_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'production/job-work',
      title: 'Why this page exists',
      body: 'When you outsource a processing step — dyeing, printing, stitching — to an external worker, a Job Work Order tracks the raw material you send out and the finished goods that come back, with a real cost calculation attached.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_VIEW,
    },
    {
      id: 'lifecycle',
      route: 'production/job-work',
      title: 'The real lifecycle: Draft → Material Issued → Quality Check → Completed',
      body: 'Four real states, plus Cancelled from any non-terminal one. An "In Progress" status is defined in the code but never actually reachable — don\'t expect to see it.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_VIEW,
    },
    {
      id: 'create',
      route: 'production/job-work/new',
      title: 'Creating an order',
      body: 'Supplier (the job worker), output item, ordered quantity, job work rate, and the raw materials required with their quantities and unit costs. Saved as Draft — no stock effect yet.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_CREATE,
    },
    {
      id: 'issue-materials',
      route: 'production/job-work',
      target: '[data-tour-id="production-job-work-detail-issue-materials-button"]',
      title: 'Issue Materials — the first real stock movement',
      body: "Deducts every material line from your warehouse, atomically, with an insufficient-stock guard that blocks the whole action if any line can't be covered. Moves the order to Material Issued.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_ISSUE_MATERIALS,
    },
    {
      id: 'qc-page',
      route: 'production/job-work',
      target: '[data-tour-id="production-job-work-detail-qc-complete-link-button"]',
      title: 'Quality Check / Complete page',
      body: 'Two independent sections: a piece-by-piece PASS/FAIL/REWORK log, and a separate Received/Rejected/Scrap quantity entry that actually drives completion.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_QUALITY_CHECK,
    },
    {
      id: 'qc-is-a-log-not-a-gate',
      route: 'production/job-work',
      title: "QC results don't block anything",
      body: "Save QC Entries only writes to an audit log — it has no effect on order status and is never read by the Complete action. You can mark an order Completed having logged zero QC entries, or having logged every piece as FAIL. Rejected/Scrap quantities are typed in separately and aren't cross-checked against the QC log or against what was actually issued.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_QUALITY_CHECK,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'complete',
      route: 'production/job-work',
      target: '[data-tour-id="production-job-work-qc-complete-button"]',
      title: 'Mark as Completed — the second real stock movement',
      body: "Adds Received Qty to your finished-goods stock, computing a real per-unit cost from materials cost plus job work charges divided by quantity received. Rejected and Scrap quantities are recorded as adjustment entries for your own audit trail — they don't re-add or further deduct stock, since that material was already consumed at Issue.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_COMPLETE,
    },
    {
      id: 'cancel',
      route: 'production/job-work',
      target: '[data-tour-id="production-job-work-detail-cancel-button"]',
      title: 'Cancel',
      body: "Available at any non-terminal status. If materials were already issued, cancelling correctly reverses that deduction and restores the stock — it doesn't strand it. Uses a browser prompt for the cancellation reason, not a full dialog.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_CANCEL,
    },
    {
      id: 'business-impact',
      route: 'production/job-work',
      title: 'What each step touches',
      body: 'Two real stock moments; no accounting entry, ever.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Issue Materials: deducts raw material stock immediately, guarded against insufficient quantity.',
        'Complete: adds finished-goods stock with a real computed unit cost.',
        "Job work charges are computed and stored on the order for your own reference, but never post as an accounts-payable liability to the job worker — there's no accounting integration for job work today.",
        'Cancel after Issue: correctly reverses the raw-material deduction.',
      ],
    },
    {
      id: 'best-practices',
      route: 'production/job-work',
      title: 'Best practices',
      body: 'Compensate for the missing QC gate with process discipline.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "Review the QC log yourself before clicking Mark as Completed — the system won't stop you from completing over failed pieces.",
        "Track job-work charges payable to the worker outside the system (or with a manual accounting journal) since it doesn't post automatically.",
        "Double-check Received/Rejected/Scrap quantities against what was actually issued before completing — there's no automatic reconciliation.",
      ],
    },
  ],
};

export default tour;
