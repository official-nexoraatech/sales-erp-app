import { and, eq, sql } from 'drizzle-orm';
import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { campaigns, campaignRecipients } from '@erp/db';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'sales-service' });

interface NotificationDeliveryUpdatedPayload {
  notificationLogId: number;
  status: 'SENT' | 'DELIVERED' | 'FAILED';
  errorMessage: string | null;
}

// CP-6 (Campaign Management Platform initiative): sales-service's first-ever Kafka consumer —
// syncs notification-service's delivery outcome onto the campaign_recipients row that
// originated the send, joined via notificationLogId (set at send time in
// CampaignService.send()), and rolls up campaigns.deliveredCount. Not every notification
// originates from a campaign (transactional notifications go through the same
// notification_log/webhook path) — a miss on the join is the normal, expected case, not an
// error.
//
// Notification-service audit 2026-07-23 (architectural tier): this event now arrives twice per
// notification instead of once — first 'SENT' (or terminal 'FAILED') from notification-service's
// DeliveryQueue worker once it actually attempts delivery (see DeliveryQueue.ts), then later
// 'DELIVERED'/'FAILED' from the provider's own delivery-status webhook (see webhook.routes.ts),
// if that provider supports one. campaignRecipients.status just tracks whichever arrived most
// recently — SENT -> DELIVERED is a normal progression, not a conflict.
export async function handleNotificationDeliveryUpdated(
  event: ERPEventPayload,
  db: TenantScopedDatabase
): Promise<void> {
  const p = event.payload as unknown as NotificationDeliveryUpdatedPayload;
  if (!p.notificationLogId || !p.status) return;

  const [recipient] = await db.raw
    .select()
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.notificationLogId, p.notificationLogId),
        eq(campaignRecipients.tenantId, event.tenantId)
      )
    );
  if (!recipient) return;
  // Idempotent no-op if this exact status was already applied (defense in depth — the inbox
  // table already gives this consumer exactly-once execution per event).
  if (recipient.status === p.status) return;

  await db.raw
    .update(campaignRecipients)
    .set({
      status: p.status,
      ...(p.status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
      ...(p.errorMessage ? { errorMessage: p.errorMessage } : {}),
    })
    .where(eq(campaignRecipients.id, recipient.id));

  if (p.status === 'DELIVERED') {
    await db.raw
      .update(campaigns)
      .set({ deliveredCount: sql`${campaigns.deliveredCount} + 1` })
      .where(eq(campaigns.id, recipient.campaignId));
  }

  logger.info(
    { notificationLogId: p.notificationLogId, campaignRecipientId: recipient.id, status: p.status },
    'Campaign recipient delivery status synced from notification-service webhook'
  );
}
