import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against CostCentersPage.tsx / JournalFormPage.tsx / AccountFormPage.tsx /
// ProfitLossPage.tsx / accounting.ts schema comment. Confirmed genuinely wired in (not a
// decorative master-data list): every journal line can carry a cost center, accounts can have
// a default one, and there's a real "By Cost Center" P&L view — but the DB balance-check
// trigger ignores it entirely, so it's optional/analytical, never a posting control.
const tour: TourDefinition = {
  id: 'accounting-cost-centers-overview',
  version: 1,
  type: 'quick',
  title: 'Cost Centers — quick overview',
  description:
    'Tag income/expense to a branch, department, or project for more granular reporting.',
  module: 'accounting',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.COST_CENTER_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'accounting/cost-centers',
      title: 'Cost Centers',
      body: 'Tag income/expense to a branch, department, or project for more granular reporting. Optionally hierarchical — a cost center can have a parent.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.COST_CENTER_VIEW,
    },
    {
      id: 'create',
      route: 'accounting/cost-centers',
      target: '[data-tour-id="accounting-cost-centers-create-button"]',
      title: 'Create a cost center',
      body: 'New Cost Center → code, name, optional parent → Save. Deactivating one later is a soft action — it just stops being selectable for new postings, existing history is untouched.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.COST_CENTER_VIEW,
    },
    {
      id: 'usage',
      route: 'accounting/cost-centers',
      title: 'Where cost centers actually get used',
      body: 'Set a default cost center on an account (Chart of Accounts) so it auto-fills on postings, or pick one explicitly per line on a manual journal. Once you have real activity tagged, Profit & Loss offers a "By Cost Center" breakdown.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.COST_CENTER_VIEW,
    },
    {
      id: 'not-a-control',
      route: 'accounting/cost-centers',
      title: 'Optional, not a balancing requirement',
      body: "A journal still only needs debits to equal credits — cost center tags are purely for analysis and reporting, they're never checked for balance.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.COST_CENTER_VIEW,
    },
  ],
};

export default tour;
