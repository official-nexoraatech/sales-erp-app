import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Major correction: this page has NO GSTIN or registered-state fields — those live on
// Settings → Organization instead (confirmed: GstConfigPage.tsx has no GSTIN/state input
// anywhere). This page is tenant-level GST rates + HSN reference data + a standalone tax
// calculator, grounded against the real GstConfigPage.tsx.
const tour: TourDefinition = {
  id: 'gst-config-overview',
  version: 1,
  type: 'quick',
  title: 'GST Configuration — quick overview',
  description: 'Standard GST rates, HSN code lookup, and a standalone tax calculator.',
  module: 'gst',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.GST_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'gst/config',
      title: 'GST Configuration',
      body: "Three tools: a GST Rates reference list, an HSN code lookup, and a standalone GST calculator. Your tenant's actual GSTIN lives elsewhere — see the next step.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'gstin-elsewhere',
      route: 'gst/config',
      title: 'Your GSTIN is set on Settings → Organization',
      body: "This page doesn't have a GSTIN or registered-state field. That's configured once, on your tenant's Organization Settings page — come back here for rates and HSN reference only.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'seed-rates',
      route: 'gst/config',
      target: '[data-tour-id="gst-config-seed-rates-button"]',
      title: 'Seed Default Rates',
      body: "New tenants: this creates the standard set of GST rate slabs in one click. There's no way to add or edit an individual rate afterward from this page — it's seed-once, not manage-individually.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'hsn-lookup',
      route: 'gst/config',
      target: '[data-tour-id="gst-config-hsn-search-button"]',
      title: 'HSN Lookup',
      body: "Search by HSN code or description — read-only reference results, useful when setting an item's HSN code elsewhere.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
    {
      id: 'calculator',
      route: 'gst/config',
      target: '[data-tour-id="gst-config-compute-button"]',
      title: 'GST Calculator',
      body: "Enter a taxable amount, rate, and whether it's interstate — Compute shows the CGST/SGST or IGST breakdown. This is a standalone what-if tool; it doesn't save or configure anything.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.GST_VIEW,
    },
  ],
};

export default tour;
