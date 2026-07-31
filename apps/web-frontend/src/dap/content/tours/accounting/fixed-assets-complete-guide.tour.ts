import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `accounting-fixed-assets-overview`. Grounded against
// FixedAssetService.ts, FixedAssetsPage.tsx, FixedAssetDetailPage.tsx, FixedAssetFormPage.tsx.
// Key findings: SLM/WDV formulas are computed correctly but depreciation never runs on a
// schedule — someone has to trigger it; almost every field is locked after creation except the
// name; disposal correctly computes gain/loss but the cash/proceeds side isn't automatically
// posted to a bank account, a likely follow-up-entry gap.
const tour: TourDefinition = {
  id: 'accounting-fixed-assets-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Fixed Assets — complete guide',
  description:
    "Registering an asset, running depreciation correctly, and what disposal does (and doesn't) post automatically.",
  module: 'accounting',
  estimatedMinutes: 6,
  requiredPermissions: [PERMISSIONS.FIXED_ASSET_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'accounting/fixed-assets',
      title: 'Why this page exists',
      body: 'A register of long-lived assets — furniture, equipment, vehicles — whose cost is spread across their useful life as depreciation, rather than expensed all at once.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_VIEW,
    },
    {
      id: 'register',
      route: 'accounting/fixed-assets/new',
      title: 'Registering an asset',
      body: 'Cost, purchase date, salvage value, useful life, and method (SLM or WDV) — plus three specific accounts it will post to: the Asset account, Depreciation Expense, and Accumulated Depreciation.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_CREATE,
    },
    {
      id: 'locked-after-create',
      route: 'accounting/fixed-assets',
      title: 'Almost everything locks after creation',
      body: "Once saved, only the asset's Name stays editable — code, category, cost, dates, method, rate, and all three accounts are permanently fixed. Get these right the first time.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'depreciation-formulas',
      route: 'accounting/fixed-assets',
      title: 'SLM vs WDV, computed correctly',
      body: "Straight-Line Method spreads (cost − salvage) evenly across the useful life in months. Written-Down Value applies a fixed annual rate to the asset's current book value each period, so the depreciation amount shrinks over time. Both are capped so an asset never depreciates below its salvage value.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_VIEW,
    },
    {
      id: 'run-depreciation',
      route: 'accounting/fixed-assets',
      target: '[data-tour-id="accounting-fixed-assets-run-depreciation-button"]',
      title: 'Run Depreciation is a manual trigger',
      body: 'Depreciation does not post on a schedule by itself — pick a month/year and Run Depreciation posts it for every active asset at once: Dr Depreciation Expense / Cr Accumulated Depreciation. Each (asset, month, year) combination can only post once — running it again for an already-processed period is a safe no-op.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_UPDATE,
    },
    {
      id: 'schedule-view',
      route: 'accounting/fixed-assets',
      title: 'Depreciation Schedule',
      body: "On an individual asset's detail page — a real period-by-period register showing opening value, that period's depreciation, and closing value.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_VIEW,
    },
    {
      id: 'dispose',
      route: 'accounting/fixed-assets',
      target: '[data-tour-id="accounting-fixed-asset-dispose-button"]',
      title: 'Dispose Asset',
      body: "Enter the disposal date, proceeds, and a Gain/Loss account. Gain or loss is calculated automatically (proceeds minus current book value) and posted, clearing the asset's cost and accumulated depreciation. You'll be asked to confirm — this cannot be undone.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_DISPOSE,
    },
    {
      id: 'proceeds-gap',
      route: 'accounting/fixed-assets',
      title: "Disposal proceeds don't land in cash/bank automatically",
      body: "The disposal posting is complete for the asset's cost, accumulated depreciation, and gain/loss — but the proceeds figure itself is journaled into the gain/loss account, not a Cash or Bank account. If you actually received money for this asset, you likely need a separate manual entry to move it into cash/bank.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'business-impact',
      route: 'accounting/fixed-assets',
      title: 'What each action posts',
      body: "Two real journal-posting moments in this asset's life.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
      businessImpact: [
        'Run Depreciation: Dr Depreciation Expense / Cr Accumulated Depreciation, for every active asset, for the chosen period.',
        'Dispose: clears cost and accumulated depreciation, posts gain or loss — but not the cash side of the proceeds.',
        'Reports: Fixed Asset Register and Depreciation Schedule reflect these immediately; a cross-module "Depreciation Schedule" report in the Reports Hub is currently broken (references non-existent columns) — use the asset\'s own detail page instead.',
      ],
    },
    {
      id: 'best-practices',
      route: 'accounting/fixed-assets',
      title: 'Best practices',
      body: 'Get the setup right once, then run depreciation on a consistent cadence.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Triple-check cost, dates, method, and the three linked accounts before saving — none of them can be changed afterward.',
        'Run depreciation on a fixed monthly cadence rather than sporadically, so your books stay current.',
        'After disposing an asset with real proceeds, post a follow-up entry moving the amount into the correct cash/bank account.',
      ],
    },
  ],
};

export default tour;
