import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against search-analytics.routes.ts / SearchAnalyticsPage.tsx. Confirmed genuinely
// live, continuously-updating usage data (unlike the Performance page, which only updates from
// manual load tests). Added a clarification: this page's own "Dead-Letter" tab is a second,
// separate DLQ concept (search-index sync failures) from the Kafka-topic DLQ at
// admin/distributed/dlq — don't conflate the two.
const tour: TourDefinition = {
  id: 'admin-search-analytics-overview',
  version: 1,
  type: 'quick',
  title: 'Search Analytics — quick overview',
  description:
    'Live usage stats for the global search (Ctrl+K) — real, continuously-updating data.',
  module: 'admin',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.SEARCH_REINDEX],
  steps: [
    {
      id: 'intro',
      route: 'admin/search-analytics',
      title: 'Search Analytics',
      body: "Volume, no-result rate, latency, and click-through — genuinely computed from your users' real searches, updated continuously, not from a scheduled report.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SEARCH_REINDEX,
    },
    {
      id: 'no-result-queries',
      route: 'admin/search-analytics',
      title: 'Review no-result queries',
      body: 'Repeated no-result searches usually mean a vocabulary gap, not a missing record.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SEARCH_REINDEX,
    },
    {
      id: 'search-index-dlq',
      route: 'admin/search-analytics',
      title: 'A second, different Dead-Letter Queue',
      body: "The Dead-Letter tab here tracks search-index sync failures specifically — a different concept from the Kafka-wide DLQ under Admin → Distributed Systems. Retry re-syncs that document into the search index; it doesn't touch Kafka topics at all.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SEARCH_REINDEX,
    },
  ],
};

export default tour;
