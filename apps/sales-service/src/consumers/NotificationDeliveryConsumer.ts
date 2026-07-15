import { and, eq, sql } from 'drizzle-orm';
import type { ERPEventPayload } from '@erp/types';
import type { TenantScopedDatabase } from '@erp/sdk';
import { campaigns, campaignRecipients } from '@erp/db';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'sales-service' });

interface NotificationDeliveryUpdatedPayload {
  notificationLogId: number;
  status: 'DELIVERED' | 'FAILED';
  errorMessage: string | null;
}

// CP-6 (Campaign Management Platform initiative): sales-service's first-ever Kafka consumer —
// syncs notification-service's delivery-webhook outcome (see
// apps/notification-service/src/api/webhook.routes.ts) onto the campaign_recipients row that
// originated the send, joined via notificationLogId (set at send time in
// CampaignService.send()), and rolls up campaigns.deliveredCount. Not every notification
// originates from a campaign (transactional notifications go through the same
// notification_log/webhook path) — a miss on the join is the normal, expected case, not an
// error.
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
