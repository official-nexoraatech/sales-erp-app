import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against organization.routes.ts / OrganizationPage.tsx / InvoiceFormPage.tsx /
// PurchaseOrderFormPage.tsx. Corrected: there's no logo upload control actually rendered on this
// page (the API method exists but nothing calls it) and no financial-year field at all. Added a
// real, important nuance: GSTIN changes here correctly drive CGST/SGST-vs-IGST on Sales
// Invoices/Quotations, but Purchase Orders still use a manually-picked (or silently defaulted)
// state, unaffected by this page.
const tour: TourDefinition = {
  id: 'settings-organization-overview',
  version: 1,
  type: 'quick',
  title: 'Organization Settings — quick overview',
  description: 'Your company profile, GSTIN, address, and branding — read live, not cached.',
  module: 'settings',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.ORGANIZATION_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'settings/organization',
      title: 'Organization Settings',
      body: 'Name, legal name, GSTIN, PAN, address, and branding colors/font. Saving takes effect immediately — every read of this data elsewhere in the app is live, never cached.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ORGANIZATION_VIEW,
    },
    {
      id: 'update-gstin',
      route: 'settings/organization',
      title: 'GSTIN drives Sales GST — but not Purchase',
      body: "Your GSTIN's state code correctly determines CGST/SGST vs IGST on Sales Invoices and Quotations, automatically, the moment you save. It has no effect on Purchase Orders, though — that form still uses its own manually-picked seller state (defaulting to Maharashtra if you don't set one).",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ORGANIZATION_VIEW,
    },
    {
      id: 'blank-gstin-risk',
      route: 'settings/organization',
      title: 'A blank GSTIN silently defaults to Maharashtra',
      body: "If GSTIN is left empty, Sales Invoice/Quotation GST calculations fall back to state code '27' (Maharashtra) rather than erroring — worth setting GSTIN early if your business isn't in Maharashtra.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ORGANIZATION_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'branding',
      route: 'settings/organization',
      title: 'Branding applies instantly, app-wide',
      body: 'Primary/secondary/accent colors, font, and corner radius apply live to every user of your tenant the moment you save — no page reload needed on their end.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ORGANIZATION_VIEW,
    },
    {
      id: 'no-logo-no-fy',
      route: 'settings/organization',
      title: 'No logo upload, no financial-year field here',
      body: "There's currently no logo-upload control on this page, and no financial-year setting either — despite what you may have heard, neither exists in this form today.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.ORGANIZATION_VIEW,
    },
  ],
};

export default tour;
