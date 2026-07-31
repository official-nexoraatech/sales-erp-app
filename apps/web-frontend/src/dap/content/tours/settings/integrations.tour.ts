import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against WebhookService.ts / WebhookDispatchWorker.ts / IntegrationsPage.tsx.
// Confirmed real and generalized beyond CRM (per prior session finding). Corrected: the
// Active/Inactive badge only reflects the subscription's own enabled flag, not whether
// deliveries are actually succeeding — there is no delivery-log or "send test event" feature in
// the UI despite the backend having real delivery/retry infrastructure.
const tour: TourDefinition = {
  id: 'settings-integrations-overview',
  version: 1,
  type: 'quick',
  title: 'Integrations — quick overview',
  description:
    'Subscribe external systems to key business events with signed, retried webhook deliveries.',
  module: 'settings',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.INTEGRATION_WEBHOOK_MANAGE],
  steps: [
    {
      id: 'intro',
      route: 'settings/integrations',
      title: 'Integrations',
      body: 'Webhook subscriptions only — not a general third-party connector page. Real events (invoice created/confirmed, payment received, campaign sent/cancelled) trigger a real, signed HTTP POST to your URL, with automatic retries.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INTEGRATION_WEBHOOK_MANAGE,
    },
    {
      id: 'add-webhook',
      route: 'settings/integrations',
      target: '[data-tour-id="settings-integrations-create-button"]',
      title: 'Add Webhook',
      body: "Target URL, and which events to receive. You'll be shown a signing secret exactly once, right after creation — copy it immediately, since it's never shown again.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INTEGRATION_WEBHOOK_MANAGE,
    },
    {
      id: 'no-delivery-visibility',
      route: 'settings/integrations',
      title: 'No delivery log or test-send from this page',
      body: "The Active/Inactive badge only shows whether the subscription itself is turned on — it doesn't tell you whether recent deliveries actually succeeded. There's no delivery history and no \"send test event\" button here; verify receipt on your own endpoint's side.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.INTEGRATION_WEBHOOK_MANAGE,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
  ],
};

export default tour;
