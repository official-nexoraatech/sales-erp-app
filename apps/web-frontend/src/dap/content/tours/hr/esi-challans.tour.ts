import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ESIChallanService.ts / ESIChallanPage.tsx. Same correction as PF Challans:
// the download is a real, correctly-computed CSV from real payroll data, but a generic one —
// not ESIC's actual official upload format.
const tour: TourDefinition = {
  id: 'hr-esi-challans-overview',
  version: 1,
  type: 'quick',
  title: 'ESI Challans — quick overview',
  description:
    "Employee State Insurance contribution figures computed from that month's approved payroll.",
  module: 'hr',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.HR_STATUTORY],
  steps: [
    {
      id: 'intro',
      route: 'hr/esi-challans',
      title: 'ESI Challans',
      body: "Real ESI figures — 0.75%/3.25% employee/employer split, only for employees whose gross is ₹21,000 or below — pulled from that month's already-approved payroll slips.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.HR_STATUTORY,
    },
    {
      id: 'requires-payroll',
      route: 'hr/esi-challans',
      title: 'Requires payroll approved for the month',
      body: 'A missing payroll run for the period gives you an actionable message, not a blank screen.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.HR_STATUTORY,
    },
    {
      id: 'download',
      route: 'hr/esi-challans',
      target: '[data-tour-id="hr-esi-challans-download-button"]',
      title: 'Download',
      body: "Exports a real CSV with per-employee gross/ESI amounts — useful for filing, but a generic CSV, not ESIC's official upload format. Verify what your actual filing process requires.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.HR_STATUTORY,
    },
  ],
};

export default tour;
