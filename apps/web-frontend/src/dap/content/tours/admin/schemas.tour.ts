import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against packages/platform-sdk/src/schema-registry.ts. Corrected: the compatibility
// check IS real (a genuine JSON-schema diff against the last registered version), but it's a
// governance/documentation tool, not enforced at actual Kafka publish or consume time — no
// producer or consumer in the platform currently validates messages against this registry.
const tour: TourDefinition = {
  id: 'admin-distributed-schemas-overview',
  version: 1,
  type: 'quick',
  title: 'Schema Registry — quick overview',
  description:
    'A real compatibility-checking catalog — reference documentation, not an enforced publish-time gate.',
  module: 'admin',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.SCHEMA_REGISTRY_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'admin/distributed/schemas',
      title: 'Schema Registry',
      body: 'A real catalog of registered event-type shapes, with real version history.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SCHEMA_REGISTRY_VIEW,
    },
    {
      id: 'not-enforced',
      route: 'admin/distributed/schemas',
      title: 'Not enforced at publish or consume time',
      body: "Nothing here currently blocks a producer from publishing an event that doesn't match its registered schema, or a consumer from processing one that doesn't. Treat this as governance documentation — a source of truth to check manually, not an automatic safety net.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SCHEMA_REGISTRY_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'check-compatibility',
      route: 'admin/distributed/schemas',
      title: 'Check Payload Compatibility',
      body: 'A real, genuine diff tool — paste a payload in and it actually compares it against the last registered version for that event type, according to the chosen compatibility mode.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SCHEMA_REGISTRY_MANAGE,
    },
  ],
};

export default tour;
