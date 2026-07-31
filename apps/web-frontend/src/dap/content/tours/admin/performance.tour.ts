import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Major correction: the previous "Platform-wide latency and throughput metrics across services"
// description implies a live APM feed. Grepped every caller of the samples-ingestion endpoint —
// the only one is the k6 load-test helper script. Real, stored measurements, but populated only
// when someone manually runs the load-test suite, not continuously from real user traffic.
const tour: TourDefinition = {
  id: 'admin-distributed-performance-overview',
  version: 1,
  type: 'quick',
  title: 'Performance — quick overview',
  description: 'Real latency baselines from load tests — not a live, always-on production monitor.',
  module: 'admin',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.PERFORMANCE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'admin/distributed/performance',
      title: 'Performance',
      body: 'P50/P95/P99 latency per endpoint against configured targets — real, stored measurements, not mocked numbers.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PERFORMANCE_VIEW,
    },
    {
      id: 'not-live-monitoring',
      route: 'admin/distributed/performance',
      title: 'Populated by load tests, not live traffic',
      body: "This page only gets new data when someone manually runs the platform's k6 load-test suite — nothing automatically posts real production request latencies here. If no one has run a load test recently, expect stale or empty data even on a busy platform. This is not a substitute for a real-time monitoring dashboard.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PERFORMANCE_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'response-times',
      route: 'admin/distributed/performance',
      title: 'Reviewing breaches',
      body: 'Endpoints exceeding their target latency are flagged with a breach count — useful right after a load test to spot regressions before they reach production.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PERFORMANCE_VIEW,
    },
  ],
};

export default tour;
