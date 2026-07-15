import { and, desc, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import {
  campaigns,
  campaignAutomationRules,
  campaignHistory,
  campaignRecipients,
  customers,
  customerSegments,
  invoices,
  organizationSettings,
  projectionCustomerBalance,
  tenantCommunicationSettings,
  tenantSenderIdentity,
  campaignWebhookSubscriptions,
  campaignWebhookDeliveries,
  customerCommunicationPreferences,
  type Campaign,
  type CampaignAutomationRule,
} from '@erp/db';
import type { PlatformContext } from '@erp/sdk';
import { createCircuitBreaker } from '@erp/sdk';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { createLogger } from '@erp/logger';
import { SegmentService, type SegmentFilterDefinition } from './SegmentService.js';

const logger = createLogger({ serviceName: 'sales-service' });

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
      warnings.push(
        `SMS message is ${message.length} characters — exceeds the ${limit}-character limit for ${isUnicode(message) ? 'Unicode' : 'plain'} SMS and will be sent as multiple segments`
      );
    }
  }
  return warnings;
}

// CP-2: channels that can carry a media attachment, and the size limit for each resolved media
// type — mirrors Meta's published WhatsApp Cloud API media limits; Email limits are this
// platform's own sanity cap since the asset is only ever referenced by URL, never re-uploaded.
const MEDIA_CAPABLE_CHANNELS: ReadonlySet<Campaign['channel']> = new Set(['EMAIL', 'WHATSAPP']);
const MEDIA_SIZE_LIMITS_BYTES: Record<'image' | 'video' | 'document', number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

export function mediaTypeFromMime(mimeType: string): 'image' | 'video' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

/** Throws ValidationError if the given media cannot be attached to a campaign on this channel. */
export function validateMediaForChannel(
  channel: Campaign['channel'],
  mimeType: string,
  fileSize: number
): void {
  if (!MEDIA_CAPABLE_CHANNELS.has(channel)) {
    throw new ValidationError(`${channel} campaigns cannot have media attachments`);
  }
  const mediaType = mediaTypeFromMime(mimeType);
  const limit = MEDIA_SIZE_LIMITS_BYTES[mediaType];
  if (fileSize > limit) {
    throw new ValidationError(
      `${mediaType} attachment is ${(fileSize / (1024 * 1024)).toFixed(1)}MB — exceeds the ${(limit / (1024 * 1024)).toFixed(0)}MB limit for ${channel} ${mediaType} messages`
    );
  }
}

// CP-3 (Campaign Management Platform initiative): expanded token set beyond the original
// customerName/balance/loyaltyPoints/shopName/customField — lastPurchaseDate/lastPurchaseAmount
// are sourced from the customer's most recent non-draft/non-cancelled invoice (see
// getLastPurchase()). A missing value (e.g. a customer with no purchase history) renders the
// token's configured fallback rather than a broken "{{token}}" literal — see TOKEN_FALLBACKS and
// detectFallbackTokens() for the preview-time warning half of this (FR-F2).
export interface CampaignMessageVars {
  customerName: string;
  balance: number;
  loyaltyPoints: number;
  shopName: string;
  customField?: string;
  lastPurchaseDate?: string;
  lastPurchaseAmount?: number;
}

const TOKEN_FALLBACKS = {
  customField: '',
  lastPurchaseDate: 'no purchases yet',
  lastPurchaseAmount: '0.00',
} as const;

export function renderCampaignMessage(template: string, vars: CampaignMessageVars): string {
  return template
    .replace(/{{\s*customerName\s*}}/g, vars.customerName)
    .replace(/{{\s*balance\s*}}/g, vars.balance.toFixed(2))
    .replace(/{{\s*loyaltyPoints\s*}}/g, String(vars.loyaltyPoints))
    .replace(/{{\s*shopName\s*}}/g, vars.shopName)
    .replace(/{{\s*customField\s*}}/g, vars.customField ?? TOKEN_FALLBACKS.customField)
    .replace(
      /{{\s*lastPurchaseDate\s*}}/g,
      vars.lastPurchaseDate ?? TOKEN_FALLBACKS.lastPurchaseDate
    )
    .replace(
      /{{\s*lastPurchaseAmount\s*}}/g,
      vars.lastPurchaseAmount !== undefined
        ? vars.lastPurchaseAmount.toFixed(2)
        : TOKEN_FALLBACKS.lastPurchaseAmount
    );
}

/** FR-F2: which tokens present in the template would render a fallback value for this recipient. */
export function detectFallbackTokens(template: string, vars: CampaignMessageVars): string[] {
  const hit: string[] = [];
  if (/{{\s*customField\s*}}/.test(template) && vars.customField === undefined)
    hit.push('customField');
  if (/{{\s*lastPurchaseDate\s*}}/.test(template) && vars.lastPurchaseDate === undefined)
    hit.push('lastPurchaseDate');
  if (/{{\s*lastPurchaseAmount\s*}}/.test(template) && vars.lastPurchaseAmount === undefined)
    hit.push('lastPurchaseAmount');
  return hit;
}

// CP-5 (MH-09): recurring campaigns. A "definition" row has recurrenceRule set and stays in
// SCHEDULED status indefinitely, with scheduledAt holding its NEXT fire time — the existing
// dispatch-scheduled poll (status='SCHEDULED' AND scheduledAt<=now) already finds it without a
// new cron job. Each firing creates its own concrete campaign row (status DRAFT, immediately
// sent), so each occurrence gets independent recipients/analytics, matching how CP-6's analytics
// are designed to attribute per-campaign, not per-recurrence-series.
export interface RecurrenceRule {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
  /** ISO date string. Series stops recurring once the next computed fire date passes this. */
  endDate?: string;
  /**
   * Reserved for occurrence-count-based termination — not yet enforced (see CP-5 completion
   * report). A rule with only `occurrences` set (no `endDate`) recurs indefinitely today.
   */
  occurrences?: number;
}

