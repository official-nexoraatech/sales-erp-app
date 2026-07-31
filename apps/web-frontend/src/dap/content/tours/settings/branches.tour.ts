import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against branch.routes.ts / BranchesPage.tsx / BranchFormPage.tsx. Added: there's no
// Active/Inactive toggle anywhere in the UI — the only way isActive ever changes is a full
// (soft) delete, which also immediately removes the branch from every list. Fixed this session:
// Delete is now hidden for the Head Office row (the backend always rejects it) instead of
// showing a confirm dialog that's guaranteed to fail, and the GSTIN field now validates format.
const tour: TourDefinition = {
  id: 'settings-branches-overview',
  version: 1,
  type: 'quick',
  title: 'Branches — quick overview',
  description: 'Your shop/office locations — used everywhere a branch picker appears.',
  module: 'settings',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.BRANCH_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'settings/branches',
      title: 'Branches',
      body: "A new branch is immediately selectable everywhere — user assignment, invoices, POs, warehouses. There's no draft or activation step.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BRANCH_VIEW,
    },
    {
      id: 'add-branch',
      route: 'settings/branches',
      target: '[data-tour-id="settings-branches-create-button"]',
      title: 'Add a branch',
      body: 'New Branch → name, code, GSTIN (now format-validated), and address.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BRANCH_MANAGE,
    },
    {
      id: 'head-office',
      route: 'settings/branches',
      title: 'Head Office is a real, enforced singleton',
      body: 'Only one branch can be Head Office at a time — marking a new one automatically un-marks the previous one. The Head Office branch can never be deleted, so Delete no longer appears on that row.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BRANCH_VIEW,
    },
    {
      id: 'no-deactivate',
      route: 'settings/branches',
      title: 'No "deactivate" — only delete',
      body: "There's no Active/Inactive toggle anywhere in this UI. Delete is a soft delete (history is preserved) but it also removes the branch from every dropdown immediately — there's no in-between state where a branch is visible-but-unselectable.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.BRANCH_MANAGE,
    },
  ],
};

export default tour;
