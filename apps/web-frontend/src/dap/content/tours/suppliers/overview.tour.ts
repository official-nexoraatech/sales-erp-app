import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against supplier.routes.ts (sales-service) / SuppliersPage.tsx / SupplierFormPage.tsx.
// Corrected: "Click the supplier name for a 360° view of bills and payments" was fictional —
// clicking the name just opens the Edit form, nothing more. There's no 360/statement view
// reachable from this module at all, despite a real backend statement endpoint existing
// (unwired). Also corrected: Opening Balance is cosmetic — it's saved but never added to the
// real running balance that POs/GRNs/Payments actually update.
const tour: TourDefinition = {
  id: 'suppliers-overview',
  version: 1,
  type: 'quick',
  title: 'Suppliers — quick overview',
  description: 'Your supplier master — GSTIN, contact, and bank details.',
  module: 'suppliers',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.SUPPLIER_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'suppliers',
      title: 'Suppliers',
      body: "Your supplier master — used by Purchase Orders, GRNs, and Supplier Payments to look up who you're buying from.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SUPPLIER_VIEW,
    },
    {
      id: 'add-supplier',
      route: 'suppliers',
      target: '[data-tour-id="suppliers-create-button"]',
      title: 'Add a new supplier',
      body: 'Name, phone, GSTIN (format-checked), PAN, bank details, credit days, and an opening balance.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SUPPLIER_CREATE,
    },
    {
      id: 'opening-balance-cosmetic',
      route: 'suppliers',
      title: "Opening Balance doesn't feed your real running balance",
      body: "This field is saved on the supplier record, but it's not added to the balance that Purchase Orders, GRNs, and Payments actually track — that running balance always starts at zero regardless of what you enter here.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SUPPLIER_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'no-360-view',
      route: 'suppliers',
      title: "Clicking a supplier's name opens Edit, not a statement",
      body: "There's no 360°/statement view anywhere in this module. To see what you actually owe a supplier, check the AP Aging report under Reports — not here, and not in Purchase either.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SUPPLIER_VIEW,
    },
  ],
};

export default tour;
