import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `admin-feature-flags-overview`. Grounded against a repo-wide grep for
// `.isEnabled(` across every service. This guide exists to give an honest, per-flag account of
// what's real, since the page itself presents all flags with equal-looking descriptions
// regardless of whether anything actually reads them.
const tour: TourDefinition = {
  id: 'admin-feature-flags-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Feature Flags — complete guide',
  description:
    "A precise, per-flag account of what's actually wired to real behavior versus what only updates a database row.",
  module: 'admin',
  estimatedMinutes: 5,
  requiredPermissions: [PERMISSIONS.FEATURE_FLAG_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'admin/feature-flags',
      title: 'How flags resolve',
      body: 'Each flag has a global default; a tenant-level row overrides it. The merge happens at read time, and an "Override" badge shows when your tenant has its own value rather than inheriting the platform default.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FEATURE_FLAG_VIEW,
    },
    {
      id: 'real-flag-quiet-hours',
      route: 'admin/feature-flags',
      title: 'Confirmed real: Quiet Hours',
      body: 'The notification engine genuinely reads this and suppresses SMS sends during your configured window. Has its own dedicated start/end-hour card with a Save button.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FEATURE_FLAG_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
    },
    {
      id: 'real-flag-loyalty',
      route: 'admin/feature-flags',
      title: 'Confirmed real: Loyalty Points',
      body: 'Sales-service checks this before earning or redeeming loyalty points — disabled means customers silently earn zero points on new sales, not an error, just no accrual.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FEATURE_FLAG_VIEW,
      calloutTitle: 'Business impact',
      calloutVariant: 'info',
    },
    {
      id: 'real-flag-tailoring',
      route: 'admin/feature-flags',
      title: 'Confirmed real: Tailoring Work Log',
      body: "HR-service blocks the tailor work-log endpoint outright when this is off. Note: this flag key isn't in the page's own description list, so it may show with \"No description available\" if you look for it — that's expected, not a bug.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FEATURE_FLAG_VIEW,
    },
    {
      id: 'decorative-flags',
      route: 'admin/feature-flags',
      title: 'Not wired to anything, despite having descriptions',
      body: 'e-Invoice Enabled, WhatsApp Enabled, FIFO Valuation, MFA Required, and Purchase 3-Way Match all have specific, plausible-sounding descriptions in this UI — but none of them are checked anywhere in the actual domain code. Toggling any of these updates the database and does nothing else.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FEATURE_FLAG_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'new-tenants-default-off',
      route: 'admin/feature-flags',
      title: "The two behavior-gating flags aren't seeded for new tenants",
      body: "Tailoring and Loyalty aren't included in the provisioning pipeline's default flag rows — a freshly-created tenant has no row for either and gets the safe default of Off until someone explicitly creates an override here.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FEATURE_FLAG_VIEW,
    },
    {
      id: 'best-practices',
      route: 'admin/feature-flags',
      title: 'Best practices',
      body: 'Verify before you rely on a toggle.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FEATURE_FLAG_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        "If you're enabling Loyalty or Tailoring for a new tenant, do it explicitly here — don't assume it's already on by default.",
        "Don't rely on the e-invoice/WhatsApp/FIFO/MFA/3-way-match flags to actually change behavior until you've independently confirmed they're wired — check with engineering if a specific one matters to you.",
        "Use Quiet Hours confidently — it's the most thoroughly verified real flag in this list.",
      ],
    },
  ],
};

export default tour;
