import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against dlq.routes.ts / DLQPage.tsx / OutboxRelayWorker.ts. Confirmed Replay is a
// real Kafka republish (worker.publishRaw to the item's original topic), not a status flip.
// Added: no cap on retry attempts is enforced — an operator can replay a permanently-broken
// message indefinitely. Fixed this session: Replay All Pending and Discard now ask for
// confirmation before firing (previously both fired immediately on click).
const tour: TourDefinition = {
  id: 'admin-dlq-overview',
  version: 1,
  type: 'quick',
  title: 'Dead-Letter Queue — quick overview',
  description: 'Events that failed to process after retries — replay genuinely re-publishes them.',
  module: 'admin',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.DLQ_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'admin/distributed/dlq',
      title: 'Dead-Letter Queue',
      body: "Grouped by Kafka topic. Each item is a message that a consumer failed to process after its normal retries — held here so it isn't silently lost.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DLQ_VIEW,
    },
    {
      id: 'retry-event',
      route: 'admin/distributed/dlq',
      target: '[data-tour-id="admin-dlq-replay-button"]',
      title: 'Replay All Pending — a real re-publish',
      body: "This genuinely re-publishes every pending message in the topic back to Kafka with its original payload — it will re-trigger whatever side effects the message originally caused. Now asks for confirmation first, since it's a real, consequential action.",
      placement: 'bottom',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DLQ_MANAGE,
    },
    {
      id: 'no-retry-cap',
      route: 'admin/distributed/dlq',
      title: 'No automatic retry limit',
      body: "If a message keeps failing for the same underlying reason, replaying it again and again won't help — nothing caps how many times you can retry. Fix the root cause first, or Discard it.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DLQ_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'discard-event',
      route: 'admin/distributed/dlq',
      title: 'Discard',
      body: 'Permanently gives up on a message — it will never be reprocessed. Now asks for confirmation before finalizing.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.DLQ_MANAGE,
    },
  ],
};

export default tour;
