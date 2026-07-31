import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against JobWorkOrderService.ts / JobWorkOrderDetailPage.tsx /
// JobWorkQualityCheckPage.tsx. Corrected: the real lifecycle is Draft → Material Issued →
// Quality Check → Completed (IN_PROGRESS is a defined-but-unreachable status). "Record materials
// received back" is a real step, but it happens on the order's own Quality Check page, not on
// this list.
const tour: TourDefinition = {
  id: 'production-job-work-overview',
  version: 1,
  type: 'quick',
  title: 'Job Work Orders — quick overview',
  description: 'Send materials to an outside job worker for processing and track their return.',
  module: 'production',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.JOB_WORK_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'production/job-work',
      title: 'Job Work Orders',
      body: 'Send raw material to an outside job worker (dyeing, printing, stitching) and track it through to finished goods coming back.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_VIEW,
    },
    {
      id: 'create-order',
      route: 'production/job-work',
      target: '[data-tour-id="production-job-work-create-button"]',
      title: 'Create a job work order',
      body: "Select the job worker, output item, and the raw materials required. Creating the order doesn't touch stock yet — it's just the plan, saved as Draft.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_CREATE,
    },
    {
      id: 'issue-materials',
      route: 'production/job-work',
      target: '[data-tour-id="production-job-work-detail-issue-materials-button"]',
      title: 'Issue Materials',
      body: "On the order's own detail page — this is the step that actually deducts raw material from your warehouse. If there isn't enough stock, it's blocked outright.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_ISSUE_MATERIALS,
    },
    {
      id: 'qc-and-complete',
      route: 'production/job-work',
      target: '[data-tour-id="production-job-work-detail-qc-complete-link-button"]',
      title: 'Quality Check / Complete',
      body: 'Opens a dedicated page: log piece-by-piece PASS/FAIL/REWORK results, then enter Received/Rejected/Scrap quantities and Mark as Completed. Completing adds the received quantity to your finished-goods stock.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_QUALITY_CHECK,
    },
    {
      id: 'qc-not-a-gate',
      route: 'production/job-work',
      title: "QC entries don't block completion",
      body: "Logging PASS/FAIL results is a real audit record, but it doesn't stop you from completing the order — even if every piece failed. Received/Rejected/Scrap quantities are typed in independently and aren't automatically cross-checked against the QC log.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.JOB_WORK_QUALITY_CHECK,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
  ],
};

export default tour;
