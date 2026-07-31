import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Corrected/updated: an earlier audit found only INVOICE_CREATION wired. That's grown — a
// GST_COMPLIANCE_GENERATION saga is now also real and consumer-triggered. But retry/compensate
// currently only functionally works for GST-compliance sagas — event-service never registered a
// step factory for INVOICE_CREATION, so retrying one from here returns a clear
// SAGA_TYPE_NOT_REGISTERED error rather than silently doing nothing.
const tour: TourDefinition = {
  id: 'admin-distributed-sagas-overview',
  version: 1,
  type: 'quick',
  title: 'Saga Orchestrator — quick overview',
  description:
    'Tracks real invoice-creation and GST-compliance workflows — retry currently works for GST sagas only.',
  module: 'admin',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.SAGA_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'admin/distributed/sagas',
      title: 'Saga Orchestrator',
      body: 'Two real saga types run today: Invoice Creation and GST Compliance Generation (e-invoice/e-way-bill). No payroll or purchase-to-pay saga exists yet — what you see here is genuine step-by-step history, not a mock.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SAGA_VIEW,
    },
    {
      id: 'check-step',
      route: 'admin/distributed/sagas',
      title: "Check a saga's current step",
      body: "Open a row to see the real step history — where it succeeded, where it's stuck, and why.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SAGA_VIEW,
    },
    {
      id: 'retry-limitation',
      route: 'admin/distributed/sagas',
      title: 'Retry only recovers GST-compliance sagas',
      body: "Clicking Retry on a failed Invoice Creation saga will return an error saying that saga type isn't recoverable from here — that's a known, real limitation, not a bug you're hitting by accident.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SAGA_MANAGE,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'compensate',
      route: 'admin/distributed/sagas',
      title: 'Compensate',
      body: "Runs rollback logic for a saga's already-completed steps — now asks for confirmation before firing, since it's a real, irreversible rollback action.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.SAGA_MANAGE,
    },
  ],
};

export default tour;
