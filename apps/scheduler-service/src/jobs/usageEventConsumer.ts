import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { usageEvents } from '@erp/db';

// PG-028: writes durable usage_events rows for USAGE_* event types published via the
// outbox pattern. `quantity` defaults to 1 (one occurrence, e.g. USAGE_INVOICE_CREATED) but
// a batched event (USAGE_API_CALL_BATCH) carries its own count in payload.quantity — the
// producer and this consumer must agree on that field name (see sales-service's main.ts
// flush hook, which publishes `{ quantity: count, ... }`, not `count`).
export async function handleUsageEvent(event: ERPEventPayload, db: TenantScopedDatabase): Promise<void> {
  const payload = event.payload as Record<string, unknown>;
  const quantity = typeof payload['quantity'] === 'number' ? payload['quantity'] : 1;
  const metadata = payload['metadata'];

  await db.raw.insert(usageEvents).values({
    tenantId: event.tenantId,
    eventType: event.eventType,
    quantity,
    occurredAt: new Date(event.occurredAt),
    ...(metadata !== undefined ? { metadata: metadata as Record<string, unknown> } : {}),
  });
}
