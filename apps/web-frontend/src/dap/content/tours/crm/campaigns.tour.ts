import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against CampaignsPage.tsx / CampaignFormPage.tsx / CampaignService.ts. Corrected:
// channel list is 4-way (SMS/WhatsApp/Email/IN_APP, not 3), and the previous version omitted
// the real approval workflow entirely — a tenant can require Submit for Approval before Send
// Now or Schedule become possible. Send is a genuine, irreversible dispatch through real
// SendGrid/MSG91/WhatsApp Cloud API providers, not a simulation.
const tour: TourDefinition = {
  id: 'crm-campaigns-overview',
  version: 1,
  type: 'quick',
  title: 'Campaigns — quick overview',
  description: 'Send real marketing messages (SMS/WhatsApp/Email/In-App) to a segment.',
  module: 'crm',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.CRM_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'crm/campaigns',
      title: 'Campaigns',
      body: "Sends are real — through actual SendGrid, MSG91, or WhatsApp Cloud API providers — not a simulation. Customers who've opted out of a channel are automatically skipped.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_VIEW,
    },
    {
      id: 'create',
      route: 'crm/campaigns',
      target: '[data-tour-id="crm-campaigns-create-button"]',
      title: 'Create a campaign',
      body: 'Pick a segment, a channel (SMS, WhatsApp, Email, or In-App), and write your message — image/video/PDF attachments are only supported on Email and WhatsApp.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_CAMPAIGN_CREATE,
    },
    {
      id: 'approval',
      route: 'crm/campaigns',
      target: '[data-tour-id="crm-campaign-submit-approval-button"]',
      title: 'Approval may be required first',
      body: "If your tenant requires it (set in Campaign Settings), a Draft campaign needs Submit for Approval and a manager's Approve before it can be sent or scheduled at all.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_CAMPAIGN_CREATE,
    },
    {
      id: 'send',
      route: 'crm/campaigns',
      target: '[data-tour-id="crm-campaign-send-now-button"]',
      title: 'Send Now or Schedule',
      body: 'Send Now dispatches immediately to every currently-matching, non-opted-out recipient — the confirmation dialog shows exactly how many. Schedule queues it for a specific date/time instead.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_CAMPAIGN_SEND,
    },
    {
      id: 'no-engagement-tracking',
      route: 'crm/campaigns',
      title: 'Sent/Delivered/Failed only — no open/click tracking yet',
      body: "The recipient breakdown you'll see after sending is real (from actual provider delivery webhooks), but open rates, click rates, and A/B testing aren't built yet — don't expect engagement analytics beyond delivery status.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.CRM_VIEW,
    },
  ],
};

export default tour;
