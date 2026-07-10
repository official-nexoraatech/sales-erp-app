import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  campaigns,
  campaignRecipients,
  customers,
  customerSegments,
  organizationSettings,
  projectionCustomerBalance,
  type Campaign,
} from '@erp/db';
import type { PlatformContext } from '@erp/sdk';
import { createCircuitBreaker } from '@erp/sdk';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { SegmentService, type SegmentFilterDefinition } from './SegmentService.js';

const SMS_ASCII_LIMIT = 160;
const SMS_UNICODE_LIMIT = 70;

// ES-16: protects campaign dispatch from notification-service outages — 5 failures
// in 10s opens the circuit, so a downed notification-service fails every remaining
// recipient instantly instead of each one waiting out its own HTTP timeout.
async function sendRawNotification(
  notificationUrl: string,
  internalKey: string,
  body: string
): Promise<{ httpOk: boolean; json: { data?: { status?: string; logId?: number } } }> {
  const res = await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body,
  });
  const json = (await res.json()) as { data?: { status?: string; logId?: number } };
  return { httpOk: res.ok, json };
}

const notificationBreaker = createCircuitBreaker(sendRawNotification, 'notification-service');

interface RecipientRow {
  id: number;
  displayName: string;
  phone: string;
  email: string | null;
  loyaltyPoints: number;
}

function isUnicode(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7F]/.test(text);
}

export function checkChannelLimits(channel: Campaign['channel'], message: string): string[] {
  const warnings: string[] = [];
  if (channel === 'SMS') {
    const limit = isUnicode(message) ? SMS_UNICODE_LIMIT : SMS_ASCII_LIMIT;
    if (message.length > limit) {
      warnings.push(`SMS message is ${message.length} characters — exceeds the ${limit}-character limit for ${isUnicode(message) ? 'Unicode' : 'plain'} SMS and will be sent as multiple segments`);
    }
  }
  return warnings;
}

export function renderCampaignMessage(
  template: string,
  vars: { customerName: string; balance: number; loyaltyPoints: number; shopName: string; customField?: string }
): string {
  return template
    .replace(/{{\s*customerName\s*}}/g, vars.customerName)
    .replace(/{{\s*balance\s*}}/g, vars.balance.toFixed(2))
    .replace(/{{\s*loyaltyPoints\s*}}/g, String(vars.loyaltyPoints))
    .replace(/{{\s*shopName\s*}}/g, vars.shopName)
    .replace(/{{\s*customField\s*}}/g, vars.customField ?? '');
}

// Maps a campaign channel to the opt-out column that must be false for a customer to
// receive it. IN_APP has no opt-out flag (it's not a marketing-consent-gated channel).
export function optOutCondition(channel: Campaign['channel']) {
  if (channel === 'SMS') return eq(customers.optOutSms, false);
  if (channel === 'WHATSAPP') return eq(customers.optOutWhatsapp, false);
  if (channel === 'EMAIL') return eq(customers.optOutEmail, false);
  return undefined;
}

export class CampaignService {
  /** Resolves the customer rows a campaign should target — either a saved segment or an explicit id list. */
  static async resolveRecipients(ctx: PlatformContext, campaign: Pick<Campaign, 'segmentId' | 'customerIds' | 'channel'>): Promise<RecipientRow[]> {
    const optOut = optOutCondition(campaign.channel);

    if (campaign.segmentId) {
      const [segment] = await ctx.db.raw
        .select()
        .from(customerSegments)
        .where(and(eq(customerSegments.id, campaign.segmentId), eq(customerSegments.tenantId, ctx.tenant.tenantId)));
      if (!segment) throw new NotFoundError('Segment', campaign.segmentId);

      const segmentWhere = await SegmentService.resolveWhere(ctx.db.raw, ctx.tenant.tenantId, {
        code: segment.code,
        isSystem: segment.isSystem,
        filterDefinition: segment.filterDefinition as SegmentFilterDefinition | null,
      });

      return ctx.db.raw
        .select({ id: customers.id, displayName: customers.displayName, phone: customers.phone, email: customers.email, loyaltyPoints: customers.loyaltyPoints })
        .from(customers)
        .where(optOut ? and(segmentWhere, optOut) : segmentWhere);
    }

    if (campaign.customerIds && campaign.customerIds.length > 0) {
      return ctx.db.raw
        .select({ id: customers.id, displayName: customers.displayName, phone: customers.phone, email: customers.email, loyaltyPoints: customers.loyaltyPoints })
        .from(customers)
        .where(and(eq(customers.tenantId, ctx.tenant.tenantId), inArray(customers.id, campaign.customerIds), ...(optOut ? [optOut] : [])));
    }

    throw new ValidationError('Campaign must target either a segmentId or a customerIds list');
  }

