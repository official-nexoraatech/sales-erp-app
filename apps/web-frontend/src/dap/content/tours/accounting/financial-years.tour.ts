import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against FinancialYearsPage.tsx / FinancialYearService.ts. Important correction: the
// previous "Close a financial year" step said closing "locks the period" — it does not. Closing
// posts real closing journal entries (P&L → Retained Earnings) and runs a 10-point pre-close
// checklist, but checkPeriodOpen() (the guard every posting path calls) only reads a separate
// period_closures table, populated by a distinct "lock period" action that has no UI anywhere in
// this app today. So a "closed" year can still receive new postings unless/until that gap is
// closed. Stated plainly here rather than promised as working.
const tour: TourDefinition = {
  id: 'accounting-financial-years-overview',
  version: 1,
  type: 'quick',
  title: 'Financial Years — quick overview',
  description: 'Defines the accounting periods your reports and year-end close run against.',
  module: 'accounting',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.FINANCIAL_YEAR_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/financial-years',
      title: 'Financial Years',
      body: "Every tenant needs at least one financial year — Balance Sheet's Current Year Earnings and year-end closing both depend on one existing.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
    },
    {
      id: 'create',
      route: 'accounting/financial-years',
      target: '[data-tour-id="accounting-financial-years-create-button"]',
      title: 'Create a financial year',
      body: 'Enter a year code, start and end date, and optionally mark it "current". Required before several reports behave correctly.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
    },
    {
      id: 'checklist',
      route: 'accounting/financial-years',
      target: '[data-tour-id="accounting-financial-year-checklist-button"]',
      title: 'Run Checklist',
      body: 'A real 10-point pre-close check — open draft invoices, unallocated payments, unreconciled banks, trial-balance mismatch, pending approvals, and more. Resolve everything it flags before attempting to close.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
    },
    {
      id: 'close',
      route: 'accounting/financial-years',
      target: '[data-tour-id="accounting-financial-year-close-button"]',
      title: 'Close Year',
      body: "Posts real closing entries — moving the year's net profit or loss into Retained Earnings — and marks the year Closed. You'll be asked to confirm; this cannot be undone.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
    },
    {
      id: 'close-does-not-block-postings',
      route: 'accounting/financial-years',
      title: 'Closing does not, by itself, stop new postings',
      body: 'This is worth knowing precisely: Close Year posts the closing entries and marks the year historical, but it does not block someone from posting a new journal (manual or system-generated) dated into that year. There is currently no in-app way to actually lock a period against new postings — treat "closed" as an audit milestone, not a hard stop.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
  ],
};

export default tour;