export function computeNextFireDate(rule: RecurrenceRule, from: Date): Date {
  const next = new Date(from);
  if (rule.frequency === 'DAILY') next.setDate(next.getDate() + rule.interval);
  else if (rule.frequency === 'WEEKLY') next.setDate(next.getDate() + rule.interval * 7);
  else next.setMonth(next.getMonth() + rule.interval);
  return next;
}

// CP-5 (MH-11): unified trigger-based automation. Folds the birthday case into the same shape as
// the other triggers, going through this file's normal send() path (opt-out/frequency-cap/media
// all apply) instead of the special-cased POST /crm/birthday-greetings/send route in
// internal.routes.ts, which is kept working unchanged for now per
// ERP-PLANNING/Campaign-Planning/19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md's deprecate-after-
// verified-equivalent plan, not removed in this phase.
export function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
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
  static async resolveRecipients(
    ctx: PlatformContext,
    campaign: Pick<Campaign, 'segmentId' | 'customerIds' | 'channel'> & {
      branchId?: number | null | undefined;
    }
  ): Promise<RecipientRow[]> {
    const optOut = optOutCondition(campaign.channel);
    // CP-8: a branch-scoped campaign only ever targets customers whose own branchId matches —
    // undefined/null branchId (the default for every campaign before this phase) targets the
    // whole tenant, unchanged.
    const branchFilter = campaign.branchId ? eq(customers.branchId, campaign.branchId) : undefined;
    let rows: RecipientRow[];

    if (campaign.segmentId) {
      const [segment] = await ctx.db.raw
        .select()
        .from(customerSegments)
        .where(
          and(
            eq(customerSegments.id, campaign.segmentId),
            eq(customerSegments.tenantId, ctx.tenant.tenantId)
          )
        );
      if (!segment) throw new NotFoundError('Segment', campaign.segmentId);

      const segmentWhere = await SegmentService.resolveWhere(ctx.db.raw, ctx.tenant.tenantId, {
        code: segment.code,
        isSystem: segment.isSystem,
        filterDefinition: segment.filterDefinition as SegmentFilterDefinition | null,
      });

      rows = await ctx.db.raw
        .select({
          id: customers.id,
          displayName: customers.displayName,
          phone: customers.phone,
          email: customers.email,
          loyaltyPoints: customers.loyaltyPoints,
        })
        .from(customers)
        .where(
          and(segmentWhere, ...(optOut ? [optOut] : []), ...(branchFilter ? [branchFilter] : []))
        );
    } else if (campaign.customerIds && campaign.customerIds.length > 0) {
      rows = await ctx.db.raw
        .select({
          id: customers.id,
          displayName: customers.displayName,
          phone: customers.phone,
          email: customers.email,
          loyaltyPoints: customers.loyaltyPoints,
        })
        .from(customers)
        .where(
          and(
            eq(customers.tenantId, ctx.tenant.tenantId),
            inArray(customers.id, campaign.customerIds),
            ...(optOut ? [optOut] : []),
            ...(branchFilter ? [branchFilter] : [])
          )
        );
    } else {
      throw new ValidationError('Campaign must target either a segmentId or a customerIds list');
    }

    const consentFiltered = await CampaignService.applyGranularConsentFilter(
      ctx,
      rows,
      campaign.channel
    );
    return CampaignService.applyFrequencyCap(ctx, consentFiltered);
  }

  // CP-7 follow-up: excludes any customer who has an explicit customer_communication_preferences
  // row recording consented=false for (this channel, 'PROMOTIONAL'). Every campaign sent through
  // this service is a marketing/broadcast message — transactional notifications (order
  // confirmations, receipts) go through notification-service's own send() path directly, not
  // through a Campaign row, so 'PROMOTIONAL' is the only category CampaignService ever needs to
  // check here. A customer with no preference row is treated as consented (unchanged behavior) —
  // this is additive to, not a replacement for, the binary optOutSms/Whatsapp/Email columns
  // checked above, which remain the enforced fast-path gate.
  private static async applyGranularConsentFilter(
    ctx: PlatformContext,
    recipients: RecipientRow[],
    channel: Campaign['channel']
  ): Promise<RecipientRow[]> {
    if (recipients.length === 0) return recipients;

    const revoked = await ctx.db.raw
      .select({ customerId: customerCommunicationPreferences.customerId })
      .from(customerCommunicationPreferences)
      .where(
        and(
          eq(customerCommunicationPreferences.tenantId, ctx.tenant.tenantId),
          eq(customerCommunicationPreferences.channel, channel),
          eq(customerCommunicationPreferences.category, 'PROMOTIONAL'),
          eq(customerCommunicationPreferences.consented, false),
          inArray(
            customerCommunicationPreferences.customerId,
            recipients.map((r) => r.id)
          )
        )
      );
    if (revoked.length === 0) return recipients;

    const revokedIds = new Set(revoked.map((r) => r.customerId));
    return recipients.filter((r) => !revokedIds.has(r.id));
  }

  // CP-5 (MH-10): excludes any customer who has already received `maxPerDay` campaigns today,
  // across ALL campaigns (manual, scheduled, and automated all go through this same
  // resolveRecipients() path). A tenant with no configured cap sees no behavior change.
  private static async applyFrequencyCap(
    ctx: PlatformContext,
    recipients: RecipientRow[]
  ): Promise<RecipientRow[]> {
    if (recipients.length === 0) return recipients;

    const [settings] = await ctx.db.raw
      .select({ frequencyCap: tenantCommunicationSettings.frequencyCap })
      .from(tenantCommunicationSettings)
      .where(eq(tenantCommunicationSettings.tenantId, ctx.tenant.tenantId));
    const maxPerDay = settings?.frequencyCap?.maxPerDay;
    if (!maxPerDay) return recipients;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const counts = await ctx.db.raw
      .select({ customerId: campaignRecipients.customerId, count: sql<number>`count(*)::int` })
      .from(campaignRecipients)
      .where(
        and(
          eq(campaignRecipients.tenantId, ctx.tenant.tenantId),
          inArray(
            campaignRecipients.customerId,
            recipients.map((r) => r.id)
          ),
          gte(campaignRecipients.sentAt, todayStart),
          inArray(campaignRecipients.status, ['SENT', 'DELIVERED'])
        )
      )
      .groupBy(campaignRecipients.customerId);

    const overCap = new Set(counts.filter((c) => c.count >= maxPerDay).map((c) => c.customerId));
    return recipients.filter((r) => !overCap.has(r.id));
  }

  static async previewSample(
    ctx: PlatformContext,
    segmentId: number | undefined,
    customerIds: number[] | undefined,
    messageTemplate: string,
    channel: Campaign['channel'],
    branchId?: number
  ): Promise<{
    recipientCount: number;
    sampleMessage: string | null;
    warnings: string[];
    fallbackWarnings: string[];
  }> {
    const recipients = await CampaignService.resolveRecipients(ctx, {
      segmentId: segmentId ?? null,
      customerIds: customerIds ?? null,
      channel,
      branchId,
    });
    const [org] = await ctx.db.raw
      .select({ orgName: organizationSettings.orgName })
      .from(organizationSettings)
      .where(eq(organizationSettings.tenantId, ctx.tenant.tenantId));
    const shopName = org?.orgName ?? 'Our Store';

    let sampleMessage: string | null = null;
    let fallbackWarnings: string[] = [];
    if (recipients[0]) {
      const balance = await CampaignService.getBalance(ctx, recipients[0].id);
      const lastPurchase = await CampaignService.getLastPurchase(ctx, recipients[0].id);
      const vars: CampaignMessageVars = {
        customerName: recipients[0].displayName,
        balance,
        loyaltyPoints: recipients[0].loyaltyPoints,
        shopName,
        ...(lastPurchase
          ? { lastPurchaseDate: lastPurchase.date, lastPurchaseAmount: lastPurchase.amount }
          : {}),
      };
      sampleMessage = renderCampaignMessage(messageTemplate, vars);
      fallbackWarnings = detectFallbackTokens(messageTemplate, vars);
    }

    return {
      recipientCount: recipients.length,
      sampleMessage,
      warnings: sampleMessage ? checkChannelLimits('SMS', sampleMessage) : [],
      fallbackWarnings,
    };
  }

  // CP-2: a campaign may have at most one media attachment today (uploaded via POST /attachments
  // with entityType=CAMPAIGN) — resolves it once per send, not per recipient, since every
  // recipient on a given campaign gets the same asset.
  private static async getPrimaryMedia(
    ctx: PlatformContext,
    campaignId: number
  ): Promise<{ mediaUrl: string; mediaType: 'image' | 'video' | 'document' } | null> {
    if (!ctx.files) return null;
    const attachments = await ctx.files.list('CAMPAIGN', campaignId);
    const first = attachments[0];
    if (!first) return null;
    const { url } = await ctx.files.getDownloadUrl(first.id);
    return { mediaUrl: url, mediaType: mediaTypeFromMime(first.mimeType) };
  }

  private static async getBalance(ctx: PlatformContext, customerId: number): Promise<number> {
    const [bal] = await ctx.db.raw
      .select({ currentBalance: projectionCustomerBalance.currentBalance })
      .from(projectionCustomerBalance)
      .where(
        and(
          eq(projectionCustomerBalance.customerId, customerId),
          eq(projectionCustomerBalance.tenantId, ctx.tenant.tenantId)
        )
      );
    return bal ? parseFloat(bal.currentBalance) : 0;
  }

  // CP-3: backs the {{lastPurchaseDate}}/{{lastPurchaseAmount}} personalization tokens —
  // most recent non-draft/non-cancelled invoice for the customer, or null if they have none yet.
  private static async getLastPurchase(
    ctx: PlatformContext,
    customerId: number
  ): Promise<{ date: string; amount: number } | null> {
    const [row] = await ctx.db.raw
      .select({ invoiceDate: invoices.invoiceDate, grandTotal: invoices.grandTotal })
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          eq(invoices.tenantId, ctx.tenant.tenantId),
          notInArray(invoices.status, ['DRAFT', 'CANCELLED'])
        )
      )
      .orderBy(desc(invoices.invoiceDate))
      .limit(1);
    if (!row) return null;
    return { date: row.invoiceDate.toISOString().slice(0, 10), amount: parseFloat(row.grandTotal) };
  }

  /** Immediate dispatch — renders + sends to every resolved recipient via notification-service. */
  static async send(ctx: PlatformContext, campaignId: number): Promise<Campaign> {
    const [campaign] = await ctx.db.raw
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', campaignId);
    if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
      throw new BusinessError(
        'INVALID_CAMPAIGN_STATE',
        `Cannot send campaign in status ${campaign.status}`
      );
    }
    if (
      (await CampaignService.tenantRequiresApproval(ctx)) &&
      campaign.approvalStatus !== 'APPROVED'
    ) {
      throw new BusinessError(
        'APPROVAL_REQUIRED',
        'Campaign must be approved before it can be sent'
      );
    }

    const recipients = await CampaignService.resolveRecipients(ctx, campaign);
    if (recipients.length === 0) {
      throw new BusinessError('NO_RECIPIENTS', 'Campaign has no matching recipients');
    }

    const [org] = await ctx.db.raw
      .select({ orgName: organizationSettings.orgName })
      .from(organizationSettings)
      .where(eq(organizationSettings.tenantId, ctx.tenant.tenantId));
    const shopName = org?.orgName ?? 'Our Store';
    const media = await CampaignService.getPrimaryMedia(ctx, campaignId);
    // CP-8: per-tenant sender identity override — only EmailChannelProvider currently honors it
    // (see ChannelDeliveryParams.senderOverride for why SMS/WhatsApp don't).
    const [senderIdentity] = await ctx.db.raw
      .select({
        senderName: tenantSenderIdentity.senderName,
        senderAddressOrNumber: tenantSenderIdentity.senderAddressOrNumber,
      })
      .from(tenantSenderIdentity)
      .where(
        and(
          eq(tenantSenderIdentity.tenantId, ctx.tenant.tenantId),
          eq(tenantSenderIdentity.channel, campaign.channel)
        )
      );

    await ctx.db.raw
      .update(campaigns)
      .set({
        status: 'SENDING',
        totalRecipients: recipients.length,
        updatedAt: new Date(),
        version: sql`${campaigns.version} + 1`,
      })
      .where(eq(campaigns.id, campaignId));

    const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
    const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
    // CP-3: only pay for the extra per-recipient invoice lookup when the template actually
    // references one of the purchase-history tokens.
    const needsLastPurchase = /{{\s*lastPurchase(Date|Amount)\s*}}/.test(campaign.messageTemplate);

    let sentCount = 0;
    let failedCount = 0;

    // Recipients are sent in bounded-concurrency batches rather than one HTTP round-trip
    // at a time — a 10k+ recipient segment sent sequentially could take tens of minutes
    // in a single request/job execution; this keeps it a small, fixed number of batches
    // without needing a separate queue/worker deployment.
    const BATCH_SIZE = 25;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (recipient) => {
          const balance = await CampaignService.getBalance(ctx, recipient.id);
          const lastPurchase = needsLastPurchase
            ? await CampaignService.getLastPurchase(ctx, recipient.id)
            : null;
          const body = renderCampaignMessage(campaign.messageTemplate, {
            customerName: recipient.displayName,
            balance,
            loyaltyPoints: recipient.loyaltyPoints,
            shopName,
            ...(lastPurchase
              ? { lastPurchaseDate: lastPurchase.date, lastPurchaseAmount: lastPurchase.amount }
              : {}),
          });

          const [recipientRow] = await ctx.db.raw
            .insert(campaignRecipients)
            .values({
              tenantId: ctx.tenant.tenantId,
              campaignId,
              customerId: recipient.id,
              status: 'PENDING',
            })
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
                ...(media ? { mediaUrl: media.mediaUrl, mediaType: media.mediaType } : {}),
                ...(senderIdentity
                  ? {
                      senderOverride: {
                        name: senderIdentity.senderName,
                        addressOrNumber: senderIdentity.senderAddressOrNumber,
                      },
                    }
                  : {}),
                body,
              })
            );
            const ok = httpOk && json.data?.status === 'SENT';

            if (recipientRow) {
              await ctx.db.raw
                .update(campaignRecipients)
                .set({
                  status: ok ? 'SENT' : 'FAILED',
                  notificationLogId: json.data?.logId ?? null,
                  sentAt: new Date(),
                  errorMessage: ok ? null : 'Delivery failed',
                })
                .where(eq(campaignRecipients.id, recipientRow.id));
            }
            return ok;
          } catch (err) {
            if (recipientRow) {
              await ctx.db.raw
                .update(campaignRecipients)
                .set({
                  status: 'FAILED',
                  errorMessage: err instanceof Error ? err.message : String(err),
                })
                .where(eq(campaignRecipients.id, recipientRow.id));
            }
            return false;
          }
        })
      );
      sentCount += results.filter(Boolean).length;
      failedCount += results.filter((ok) => !ok).length;
    }

    const [updated] = await ctx.db.raw
      .update(campaigns)
      .set({
        status: 'SENT',
        sentAt: new Date(),
        sentCount,
        failedCount,
        updatedAt: new Date(),
        version: sql`${campaigns.version} + 1`,
      })
      .where(eq(campaigns.id, campaignId))
      .returning();

    if (!updated) throw new Error('Campaign update failed unexpectedly');

    await ctx.events.publish('campaign', campaignId, 'CAMPAIGN_SENT', {
      campaignId,
      totalRecipients: recipients.length,
      sentCount,
      failedCount,
    });
    await ctx.audit.log({
      action: 'SEND',
      entityType: 'campaign',
      entityId: campaignId,
      after: { sentCount, failedCount },
    });
    await CampaignService.enqueueWebhookDeliveries(ctx, 'CAMPAIGN_SENT', campaignId, {
      campaignId,
      name: updated.name,
      channel: updated.channel,
      totalRecipients: recipients.length,
      sentCount,
      failedCount,
      sentAt: updated.sentAt,
    });

    return updated;
  }

  // CP-8: enqueues one PENDING delivery row per active subscription whose `events` list
  // includes eventType — a cheap synchronous INSERT (no outbound I/O), matching the CP-6
  // decision to keep third-party-dependent latency off the campaign-send critical path.
  // WebhookDispatchWorker (a separate poll loop, modeled on event-service's OutboxRelayWorker)
  // is what actually performs the HTTP POST, asynchronously.
  private static async enqueueWebhookDeliveries(
    ctx: PlatformContext,
    eventType: string,
    campaignId: number,
    payload: Record<string, unknown>
  ): Promise<void> {
    const subscriptions = await ctx.db.raw
      .select({ id: campaignWebhookSubscriptions.id, events: campaignWebhookSubscriptions.events })
      .from(campaignWebhookSubscriptions)
      .where(
        and(
          eq(campaignWebhookSubscriptions.tenantId, ctx.tenant.tenantId),
          eq(campaignWebhookSubscriptions.isActive, true)
        )
      );
    const matching = subscriptions.filter((s) => s.events.includes(eventType));
    if (matching.length === 0) return;

    await ctx.db.raw.insert(campaignWebhookDeliveries).values(
      matching.map((s) => ({
        tenantId: ctx.tenant.tenantId,
        subscriptionId: s.id,
        eventType,
        campaignId,
        payload,
      }))
    );
  }

  /**
   * CP-5: fires one occurrence of a recurring campaign definition — creates a concrete campaign
   * row (copying the definition's audience/content), sends it through the normal send() path
   * (so opt-out/frequency-capping/media all apply exactly as they would to a manual campaign),
   * then advances the definition to its next fire date or ends the series if `endDate` has
   * passed. A failure sending one occurrence does not stop the series — the definition still
   * advances, matching the principle that one bad send shouldn't silently break all future ones.
   */
  static async dispatchRecurringOccurrence(
    ctx: PlatformContext,
    definitionId: number
  ): Promise<{ occurrenceId: number; seriesEnded: boolean }> {
    const [definition] = await ctx.db.raw
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, definitionId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
    if (!definition) throw new NotFoundError('Campaign', definitionId);
    const rule = definition.recurrenceRule as RecurrenceRule | null;
    if (!rule) throw new ValidationError('Campaign has no recurrence rule');

    const [occurrence] = await ctx.db.raw
      .insert(campaigns)
      .values({
        tenantId: ctx.tenant.tenantId,
        name: `${definition.name} — ${new Date().toISOString().slice(0, 10)}`,
        segmentId: definition.segmentId,
        customerIds: definition.customerIds,
        channel: definition.channel,
        messageTemplate: definition.messageTemplate,
        campaignType: definition.campaignType,
        templateId: definition.templateId,
        parentRecurringCampaignId: definitionId,
        // CP-8: each occurrence inherits the recurring definition's branch scope, if any.
        branchId: definition.branchId,
        status: 'DRAFT',
        createdBy: definition.createdBy,
        // CP-7: each occurrence of an already-scheduled recurring series is auto-approved — the
        // series itself was already reviewed/scheduled by whoever set it up; requiring a human to
        // re-approve every single firing would defeat the point of "recurring".
        approvalStatus: 'APPROVED',
        approvedBy: definition.createdBy,
        approvedAt: new Date(),
      })
      .returning();
    if (!occurrence) throw new Error('Recurring occurrence creation failed unexpectedly');

    try {
      await CampaignService.send(ctx, occurrence.id);
    } catch (err) {
      logger.warn(
        {
          definitionId,
          occurrenceId: occurrence.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'Recurring campaign occurrence failed to send — series continues'
      );
    }

    const currentFireDate = definition.scheduledAt ?? new Date();
    const next = computeNextFireDate(rule, currentFireDate);
    const seriesEnded = !!rule.endDate && next.getTime() > new Date(rule.endDate).getTime();

    await ctx.db.raw
      .update(campaigns)
      .set(
        seriesEnded
          ? {
              status: 'CANCELLED',
              cancelledAt: new Date(),
              updatedAt: new Date(),
              version: sql`${campaigns.version} + 1`,
            }
          : { scheduledAt: next, updatedAt: new Date(), version: sql`${campaigns.version} + 1` }
      )
      .where(eq(campaigns.id, definitionId));

    return { occurrenceId: occurrence.id, seriesEnded };
  }

  // Resolves which customers currently match a trigger — real, data-backed conditions only
  // (mirrors the exact SQL shape already proven in SegmentService.prebuiltWhere, generalized
  // where a rule's `conditions` allow tuning, e.g. INACTIVITY's day threshold).
  private static automationTriggerWhere(
    ctx: PlatformContext,
    triggerType: CampaignAutomationRule['triggerType'],
    conditions: Record<string, unknown> | null
  ) {
    const tenantId = ctx.tenant.tenantId;
    const base = and(eq(customers.tenantId, tenantId), sql`${customers.deletedAt} IS NULL`)!;

    if (triggerType === 'BIRTHDAY') {
      return and(
        base,
        sql`${customers.dateOfBirth} IS NOT NULL AND SUBSTRING(${customers.dateOfBirth} FROM 6 FOR 5) = TO_CHAR(CURRENT_DATE, 'MM-DD')`
      )!;
    }
    if (triggerType === 'ANNIVERSARY') {
      return and(
        base,
        sql`${customers.anniversary} IS NOT NULL AND SUBSTRING(${customers.anniversary} FROM 6 FOR 5) = TO_CHAR(CURRENT_DATE, 'MM-DD')`
      )!;
    }
    // INACTIVITY: no non-draft/cancelled invoice in the last N days (default 60, same as the
    // existing no-purchase-60-days prebuilt segment) — reuses that exact subquery shape.
    const inactiveDays =
      typeof conditions?.['inactiveDays'] === 'number'
        ? (conditions['inactiveDays'] as number)
        : 60;
    const cutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
    return and(
      base,
      sql`NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = ${customers.id} AND i.tenant_id = ${tenantId} AND i.invoice_date >= ${cutoff.toISOString()} AND i.status NOT IN ('DRAFT','CANCELLED'))`
    )!;
  }

  /**
   * CP-5 (MH-11): fires one automation rule if it hasn't already fired today and has at least
   * one matching customer. Creates a real campaign row (visible in the normal campaign list,
   * tagged via campaignType = the trigger type) and sends it through the normal send() path.
   * Returns null (a no-op, not an error) when already fired today or nobody currently matches.
   */
  static async fireAutomationRule(
    ctx: PlatformContext,
    ruleId: number
  ): Promise<{ campaignId: number; recipientCount: number } | null> {
    const [rule] = await ctx.db.raw
      .select()
      .from(campaignAutomationRules)
      .where(
        and(
          eq(campaignAutomationRules.id, ruleId),
          eq(campaignAutomationRules.tenantId, ctx.tenant.tenantId)
        )
      );
    if (!rule) throw new NotFoundError('Automation rule', ruleId);
    if (!rule.enabled)
      throw new BusinessError('AUTOMATION_RULE_DISABLED', 'Automation rule is disabled');
    if (rule.lastFiredAt && isSameCalendarDay(rule.lastFiredAt, new Date())) return null;

    const where = CampaignService.automationTriggerWhere(
      ctx,
      rule.triggerType,
      rule.conditions as Record<string, unknown> | null
    );
    const matches = await ctx.db.raw.select({ id: customers.id }).from(customers).where(where);

    await ctx.db.raw
      .update(campaignAutomationRules)
      .set({
        lastFiredAt: new Date(),
        updatedAt: new Date(),
        version: sql`${campaignAutomationRules.version} + 1`,
      })
      .where(eq(campaignAutomationRules.id, ruleId));

    if (matches.length === 0) return null;

    const [campaign] = await ctx.db.raw
      .insert(campaigns)
      .values({
        tenantId: ctx.tenant.tenantId,
        name: `[Automated] ${rule.triggerType} — ${new Date().toISOString().slice(0, 10)}`,
        customerIds: matches.map((m) => m.id),
        channel: rule.channel,
        messageTemplate: rule.messageTemplate ?? 'Hi {{customerName}}!',
        campaignType: rule.triggerType,
        templateId: rule.templateId,
        status: 'DRAFT',
        createdBy: rule.createdBy,
        // CP-7: auto-approved for the same reason as recurring occurrences — the automation rule
        // itself was already reviewed/configured by whoever enabled it.
        approvalStatus: 'APPROVED',
        approvedBy: rule.createdBy,
        approvedAt: new Date(),
      })
      .returning();
    if (!campaign) throw new Error('Automated campaign creation failed unexpectedly');

    await CampaignService.send(ctx, campaign.id);
    return { campaignId: campaign.id, recipientCount: matches.length };
  }

  // CP-4: campaigns are editable while DRAFT/SCHEDULED, optimistic-locked via `version` (the
  // same pattern already used by business_seasons/stock_transfers/etc.). Editing a SCHEDULED
  // campaign resets it to DRAFT and clears scheduledAt — per
  // ERP-PLANNING/Campaign-Planning/09_CAMPAIGN_LIFECYCLE_AND_WORKFLOW.md, a content/audience
  // change must be re-confirmed via a fresh schedule() call, not silently kept on the old time.
  // CP-7 (MH-12): whether this tenant requires approval before a campaign may be scheduled/sent.
  // Defaults to false (no row / approvalRequired=false) — every existing tenant sees no behavior
  // change unless they explicitly opt in, per 19_MIGRATION_AND_BACKWARD_COMPATIBILITY.md.
  static async tenantRequiresApproval(ctx: PlatformContext): Promise<boolean> {
    const [settings] = await ctx.db.raw
      .select({ approvalRequired: tenantCommunicationSettings.approvalRequired })
      .from(tenantCommunicationSettings)
      .where(eq(tenantCommunicationSettings.tenantId, ctx.tenant.tenantId));
    return settings?.approvalRequired ?? false;
  }

  /** Submits a DRAFT campaign for approval — auto-approves immediately if the tenant doesn't require it. */
  static async submitForApproval(ctx: PlatformContext, campaignId: number): Promise<Campaign> {
    const [campaign] = await ctx.db.raw
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', campaignId);
    if (campaign.status !== 'DRAFT') {
      throw new BusinessError(
        'INVALID_CAMPAIGN_STATE',
        `Cannot submit campaign in status ${campaign.status} for approval`
      );
    }

    const requiresApproval = await CampaignService.tenantRequiresApproval(ctx);
    const nextApprovalStatus = requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED';

    const [updated] = await ctx.db.raw
      .update(campaigns)
      .set({
        approvalStatus: nextApprovalStatus,
        ...(nextApprovalStatus === 'APPROVED'
          ? { approvedBy: ctx.tenant.userId, approvedAt: new Date() }
          : {}),
        updatedAt: new Date(),
        version: sql`${campaigns.version} + 1`,
      })
      .where(eq(campaigns.id, campaignId))
      .returning();
    if (!updated) throw new Error('Campaign approval submission failed unexpectedly');

    await ctx.db.raw.insert(campaignHistory).values({
      tenantId: ctx.tenant.tenantId,
      campaignId,
      actorId: ctx.tenant.userId,
      action: nextApprovalStatus === 'APPROVED' ? 'AUTO_APPROVE' : 'SUBMIT_FOR_APPROVAL',
      fromStatus: campaign.status,
      toStatus: updated.status,
    });
    await ctx.audit.log({
      action: nextApprovalStatus === 'APPROVED' ? 'AUTO_APPROVE' : 'SUBMIT_FOR_APPROVAL',
      entityType: 'campaign',
      entityId: campaignId,
    });

    return updated;
  }

  /** Approves a PENDING_APPROVAL campaign — requires CRM_CAMPAIGN_APPROVE at the route level. */
  static async approve(ctx: PlatformContext, campaignId: number): Promise<Campaign> {
    const [campaign] = await ctx.db.raw
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', campaignId);
    if (campaign.approvalStatus !== 'PENDING_APPROVAL') {
      throw new BusinessError(
        'INVALID_APPROVAL_STATE',
        `Cannot approve a campaign with approvalStatus ${campaign.approvalStatus ?? 'null'}`
      );
    }

    const [updated] = await ctx.db.raw
      .update(campaigns)
      .set({
        approvalStatus: 'APPROVED',
        approvedBy: ctx.tenant.userId,
        approvedAt: new Date(),
        rejectionReason: null,
        updatedAt: new Date(),
        version: sql`${campaigns.version} + 1`,
      })
      .where(eq(campaigns.id, campaignId))
      .returning();
    if (!updated) throw new Error('Campaign approval failed unexpectedly');

    await ctx.db.raw.insert(campaignHistory).values({
      tenantId: ctx.tenant.tenantId,
      campaignId,
      actorId: ctx.tenant.userId,
      action: 'APPROVE',
      fromStatus: campaign.status,
      toStatus: updated.status,
    });
    await ctx.audit.log({ action: 'APPROVE', entityType: 'campaign', entityId: campaignId });

    return updated;
  }

  /** Rejects a PENDING_APPROVAL campaign back to editable — approvalStatus records the reason until the next edit/resubmit. */
  static async reject(ctx: PlatformContext, campaignId: number, reason: string): Promise<Campaign> {
    const [campaign] = await ctx.db.raw
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', campaignId);
    if (campaign.approvalStatus !== 'PENDING_APPROVAL') {
      throw new BusinessError(
        'INVALID_APPROVAL_STATE',
        `Cannot reject a campaign with approvalStatus ${campaign.approvalStatus ?? 'null'}`
      );
    }

    const [updated] = await ctx.db.raw
      .update(campaigns)
      .set({
        approvalStatus: 'REJECTED',
        rejectionReason: reason,
        updatedAt: new Date(),
        version: sql`${campaigns.version} + 1`,
      })
      .where(eq(campaigns.id, campaignId))
      .returning();
    if (!updated) throw new Error('Campaign rejection failed unexpectedly');

    await ctx.db.raw.insert(campaignHistory).values({
      tenantId: ctx.tenant.tenantId,
      campaignId,
      actorId: ctx.tenant.userId,
      action: 'REJECT',
      fromStatus: campaign.status,
      toStatus: updated.status,
      diff: { rejectionReason: reason },
    });
    await ctx.audit.log({
      action: 'REJECT',
      entityType: 'campaign',
      entityId: campaignId,
      after: { reason },
    });

    return updated;
  }

  static async update(
    ctx: PlatformContext,
    campaignId: number,
    expectedVersion: number,
    patch: Partial<
      Pick<
        Campaign,
        | 'name'
        | 'channel'
        | 'messageTemplate'
        | 'segmentId'
        | 'customerIds'
        | 'campaignType'
        | 'templateId'
        | 'branchId'
      >
    >
  ): Promise<Campaign> {
    const [existing] = await ctx.db.raw
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
    if (!existing) throw new NotFoundError('Campaign', campaignId);
    if (!['DRAFT', 'SCHEDULED'].includes(existing.status)) {
      throw new BusinessError(
        'INVALID_CAMPAIGN_STATE',
        `Cannot edit campaign in status ${existing.status}`
      );
    }

    const resetToDraft = existing.status === 'SCHEDULED';
    // CP-7 (R6, see 20_RISK_ASSESSMENT.md): editing a campaign always clears any prior approval —
    // otherwise someone could get sign-off on one message and swap in another before it sends.
    // A campaign with no approvalStatus set (approval never required, or never submitted) is
    // simply left as-is (null stays null).
    const resetApproval =
      existing.approvalStatus === 'APPROVED' || existing.approvalStatus === 'PENDING_APPROVAL';

    const [updated] = await ctx.db.raw
      .update(campaigns)
      .set({
        ...patch,
        ...(resetToDraft ? { status: 'DRAFT' as const, scheduledAt: null } : {}),
        ...(resetApproval ? { approvalStatus: null, approvedBy: null, approvedAt: null } : {}),
        updatedAt: new Date(),
        lastEditedAt: new Date(),
        version: sql`${campaigns.version} + 1`,
      })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.tenantId, ctx.tenant.tenantId),
          eq(campaigns.version, expectedVersion)
        )
      )
      .returning();

    if (!updated) throw new OptimisticLockError('Campaign');

    await ctx.db.raw.insert(campaignHistory).values({
      tenantId: ctx.tenant.tenantId,
      campaignId,
      actorId: ctx.tenant.userId,
      action: 'UPDATE',
      fromStatus: existing.status,
      toStatus: updated.status,
      diff: patch as Record<string, unknown>,
    });

    await ctx.audit.log({
      action: 'UPDATE',
      entityType: 'campaign',
      entityId: campaignId,
      before: existing as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });

    return updated;
  }

  // CP-5: `recurrenceRule` optionally turns this campaign into a recurring definition — the
  // dispatch-scheduled poll will keep re-firing it (via dispatchRecurringOccurrence) instead of
  // sending it once.
  static async schedule(
    ctx: PlatformContext,
    campaignId: number,
    scheduledAt: Date,
    recurrenceRule?: RecurrenceRule,
    timezone?: string
  ): Promise<Campaign> {
    if (scheduledAt.getTime() <= Date.now())
      throw new ValidationError('scheduledAt must be in the future');

    const [campaign] = await ctx.db.raw
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', campaignId);
    if (campaign.status !== 'DRAFT')
      throw new BusinessError(
        'INVALID_CAMPAIGN_STATE',
        `Cannot schedule campaign in status ${campaign.status}`
      );
    if (
      (await CampaignService.tenantRequiresApproval(ctx)) &&
      campaign.approvalStatus !== 'APPROVED'
    ) {
      throw new BusinessError(
        'APPROVAL_REQUIRED',
        'Campaign must be approved before it can be scheduled'
      );
    }

    const [updated] = await ctx.db.raw
      .update(campaigns)
      .set({
        status: 'SCHEDULED',
        scheduledAt,
        ...(recurrenceRule !== undefined ? { recurrenceRule } : {}),
        ...(timezone !== undefined ? { timezone } : {}),
        updatedAt: new Date(),
        version: sql`${campaigns.version} + 1`,
      })
      .where(eq(campaigns.id, campaignId))
      .returning();
    if (!updated) throw new Error('Campaign schedule failed unexpectedly');

    await ctx.db.raw.insert(campaignHistory).values({
      tenantId: ctx.tenant.tenantId,
      campaignId,
      actorId: ctx.tenant.userId,
      action: 'SCHEDULE',
      fromStatus: campaign.status,
      toStatus: updated.status,
      diff: { scheduledAt: scheduledAt.toISOString() },
    });

    await ctx.audit.log({
      action: 'SCHEDULE',
      entityType: 'campaign',
      entityId: campaignId,
      after: { scheduledAt },
    });
    return updated;
  }

  static async cancel(ctx: PlatformContext, campaignId: number): Promise<Campaign> {
    const [campaign] = await ctx.db.raw
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, ctx.tenant.tenantId)));
    if (!campaign) throw new NotFoundError('Campaign', campaignId);
    if (!['DRAFT', 'SCHEDULED'].includes(campaign.status)) {
      throw new BusinessError(
        'INVALID_CAMPAIGN_STATE',
        `Cannot cancel campaign in status ${campaign.status}`
      );
    }

    const [updated] = await ctx.db.raw
      .update(campaigns)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        updatedAt: new Date(),
        version: sql`${campaigns.version} + 1`,
      })
      .where(eq(campaigns.id, campaignId))
      .returning();
    if (!updated) throw new Error('Campaign cancel failed unexpectedly');

    await ctx.db.raw.insert(campaignHistory).values({
      tenantId: ctx.tenant.tenantId,
      campaignId,
      actorId: ctx.tenant.userId,
      action: 'CANCEL',
      fromStatus: campaign.status,
      toStatus: updated.status,
    });

    await ctx.audit.log({ action: 'CANCEL', entityType: 'campaign', entityId: campaignId });
    await CampaignService.enqueueWebhookDeliveries(ctx, 'CAMPAIGN_CANCELLED', campaignId, {
      campaignId,
      name: updated.name,
      channel: updated.channel,
      cancelledAt: updated.cancelledAt,
    });
    return updated;
  }

  static async getStats(
    ctx: PlatformContext,
    campaignId: number
  ): Promise<{ total: number; sent: number; delivered: number; failed: number; pending: number }> {
    const rows = await ctx.db.raw
      .select({ status: campaignRecipients.status, count: sql<number>`count(*)::int` })
      .from(campaignRecipients)
      .where(
        and(
          eq(campaignRecipients.campaignId, campaignId),
          eq(campaignRecipients.tenantId, ctx.tenant.tenantId)
        )
      )
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
      .where(
        and(
          eq(campaignRecipients.campaignId, campaignId),
          eq(campaignRecipients.tenantId, ctx.tenant.tenantId)
        )
      )
      .orderBy(campaignRecipients.id);
  }

  /** CP-4: lifecycle/edit history for a campaign, newest first — backs the History tab (CP-7 UI). */
  static async listHistory(ctx: PlatformContext, campaignId: number) {
    return ctx.db.raw
      .select()
      .from(campaignHistory)
      .where(
        and(
          eq(campaignHistory.campaignId, campaignId),
          eq(campaignHistory.tenantId, ctx.tenant.tenantId)
        )
      )
      .orderBy(desc(campaignHistory.createdAt));
  }
}
