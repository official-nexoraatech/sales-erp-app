import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `accounting-financial-years-overview`. Grounded against
// FinancialYearService.ts (closeYear, lockPeriod, checkPeriodOpen). The central finding this
// guide exists to explain clearly: "Close Year" and "lock a period against postings" are two
// different, disconnected concepts in this codebase, and only the second one actually blocks
// new transactions — but there's no UI anywhere to trigger it.
const tour: TourDefinition = {
  id: 'accounting-financial-years-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Financial Years — complete guide',
  description:
    "What Close Year actually does, why it doesn't block new postings on its own, and the real 10-point checklist behind it.",
  module: 'accounting',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.FINANCIAL_YEAR_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'accounting/financial-years',
      title: 'Why this page exists',
      body: 'Defines the periods your financial statements and year-end close operate against. Every tenant needs at least one — several reports assume one exists.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
    },
    {
      id: 'create',
      route: 'accounting/financial-years',
      target: '[data-tour-id="accounting-financial-years-create-button"]',
      title: 'Create a financial year',
      body: 'Year code, start date, end date, and optionally "set as current". Genuinely required — without at least one, Balance Sheet\'s Current Year Earnings figure has nothing to compute from.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_OPEN,
    },
    {
      id: 'checklist',
      route: 'accounting/financial-years',
      target: '[data-tour-id="accounting-financial-year-checklist-button"]',
      title: 'Run Checklist',
      body: 'A genuine 10-point pre-close check: open draft invoices, open GRNs, unallocated payments on both sides, unreconciled bank items, trial-balance mismatch, unpublished background events, pending stock verifications, pending approvals. Closing is blocked outright if anything here fails.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_CLOSE,
    },
    {
      id: 'close',
      route: 'accounting/financial-years',
      target: '[data-tour-id="accounting-financial-year-close-button"]',
      title: 'Close Year',
      body: "Posts a real closing journal — your year's net profit or loss moves into Retained Earnings via an Income Summary account — and marks the year Closed. You'll be asked to confirm; this cannot be undone.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_CLOSE,
    },
    {
      id: 'the-real-gap',
      route: 'accounting/financial-years',
      title: 'Closing does not lock the period against new postings',
      body: 'This is the single most important thing to understand about this page: "Close Year" and "block new postings into this year" are two separate mechanisms. Closing only does the former. The guard every posting goes through checks a completely separate table, populated by a distinct "lock period" action that has no button anywhere in this app today.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'warning',
    },
    {
      id: 'bypass-paths',
      route: 'accounting/financial-years',
      title: 'Two posting paths bypass period locking entirely',
      body: "Even where a period IS locked (via the separate mechanism above), TDS deduction entries and fixed-asset depreciation/disposal postings currently skip that check altogether — every other posting path respects it, these two don't.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
    },
    {
      id: 'business-impact',
      route: 'accounting/financial-years',
      title: 'What closing actually does',
      body: 'A real, permanent accounting action — with a narrower scope than the name implies.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Posts a real closing journal moving net P&L into Retained Earnings.',
        'Marks the year Closed and no longer "current" — a historical audit milestone.',
        'Does NOT, by itself, stop anyone from posting a new manual or system-generated journal dated into that year.',
      ],
    },
    {
      id: 'common-mistakes',
      route: 'accounting/financial-years',
      title: 'Common mistakes',
      body: 'Don\'t assume "Closed" means "locked."',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
      calloutTitle: 'Common mistakes',
      calloutVariant: 'warning',
      businessImpact: [
        'Treating "Close Year" as a hard stop against further postings into that year — it isn\'t one today.',
        "Skipping Run Checklist and going straight for Close Year — the close will simply fail if anything's outstanding, so checking first saves a round trip.",
        "Assuming depreciation and TDS postings respect a locked period the same way invoices and payments do — they currently don't.",
      ],
    },
    {
      id: 'best-practices',
      route: 'accounting/financial-years',
      title: 'Best practices',
      body: 'Compensate with process discipline until period-locking has real coverage.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FINANCIAL_YEAR_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Run the checklist well before your target close date so you have time to resolve what it flags.',
        "After closing a year, manually confirm no one posts a backdated journal into it — the system won't stop them.",
        'Keep depreciation and TDS entries current each period, since they can post into any year regardless of close status.',
      ],
    },
  ],
};

export default tour;
