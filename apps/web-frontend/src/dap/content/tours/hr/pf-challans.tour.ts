import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against PFChallanService.ts / PFChallanPage.tsx. Corrected: the download is a real,
// correctly-computed CSV of UAN/name/EPF amounts from real payroll data — but it's a generic
// CSV, not EPFO's actual ECR upload file format. Softened "download for EPFO filing" accordingly
// so it doesn't overpromise a ready-to-upload government file.
const tour: TourDefinition = {
  id: 'hr-pf-challans-overview',
  version: 1,
  type: 'quick',
  title: 'PF Challans — quick overview',
  description: "Provident Fund contribution figures computed from that month's approved payroll.",
  module: 'hr',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.HR_STATUTORY],
  steps: [
    {
      id: 'intro',
      route: 'hr/pf-challans',
      title: 'PF Challans',
      body: "Real PF figures — 12% of basic (capped at ₹15,000 basic) split employee/employer/EPS — pulled from that month's already-approved payroll slips.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.HR_STATUTORY,
    },
    {
      id: 'requires-payroll',
      route: 'hr/pf-challans',
      title: 'Requires payroll approved for the month',
      body: "If payroll for that period hasn't been run and approved yet, you'll get a clear message telling you so, not a blank screen.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.HR_STATUTORY,
    },
    {
      id: 'download',
      route: 'hr/pf-challans',
      target: '[data-tour-id="hr-pf-challans-download-button"]',
      title: 'Download',
      body: "Exports a real CSV with per-employee UAN, name, and EPF amounts — useful for filing, but it's a generic CSV, not EPFO's official ECR upload format. Check what your filing process actually needs before assuming this uploads directly.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.HR_STATUTORY,
    },
    {
      id: 'mark-filed',
      route: 'hr/pf-challans',
      title: 'Mark as Filed',
      body: "Records that you've filed this period's challan — a simple status flag for your own tracking, with no confirmation prompt since it's low-risk and reversible on the backend.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.HR_STATUTORY,
    },
  ],
};

export default tour;
