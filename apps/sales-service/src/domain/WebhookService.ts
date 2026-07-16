// CP-8 (Campaign Management Platform initiative), generalized: enqueues one PENDING delivery
// row per active subscription whose `events` list includes eventType — a cheap synchronous
// INSERT (no outbound I/O), so third-party latency never sits on a business-transaction's
// critical path. WebhookDispatchWorker (a separate poll loop, modeled on event-service's
// OutboxRelayWorker) is what actually performs the HTTP POST, asynchronously. Originally
// scoped to campaigns only (CampaignService.enqueueWebhookDeliveries); extracted here so
// InvoiceService/PaymentService can subscribe non-campaign business events to the same
// subscriber list without a parallel implementation.
import { and, eq } from 'drizzle-orm';
import { webhookSubscriptions, webhookDeliveries } from '@erp/db';
import type { ErpDatabase } from '@erp/db';

// Takes a raw ErpDatabase/transaction handle + explicit tenantId rather than a PlatformContext
// so both ctx-style callers (CampaignService: pass ctx.db.raw, ctx.tenant.tenantId) and plain
// trx-style callers (InvoiceService/PaymentService: pass the transaction handle already in
// scope, params.tenantId) can enqueue deliveries in the same DB transaction as their own write,
// without requiring every caller to be restructured around PlatformContext.
export async function enqueueWebhookDeliveries(
  db: ErpDatabase,
  tenantId: number,
  aggregateType: string,
  aggregateId: number,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  const subscriptions = await db
    .select({ id: webhookSubscriptions.id, events: webhookSubscriptions.events })
    .from(webhookSubscriptions)
    .where(
      and(eq(webhookSubscriptions.tenantId, tenantId), eq(webhookSubscriptions.isActive, true))
    );
  const matching = subscriptions.filter((s) => s.events.includes(eventType));
  if (matching.length === 0) return;

  await db.insert(webhookDeliveries).values(
    matching.map((s) => ({
      tenantId,
      subscriptionId: s.id,
      eventType,
      aggregateType,
      aggregateId,
      payload,
    }))
  );
}
