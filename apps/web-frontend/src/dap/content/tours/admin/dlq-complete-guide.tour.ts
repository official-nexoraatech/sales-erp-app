import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Deep-dive companion to `admin-dlq-overview`. Grounded against dlq.routes.ts,
// OutboxRelayWorker.ts. Covers exactly what "replay" does at the Kafka level, the missing retry
// cap, and RBAC scoping (this is tenant self-service, not platform-operator-only — worth being
// precise about since it differs from Tenants/Suspend).
const tour: TourDefinition = {
  id: 'admin-dlq-complete-guide',
  version: 1,
  type: 'complete',
  title: 'Dead-Letter Queue — complete guide',
  description:
    "What Replay actually does at the Kafka level, why there's no retry cap, and who can use this for their own tenant.",
  module: 'admin',
  estimatedMinutes: 5,
  requiredPermissions: [PERMISSIONS.DLQ_VIEW],
  steps: [
    {
      id: 'purpose',
      route: 'admin/distributed/dlq',
      title: 'Why this page exists',
      body: 'When a Kafka consumer fails to process a message after its normal retries, it lands here instead of being silently dropped — this is the safety net for that failure class.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DLQ_VIEW,
    },
    {
      id: 'tenant-scoped',
      route: 'admin/distributed/dlq',
      title: "This is your own tenant's data, not platform-wide",
      body: "Unlike Tenants (platform-operator only), DLQ management is a tenant-scoped permission — your Owner/Admin role can manage your tenant's own DLQ items, but never see or touch another tenant's. This is intentional self-service, so a business can recover from its own failed integrations without waiting on platform support.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DLQ_VIEW,
    },
    {
      id: 'topics-and-items',
      route: 'admin/distributed/dlq',
      title: 'Browse by topic, then item',
      body: 'Topics with pending items are listed first. Selecting one shows every dead-lettered message for it, with its error message and retry count.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DLQ_VIEW,
    },
    {
      id: 'replay-mechanics',
      route: 'admin/distributed/dlq',
      target: '[data-tour-id="admin-dlq-replay-button"]',
      title: 'Replay All Pending — the real mechanics',
      body: 'Genuinely re-publishes every pending message in that topic back onto the original Kafka topic, with its original payload and headers — the same consumer that failed the first time will pick it up and try again. On success, the item flips to Replayed. On failure, it stays Pending and its retry count increments.',
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DLQ_MANAGE,
    },
    {
      id: 'no-cap',
      route: 'admin/distributed/dlq',
      title: 'No automatic cap on retries',
      body: 'Nothing stops you from clicking Replay repeatedly on a message that fails for the same structural reason every time — it will just keep failing and incrementing its retry count. If a message has failed more than once or twice, investigate the root cause before replaying again.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DLQ_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'discard',
      route: 'admin/distributed/dlq',
      title: 'Discard',
      body: 'The only way to stop a repeatedly-failing message from sitting in Pending forever. Permanent — it will never be reprocessed after this.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DLQ_MANAGE,
    },
    {
      id: 'best-practices',
      route: 'admin/distributed/dlq',
      title: 'Best practices',
      body: 'Diagnose before you replay.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DLQ_VIEW,
      calloutTitle: 'Best practices',
      calloutVariant: 'success',
      businessImpact: [
        'Read the error message on an item before replaying it — replaying a message that will fail the same way wastes a retry count and delays noticing the real problem.',
        'If a message has already been replayed once and failed again, treat that as a signal to investigate the consumer or upstream data, not to keep clicking Replay.',
        "Discard deliberately — a discarded message is gone for good; make sure whatever it represented (a webhook, a notification, a projection update) doesn't need a manual equivalent action first.",
      ],
    },
  ],
};

export default tour;
