import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// TDS is recorded from within a Supplier Payment — no standalone create action to spotlight
// on this page itself, left centered. Grounded against TDSPage.tsx / TDSService.ts. Corrected:
// "certificate" generation produces a data record with the totals, not an actual signed Form
// 16A PDF, and there's no filing/portal integration — this page is read-only, no button here
// actually generates or exports a certificate despite the backend having the capability.
const tour: TourDefinition = {
  id: 'accounting-tds-overview',
  version: 1,
  type: 'quick',
  title: 'TDS — quick overview',
  description: 'Track tax deducted on supplier and professional payments.',
  module: 'accounting',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.TDS_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/tds',
      title: 'TDS (Tax Deducted at Source)',
      body: "A read-only view of tax you've deducted from suppliers: a Monthly Liability summary and a quarterly 26Q-style table.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.TDS_VIEW,
    },
    {
      id: 'record',
      route: 'accounting/tds',
      title: 'Deduction is recorded on a Supplier Payment',
      body: 'There\'s no "record TDS" button here — when recording a supplier payment, enter the TDS section and rate applied there. It posts a real liability: Dr Expense / Cr TDS Payable.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.TDS_VIEW,
    },
    {
      id: 'no-certificate-here',
      route: 'accounting/tds',
      title: 'No certificate generation on this page',
      body: "The 26Q table gives you the raw figures for the quarter, but there's no button here to generate or download a Form 16A certificate — treat this page as your data source for filing manually, not a filing tool itself.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.TDS_VIEW,
    },
  ],
};

export default tour;
