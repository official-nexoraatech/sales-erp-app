import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Major correction: the previous version described a "connect your WhatsApp Business or SMS
// gateway account" action — no such credential-connection UI exists anywhere on this page.
// Grounded against CampaignSettingsPage.tsx. This page is tenant POLICY (approval requirement,
// frequency caps, rate limit) plus display-only sender identity — not integration credentials.
// Also corrects: the old CRM-scoped webhook config here was a dead link; it's now an honest
// redirect notice to Settings → Integrations, a real, separate, working feature.
const tour: TourDefinition = {
  id: 'crm-campaign-settings-overview',
  version: 1,
  type: 'quick',
  title: 'Campaign Settings — quick overview',
  description:
    'Tenant-wide policy for campaigns: approval requirement, frequency caps, and sender identity.',
  module: 'crm',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.CRM_AUTOMATION_MANAGE],
  steps: [
    {
      id: 'intro',
      route: 'crm/campaign-settings',
      title: 'Campaign Settings',
      body: 'Not a place to connect WhatsApp/SMS provider accounts — that happens outside this app, with your provider directly. This page controls policy: who must approve a campaign, how many messages a customer can get per day, and your send rate limit.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_AUTOMATION_MANAGE,
    },
    {
      id: 'approval-toggle',
      route: 'crm/campaign-settings',
      title: 'Require approval before sending',
      body: "Turn this on and every campaign must go through Submit for Approval → a manager's Approve before Send Now or Schedule become available — this is exactly what drives the approval workflow on the Campaigns page.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_AUTOMATION_MANAGE,
    },
    {
      id: 'frequency-and-rate',
      route: 'crm/campaign-settings',
      title: 'Frequency cap and rate limit',
      body: "Max messages per customer per day applies across all your campaigns combined, not per-campaign. The send rate limit (messages/minute) protects your provider account — recipients beyond the limit are marked Failed, not queued for later, so keep this realistic for your provider's tier.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_AUTOMATION_MANAGE,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'sender-identity',
      route: 'crm/campaign-settings',
      title: 'Sender Identity — Email only, today',
      body: 'You can set a "from" name/address per channel, but only Email actually uses it when sending. SMS and WhatsApp sender identity is saved for reference — using it in real sends requires provider-side business registration that isn\'t wired up yet.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_AUTOMATION_MANAGE,
    },
    {
      id: 'webhooks-moved',
      route: 'crm/campaign-settings',
      title: 'Webhooks live elsewhere now',
      body: 'Outbound webhook subscriptions (for campaign-sent, invoice, and payment events) moved to Settings → Integrations — this page just links there.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_AUTOMATION_MANAGE,
    },
  ],
};

export default tour;
