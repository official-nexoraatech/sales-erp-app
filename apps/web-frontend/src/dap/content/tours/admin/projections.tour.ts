import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Grounded against ProjectionsPage.tsx. Added: not every projection has a rebuild job
// registered — attempting to rebuild an unsupported one returns a real 400
// UNSUPPORTED_PROJECTION error, which is expected behavior, not a bug.
const tour: TourDefinition = {
  id: 'admin-distributed-projections-overview',
  version: 1,
  type: 'quick',
  title: 'Projections — quick overview',
  description: 'Read-optimized views rebuilt from the event stream — real, live status and lag.',
  module: 'admin',
  estimatedMinutes: 1,
  requiredPermissions: [PERMISSIONS.PROJECTION_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'admin/distributed/projections',
      title: 'Projections',
      body: 'Real per-projection status, lag, and a staleness warning — refreshed every 10 seconds.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PROJECTION_VIEW,
    },
    {
      id: 'rebuild-status',
      route: 'admin/distributed/projections',
      title: 'Rebuild',
      body: 'A real action, not every projection supports it though — some will return an "unsupported" error if no rebuild job is registered for them. That\'s expected, not a bug to report.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.PROJECTION_MANAGE,
    },
  ],
};

export default tour;