  static async previewSample(ctx: PlatformContext, segmentId: number | undefined, customerIds: number[] | undefined, messageTemplate: string, channel: Campaign['channel']): Promise<{ recipientCount: number; sampleMessage: string | null; warnings: string[] }> {
    const recipients = await CampaignService.resolveRecipients(ctx, { segmentId: segmentId ?? null, customerIds: customerIds ?? null, channel });
    const [org] = await ctx.db.raw.select({ orgName: organizationSettings.orgName }).from(organizationSettings).where(eq(organizationSettings.tenantId, ctx.tenant.tenantId));
    const shopName = org?.orgName ?? 'Our Store';

    let sampleMessage: string | null = null;
    if (recipients[0]) {
      const balance = await CampaignService.getBalance(ctx, recipients[0].id);
      sampleMessage = renderCampaignMessage(messageTemplate, {
        customerName: recipients[0].displayName,
        balance,
        loyaltyPoints: recipients[0].loyaltyPoints,
        shopName,
      });
    }

    return { recipientCount: recipients.length, sampleMessage, warnings: sampleMessage ? checkChannelLimits('SMS', sampleMessage) : [] };
  }

  private static async getBalance(ctx: PlatformContext, customerId: number): Promise<number> {
    const [bal] = await ctx.db.raw
      .select({ currentBalance: projectionCustomerBalance.currentBalance })
      .from(projectionCustomerBalance)
      .where(and(eq(projectionCustomerBalance.customerId, customerId), eq(projectionCustomerBalance.tenantId, ctx.tenant.tenantId)));
    return bal ? parseFloat(bal.currentBalance) : 0;
  }

  /** Immediate dispatch — renders + sends to every resolved recipient via notification-service. */
  static async send(ctx: PlatformContext, campaignId: number): Promise<Campaign> {
    const [campaign] = await ctx.db.raw.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', campaignId);
    if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
      throw new BusinessError('INVALID_CAMPAIGN_STATE', `Cannot send campaign in status ${campaign.status}`);
    }

    const recipients = await CampaignService.resolveRecipients(ctx, campaign);
    if (recipients.length === 0) {
      throw new BusinessError('NO_RECIPIENTS', 'Campaign has no matching recipients');
    }

    const [org] = await ctx.db.raw.select({ orgName: organizationSettings.orgName }).from(organizationSettings).where(eq(organizationSettings.tenantId, ctx.tenant.tenantId));
    const shopName = org?.orgName ?? 'Our Store';

    await ctx.db.raw.update(campaigns).set({ status: 'SENDING', totalRecipients: recipients.length, updatedAt: new Date() }).where(eq(campaigns.id, campaignId));

    const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
    const internalKey = process.env['INTERNAL_API_KEY'] ?? '';

    let sentCount = 0;
    let failedCount = 0;

