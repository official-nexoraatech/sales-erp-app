import type { TourDefinition } from '../../schema.js';
import { PERMISSIONS } from '../../../../constants/permissions.js';

// Major correction: an earlier audit found this page permanently empty (no write path existed
// at all). That's now fixed — EventStoreService.append() is genuinely called from InvoiceService
// (create/confirm/cancel) and PaymentService. But the scope is much narrower than "the
// platform's event log across every service" — only Invoice and Payment lifecycle events are
// captured; no other domain (purchasing, HR, inventory, accounting) writes here yet.
const tour: TourDefinition = {
  id: 'admin-distributed-events-overview',
  version: 1,
  type: 'quick',
  title: 'Event Store — quick overview',
  description:
    'A real, append-only log of Invoice and Payment lifecycle events — not yet platform-wide.',
  module: 'admin',
  estimatedMinutes: 2,
  requiredPermissions: [PERMISSIONS.EVENT_STORE_VIEW],
  steps: [
    {
      id: 'intro',
      route: 'admin/distributed/events',
      title: 'Event Store',
      body: 'A genuine, queryable event log — real rows appear here for real invoice creation/confirmation/cancellation and payment allocation. This was a known gap earlier and is now fixed.',
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EVENT_STORE_VIEW,
    },
    {
      id: 'scope-is-narrow',
      route: 'admin/distributed/events',
      title: 'Currently scoped to Invoice and Payment only',
      body: "Don't expect this to be a platform-wide history yet. Other filter options in the dropdown (Customer, Item, Stock events) will always return empty — no other domain writes to this log today.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EVENT_STORE_VIEW,
      calloutTitle: 'Common mistake',
      calloutVariant: 'warning',
    },
    {
      id: 'rebuild-aggregate',
      route: 'admin/distributed/events',
      title: 'Rebuild Aggregate State',
      body: "A real snapshot-and-replay tool — reconstructs an invoice or payment's state purely from its recorded events, useful for verifying the event log actually reflects reality.",
      placement: 'center',
      mode: 'informational',
      requiredPermission: PERMISSIONS.EVENT_STORE_VIEW,
    },
  ],
};

export default tour;
