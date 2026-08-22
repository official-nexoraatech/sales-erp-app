// CRM/O2C split — CampaignService needs enqueueWebhookDeliveries; the rest of sales-service's
// WebhookService.ts stays behind (also used by InvoiceService/PaymentService — genuinely
// shared with O2C). This is a duplicate of that one function, not a move: it's a ~30-line
// stateless utility (no class, no state) reading/writing only webhookSubscriptions/
// webhookDeliveries, the same small-helper-duplication precedent as requireInternalKey in
// migrations 3-6.
import { and, eq } from 'drizzle-orm';
import { webhookSubscriptions, webhookDeliveries } from '@erp/db';
import type { ErpDatabase } from '@erp/db';

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
