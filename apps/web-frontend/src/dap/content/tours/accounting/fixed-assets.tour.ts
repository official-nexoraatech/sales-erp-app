import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against FixedAssetsPage.tsx / FixedAssetDetailPage.tsx / FixedAssetService.ts. Added:
// depreciation is calculated correctly (real SLM/WDV formulas) but never runs on its own — a
// user must explicitly trigger it each period. Also: editing is heavily restricted after
// creation (only the asset name), and disposal proceeds post to the gain/loss account rather
// than a cash/bank account — a likely follow-up-entry gap worth flagging, not promising away.
const tour: TourDefinition = {
  id: 'accounting-fixed-assets-overview',
  version: 1,
  type: 'quick',
  title: 'Fixed Assets — quick overview',
  description: 'Track assets like furniture and equipment, and their depreciation over time.',
  module: 'accounting',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.FIXED_ASSET_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/fixed-assets',
      title: 'Fixed Assets',
      body: 'Track assets like furniture and equipment, and their depreciation over time.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_VIEW,
    },
    {
      id: 'register',
      route: 'accounting/fixed-assets',
      target: '[data-tour-id="accounting-fixed-assets-create-button"]',
      title: 'Register a fixed asset',
      body: "New Asset → enter cost, purchase date, and depreciation method (SLM or WDV), plus the Asset/Depreciation Expense/Accumulated Depreciation accounts it posts to. After creation, only the asset's name can still be edited — double-check the rest before saving.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_VIEW,
    },
    {
      id: 'depreciation',
      route: 'accounting/fixed-assets',
      target: '[data-tour-id="accounting-fixed-assets-run-depreciation-button"]',
      title: 'Run Depreciation',
      body: 'Depreciation is calculated correctly but never posts on its own — you (or a scheduled process outside this page) must explicitly run it for a chosen month/year. It then posts a real journal for every active asset at once: Dr Depreciation Expense / Cr Accumulated Depreciation.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_VIEW,
    },
    {
      id: 'dispose',
      route: 'accounting/fixed-assets',
      target: '[data-tour-id="accounting-fixed-asset-dispose-button"]',
      title: 'Dispose Asset',
      body: "On the asset's own detail page. Calculates gain or loss automatically and posts it, clearing the asset's cost and accumulated depreciation. Worth knowing: the disposal proceeds themselves post to the gain/loss account, not to a cash/bank account — you may need a separate manual entry to reflect the cash actually received.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FIXED_ASSET_VIEW,
    },
  ],
};

export default tour;
