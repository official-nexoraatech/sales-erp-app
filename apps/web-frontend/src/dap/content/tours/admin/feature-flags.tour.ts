import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Major correction: the previous "Turn optional modules (POS, multi-branch, e-invoice,
// WhatsApp...) on or off" description overstates what these flags actually do. Grepped every
// service for real `.isEnabled()` call sites — only 3 flag keys are confirmed to gate real
// behavior (notification_quiet_hours, sales.loyalty.enabled, hr.tailoring.enabled). The five
// seeded flags shown with descriptions in the admin UI (einvoice_enabled, whatsapp_enabled,
// fifo_valuation, mfa_required, purchase_3way_match) have zero confirmed consumers anywhere —
// toggling them updates the database but doesn't change any observed behavior.
const tour: TourDefinition = {
  id: 'admin-feature-flags-overview',
  version: 1,
  type: 'quick',
  title: 'Feature Flags — quick overview',
  description:
    'A tenant-scoped kill switch — but only a few flags actually gate real behavior today.',
  module: 'admin',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.FEATURE_FLAG_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'admin/feature-flags',
      title: 'Feature Flags',
      body: 'A global default plus a per-tenant override, merged at read time — toggling here creates or updates the override for this tenant only.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FEATURE_FLAG_VIEW,
    },
    {
      id: 'only-some-are-wired',
      route: 'admin/feature-flags',
      title: 'Only a few flags actually control anything',
      body: 'Confirmed real: SMS quiet hours (suppresses SMS during a configured window), loyalty points (blocks earning/redemption when off), and the tailoring work-log endpoint. The other flags shown here — e-invoice, WhatsApp, FIFO valuation, MFA-required, 3-way match — are not currently checked anywhere in the code, so toggling them has no observed effect.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FEATURE_FLAG_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'quiet-hours',
      route: 'admin/feature-flags',
      title: 'Quiet Hours — a real, working example',
      body: 'A dedicated card lets you set a start/end hour; the notification engine genuinely reads this and holds back SMS sends during that window.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FEATURE_FLAG_UPDATE,
    },
    {
      id: 'toggle-immediately',
      route: 'admin/feature-flags',
      title: 'Toggling fires immediately, with no confirmation',
      body: "The switch mutates on click — no confirm dialog, even for flags whose description implies a significant policy change (like forcing MFA). Given several flags currently do nothing, this is lower-risk than the description text suggests, but don't assume every toggle here is safe by default going forward.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.FEATURE_FLAG_UPDATE,
    },
  ],
};

export default tour;