    // Recipients are sent in bounded-concurrency batches rather than one HTTP round-trip
    // at a time — a 10k+ recipient segment sent sequentially could take tens of minutes
    // in a single request/job execution; this keeps it a small, fixed number of batches
    // without needing a separate queue/worker deployment.
    const BATCH_SIZE = 25;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(async (recipient) => {
        const balance = await CampaignService.getBalance(ctx, recipient.id);
        const body = renderCampaignMessage(campaign.messageTemplate, {
          customerName: recipient.displayName,
          balance,
          loyaltyPoints: recipient.loyaltyPoints,
          shopName,
        });

        const [recipientRow] = await ctx.db.raw
          .insert(campaignRecipients)
          .values({ tenantId: ctx.tenant.tenantId, campaignId, customerId: recipient.id, status: 'PENDING' })
          .returning();

        try {
          const { httpOk, json } = await notificationBreaker.fire(
            notificationUrl,
            internalKey,
            JSON.stringify({
              tenantId: ctx.tenant.tenantId,
              channel: campaign.channel,
              eventType: 'CRM_CAMPAIGN',
              ...(campaign.channel !== 'EMAIL' ? { recipientPhone: recipient.phone } : {}),
              ...(recipient.email ? { recipientEmail: recipient.email } : {}),
              body,
            })
          );
          const ok = httpOk && json.data?.status === 'SENT';

          if (recipientRow) {
            await ctx.db.raw
              .update(campaignRecipients)
              .set({ status: ok ? 'SENT' : 'FAILED', notificationLogId: json.data?.logId ?? null, sentAt: new Date(), errorMessage: ok ? null : 'Delivery failed' })
              .where(eq(campaignRecipients.id, recipientRow.id));
          }
          return ok;
        } catch (err) {
          if (recipientRow) {
            await ctx.db.raw
              .update(campaignRecipients)
              .set({ status: 'FAILED', errorMessage: err instanceof Error ? err.message : String(err) })
              .where(eq(campaignRecipients.id, recipientRow.id));
          }
          return false;
        }
      }));
      sentCount += results.filter(Boolean).length;
      failedCount += results.filter((ok) => !ok).length;
    }

    const [updated] = await ctx.db.raw
      .update(campaigns)
      .set({ status: 'SENT', sentAt: new Date(), sentCount, failedCount, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId))
      .returning();

    if (!updated) throw new Error('Campaign update failed unexpectedly');

    await ctx.events.publish('campaign', campaignId, 'CAMPAIGN_SENT', { campaignId, totalRecipients: recipients.length, sentCount, failedCount });
    await ctx.audit.log({ action: 'SEND', entityType: 'campaign', entityId: campaignId, after: { sentCount, failedCount } });

    return updated;
  }

  static async schedule(ctx: PlatformContext, campaignId: number, scheduledAt: Date): Promise<Campaign> {
    if (scheduledAt.getTime() <= Date.now()) throw new ValidationError('scheduledAt must be in the future');

    const [campaign] = await ctx.db.raw.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', campaignId);
    if (campaign.status !== 'DRAFT') throw new BusinessError('INVALID_CAMPAIGN_STATE', `Cannot schedule campaign in status ${campaign.status}`);

    const [updated] = await ctx.db.raw
      .update(campaigns)
      .set({ status: 'SCHEDULED', scheduledAt, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId))
      .returning();
    if (!updated) throw new Error('Campaign schedule failed unexpectedly');

    await ctx.audit.log({ action: 'SCHEDULE', entityType: 'campaign', entityId: campaignId, after: { scheduledAt } });
    return updated;
  }

  static async cancel(ctx: PlatformContext, campaignId: number): Promise<Campaign> {
    const [campaign] = await ctx.db.raw.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', campaignId);
    if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
      throw new BusinessError('INVALID_CAMPAIGN_STATE', `Cannot cancel campaign in status ${campaign.status}`);
    }

    const [updated] = await ctx.db.raw
      .update(campaigns)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId))
      .returning();
    if (!updated) throw new Error('Campaign cancel failed unexpectedly');

    await ctx.audit.log({ action: 'CANCEL', entityType: 'campaign', entityId: campaignId });
    return updated;
  }

  static async getStats(ctx: PlatformContext, campaignId: number): Promise<{ total: number; sent: number; delivered: number; failed: number; pending: number }> {
    const rows = await ctx.db.raw
      .select({ status: campaignRecipients.status, count: sql<number>`count(*)::int` })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.tenantId, ctx.tenant.tenantId)))
      .groupBy(campaignRecipients.status);

    const stats = { total: 0, sent: 0, delivered: 0, failed: 0, pending: 0 };
    for (const row of rows) {
      stats.total += row.count;
      if (row.status === 'SENT') stats.sent = row.count;
      if (row.status === 'DELIVERED') stats.delivered = row.count;
      if (row.status === 'FAILED') stats.failed = row.count;
      if (row.status === 'PENDING') stats.pending = row.count;
    }
    return stats;
  }

  /** Per-recipient delivery drill-down — CampaignsPage previously only showed aggregate counts. */
  static async listRecipients(ctx: PlatformContext, campaignId: number) {
    return ctx.db.raw
      .select({
        id: campaignRecipients.id,
        customerId: campaignRecipients.customerId,
        customerName: customers.displayName,
        status: campaignRecipients.status,
        errorMessage: campaignRecipients.errorMessage,
        sentAt: campaignRecipients.sentAt,
      })
      .from(campaignRecipients)
      .innerJoin(customers, eq(customers.id, campaignRecipients.customerId))
      .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.tenantId, ctx.tenant.tenantId)))
      .orderBy(campaignRecipients.id);
  }
}
