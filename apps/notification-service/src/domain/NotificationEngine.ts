import Handlebars from 'handlebars';
import { createHash } from 'crypto';
import { eq, and, lt, gte } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import {
  notificationTemplates,
  notificationLog,
  notificationPreferences,
  featureFlags,
  crmDltTemplates,
} from '@erp/db';
import { createLogger } from '@erp/logger';
import { matchesDltTemplate } from '@erp/utils';
import { BusinessError } from '@erp/types';
import type { DeliveryEnqueuer } from './DeliveryQueue.js';

const logger = createLogger({ serviceName: 'notification-service' });

export interface SendNotificationInput {
  tenantId: number;
  eventType: string;
  recipientUserId?: number;
  recipientPhone?: string;
  recipientEmail?: string;
  templateData: Record<string, unknown>;
  channels?: Array<'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP'>;
  idempotencyKey?: string;
}

export interface NotificationResult {
  channel: string;
  // 'SENT'/'FAILED' are no longer determinable synchronously — delivery happens on the
  // DeliveryQueue worker (see DeliveryQueue.ts). 'QUEUED' means the row was inserted and handed
  // to the queue; the real outcome lands asynchronously on notification_log.status and, from
  // there, on the NOTIFICATION_DELIVERY_UPDATED outbox event.
  status: 'QUEUED' | 'SKIPPED';
  logId: number;
}

export interface SendRawInput {
  tenantId: number;
  eventType: string;
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP';
  recipientPhone?: string;
  recipientEmail?: string;
  /** Required for the notification to appear in the recipient's in-app list/unread count — see IN_APP in ChannelName. */
  recipientUserId?: number;
  subject?: string;
  body: string;
  createdBy?: number;
  idempotencyKey?: string;
  /** CP-2: signed URL to a media asset attached to the sending campaign, if any. */
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'document';
  /** CP-8: tenant_sender_identity override — see ChannelDeliveryParams for support notes. */
  senderOverride?: { name?: string | undefined; addressOrNumber?: string | undefined };
  /**
   * CRM-ROADMAP Phase 1, Feature 6 — DLT/TRAI SMS Compliance. Defaults to 'TRANSACTIONAL' when
   * omitted, so every existing caller of sendRaw (workflow reminders, credit-limit alerts, ...)
   * is unaffected — only a caller that explicitly marks a send 'PROMOTIONAL' (CampaignService,
   * for every campaign it sends) is subject to the DLT gate below.
   */
  category?: 'PROMOTIONAL' | 'TRANSACTIONAL' | undefined;
}

// ES-26 (M8): dedup key for a caller retry landing on an already-recently-sent notification.
// Callers with a natural dedup key (e.g. sales-service's invoiceId+reminderDate) should pass
// idempotencyKey explicitly instead of relying on this derived, time-bucketed hash.
const IDEMPOTENCY_BUCKET_MS = 5 * 60 * 1000;

function deriveIdempotencyKey(
  tenantId: number,
  eventType: string,
  channel: string,
  recipient: string,
  templateData: unknown
): string {
  const bucket = Math.floor(Date.now() / IDEMPOTENCY_BUCKET_MS);
  const raw = `${tenantId}:${eventType}:${channel}:${recipient}:${JSON.stringify(templateData)}:${bucket}`;
  return createHash('sha256').update(raw).digest('hex');
}

// PG-047: defaults when a tenant has no 'notification_quiet_hours' feature flag configured —
// must stay byte-identical to the original hardcoded window for backward compatibility.
const QUIET_HOURS_START = 22; // 22:00 IST
const QUIET_HOURS_END = 8; // 08:00 IST
const QUIET_HOURS_FLAG_KEY = 'notification_quiet_hours';

function renderTemplate(template: string, data: Record<string, unknown>): string {
  const compiled = Handlebars.compile(template);
  return compiled(data);
}

export class NotificationEngine {
  constructor(
    private readonly db: ErpDatabase,
    private readonly deliveryQueue: DeliveryEnqueuer
  ) {}

  // PG-047: quiet hours are tenant-configurable via the existing feature_flags table
  // (config: { startHour, endHour }), falling back to the hardcoded default when absent/disabled.
  // userOverrideDisabled === true short-circuits the window check entirely (per-user opt-out).
  private async isQuietHours(tenantId: number, userOverrideDisabled?: boolean): Promise<boolean> {
    if (userOverrideDisabled) return false;

    const flagRows = await this.db
      .select()
      .from(featureFlags)
      .where(
        and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.flagKey, QUIET_HOURS_FLAG_KEY))
      )
      .limit(1);

    let startHour = QUIET_HOURS_START;
    let endHour = QUIET_HOURS_END;
    const flag = flagRows[0];
    if (flag?.enabled && flag.config && typeof flag.config === 'object') {
      const config = flag.config as { startHour?: number; endHour?: number };
      if (typeof config.startHour === 'number' && typeof config.endHour === 'number') {
        startHour = config.startHour;
        endHour = config.endHour;
      }
    }

    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffset);
    const hour = istTime.getUTCHours();
    return hour >= startHour || hour < endHour;
  }

  async send(input: SendNotificationInput): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    const channelsToSend = input.channels ?? ['SMS', 'EMAIL', 'IN_APP'];

    // Get user preferences if we have a recipient user
    let prefs: Record<string, boolean> = {};
    let quietHoursOverrideDisabled = false;
    if (input.recipientUserId) {
      const prefRows = await this.db
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.userId, input.recipientUserId),
            eq(notificationPreferences.tenantId, input.tenantId),
            eq(notificationPreferences.eventType, input.eventType)
          )
        );

      if (prefRows[0]) {
        const p = prefRows[0];
        prefs = {
          SMS: p.smsEnabled,
          EMAIL: p.emailEnabled,
          WHATSAPP: p.whatsappEnabled,
          IN_APP: p.inAppEnabled,
        };
        quietHoursOverrideDisabled = p.quietHoursEnabled === false;
      }
    }

    for (const channel of channelsToSend) {
      // Skip if user disabled this channel
      if (input.recipientUserId && prefs[channel] === false) {
        results.push({ channel, status: 'SKIPPED', logId: 0 });
        continue;
      }

      // Quiet hours: skip SMS between 22:00 and 08:00 IST by default (tenant/user configurable)
      if (
        channel === 'SMS' &&
        (await this.isQuietHours(input.tenantId, quietHoursOverrideDisabled))
      ) {
        logger.info(
          { tenantId: input.tenantId, channel, eventType: input.eventType },
          'SMS skipped — quiet hours'
        );
        results.push({ channel, status: 'SKIPPED', logId: 0 });
        continue;
      }

      // Find template for this channel + event
      const templates = await this.db
        .select()
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.tenantId, input.tenantId),
            eq(notificationTemplates.eventType, input.eventType),
            eq(notificationTemplates.channel, channel),
            eq(notificationTemplates.isActive, true)
          )
        )
        .limit(1);

      const template = templates[0];
      if (!template) {
        results.push({ channel, status: 'SKIPPED', logId: 0 });
        continue;
      }

      const body = renderTemplate(template.bodyTemplate, input.templateData);
      const subject = template.subject
        ? renderTemplate(template.subject, input.templateData)
        : undefined;

      // ES-26 (M8): dedup — a caller retry with the same key (explicit or derived) within the
      // time bucket must not re-dispatch. onConflictDoNothing means a colliding insert returns
      // nothing rather than throwing.
      const recipient =
        input.recipientPhone ?? input.recipientEmail ?? String(input.recipientUserId ?? '');
      const idempotencyKey = input.idempotencyKey
        ? `${input.idempotencyKey}:${channel}`
        : deriveIdempotencyKey(
            input.tenantId,
            input.eventType,
            channel,
            recipient,
            input.templateData
          );

      // Create log entry (PENDING)
      const [logEntry] = await this.db
        .insert(notificationLog)
        .values({
          tenantId: input.tenantId,
          templateId: template.id,
          eventType: input.eventType,
          channel,
          recipientUserId: input.recipientUserId,
          recipientPhone: input.recipientPhone,
          recipientEmail: input.recipientEmail,
          subject,
          body,
          status: 'PENDING',
          attemptCount: 0,
          createdBy: input.recipientUserId ?? 0,
          idempotencyKey,
        })
        .onConflictDoNothing({ target: [notificationLog.tenantId, notificationLog.idempotencyKey] })
        .returning();

      if (!logEntry) {
        logger.info(
          { tenantId: input.tenantId, channel, eventType: input.eventType },
          'Notification deduped — idempotency key already sent recently'
        );
        results.push({ channel, status: 'SKIPPED', logId: 0 });
        continue;
      }

      await this.deliveryQueue.enqueue({
        logId: logEntry.id,
        tenantId: input.tenantId,
        channel,
        params: {
          ...(input.recipientPhone !== undefined ? { phone: input.recipientPhone } : {}),
          ...(input.recipientEmail !== undefined ? { email: input.recipientEmail } : {}),
          ...(subject !== undefined ? { subject } : {}),
          body,
          tenantId: input.tenantId,
        },
      });

      results.push({ channel, status: 'QUEUED', logId: logEntry.id });
    }

    return results;
  }

  /**
   * Sends a pre-rendered message directly on one channel, bypassing the eventType→template
   * lookup — used by callers (e.g. CRM campaigns) that author their own message body per call.
   */
  async sendRaw(input: SendRawInput): Promise<NotificationResult> {
    // CRM-ROADMAP Phase 1, Feature 6 — DLT/TRAI SMS Compliance: the hard, blocking gate.
    // Checked here (not just at sales-service's earlier campaign-creation-time check) so a
    // non-compliant promotional SMS is refused even if a caller ever bypasses that earlier
    // check and calls this method directly — the phase doc's own DoD requires exactly this
    // ("verify NotificationEngine itself refuses it even if called directly"). Reads
    // crm_dlt_templates via direct DB access (same physical Postgres instance as
    // sales-service — no cross-service call needed, same finding as Feature 5).
    if (input.channel === 'SMS' && input.category === 'PROMOTIONAL') {
      const templates = await this.db
        .select()
        .from(crmDltTemplates)
        .where(
          and(eq(crmDltTemplates.tenantId, input.tenantId), eq(crmDltTemplates.isActive, true))
        );
      const now = new Date();
      const compliant = templates.some(
        (t) =>
          (!t.expiresAt || t.expiresAt > now) && matchesDltTemplate(input.body, t.messagePattern)
      );
      if (!compliant) {
        throw new BusinessError(
          'DLT_TEMPLATE_MISMATCH',
          templates.length === 0
            ? 'No DLT templates are registered for this tenant — register one before sending promotional SMS.'
            : 'This message does not match any registered DLT template for this tenant.'
        );
      }
    }

    if (input.channel === 'SMS' && (await this.isQuietHours(input.tenantId))) {
      logger.info(
        { tenantId: input.tenantId, eventType: input.eventType },
        'Raw SMS skipped — quiet hours'
      );
      return { channel: input.channel, status: 'SKIPPED', logId: 0 };
    }

    const recipient = input.recipientPhone ?? input.recipientEmail ?? '';
    const idempotencyKey = input.idempotencyKey
      ? `${input.idempotencyKey}:${input.channel}`
      : deriveIdempotencyKey(input.tenantId, input.eventType, input.channel, recipient, input.body);

    const [logEntry] = await this.db
      .insert(notificationLog)
      .values({
        tenantId: input.tenantId,
        templateId: null,
        eventType: input.eventType,
        channel: input.channel,
        recipientUserId: input.recipientUserId,
        recipientPhone: input.recipientPhone,
        recipientEmail: input.recipientEmail,
        subject: input.subject,
        body: input.body,
        status: 'PENDING',
        attemptCount: 0,
        createdBy: input.createdBy ?? 0,
        idempotencyKey,
      })
      .onConflictDoNothing({ target: [notificationLog.tenantId, notificationLog.idempotencyKey] })
      .returning();

    if (!logEntry) {
      logger.info(
        { tenantId: input.tenantId, channel: input.channel, eventType: input.eventType },
        'Raw notification deduped — idempotency key already sent recently'
      );
      return { channel: input.channel, status: 'SKIPPED', logId: 0 };
    }

    await this.deliveryQueue.enqueue({
      logId: logEntry.id,
      tenantId: input.tenantId,
      channel: input.channel,
      params: {
        ...(input.recipientPhone !== undefined ? { phone: input.recipientPhone } : {}),
        ...(input.recipientEmail !== undefined ? { email: input.recipientEmail } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.mediaUrl !== undefined ? { mediaUrl: input.mediaUrl } : {}),
        ...(input.mediaType !== undefined ? { mediaType: input.mediaType } : {}),
        ...(input.senderOverride !== undefined ? { senderOverride: input.senderOverride } : {}),
        body: input.body,
        tenantId: input.tenantId,
      },
    });

    return { channel: input.channel, status: 'QUEUED', logId: logEntry.id };
  }

  // Notification-service audit 2026-07-23: a notification that failed all attempts was
  // permanently terminal — nothing ever retried it, and there was no manual retry either.
  // MAX_TOTAL_ATTEMPTS caps how many times retryFailed() will pick a row back up across
  // successive sweeps (each re-queue gets its own fresh 3-attempt BullMQ job — see
  // DeliveryQueue's ATTEMPTS): once cumulative attemptCount reaches it, the row simply stops
  // being selected and stays FAILED — a dead-letter state distinguished by attemptCount rather
  // than a separate status/table, so no schema migration is needed for this pass. retrySingle()
  // (below) is exempt from the cap — an explicit admin retry always re-queues, since a human
  // chose to retry it.
  private static readonly MAX_TOTAL_ATTEMPTS = 9;

  /** Scheduler-triggered sweep: re-queues every FAILED notification for a tenant that hasn't hit MAX_TOTAL_ATTEMPTS, within maxAgeHours. */
  async retryFailed(tenantId: number, maxAgeHours = 24): Promise<{ requeued: number }> {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    const rows = await this.db
      .select()
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.tenantId, tenantId),
          eq(notificationLog.status, 'FAILED'),
          lt(notificationLog.attemptCount, NotificationEngine.MAX_TOTAL_ATTEMPTS),
          gte(notificationLog.createdAt, cutoff)
        )
      );

    for (const row of rows) {
      await this.requeue(tenantId, row);
    }
    return { requeued: rows.length };
  }

  /** Explicit admin/user-triggered retry of one notification — not subject to MAX_TOTAL_ATTEMPTS. */
  async retrySingle(tenantId: number, logId: number): Promise<NotificationResult | null> {
    const [row] = await this.db
      .select()
      .from(notificationLog)
      .where(and(eq(notificationLog.id, logId), eq(notificationLog.tenantId, tenantId)));
    if (!row || row.status !== 'FAILED') return null;

    await this.requeue(tenantId, row);
    return { channel: row.channel, status: 'QUEUED', logId: row.id };
  }

  private async requeue(tenantId: number, row: typeof notificationLog.$inferSelect): Promise<void> {
    // Back to PENDING while the re-queued job is in flight, so the row doesn't misleadingly
    // still read FAILED — the worker moves it to SENT or (if this fresh attempt set also
    // exhausts) FAILED again.
    await this.db
      .update(notificationLog)
      .set({ status: 'PENDING', updatedAt: new Date() })
      .where(eq(notificationLog.id, row.id));

    await this.deliveryQueue.enqueue({
      logId: row.id,
      tenantId,
      channel: row.channel,
      params: {
        ...(row.recipientPhone ? { phone: row.recipientPhone } : {}),
        ...(row.recipientEmail ? { email: row.recipientEmail } : {}),
        ...(row.subject ? { subject: row.subject } : {}),
        body: row.body,
        tenantId,
      },
    });
  }

  async getUnreadCount(tenantId: number, userId: number): Promise<number> {
    const rows = await this.db
      .select({ id: notificationLog.id })
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.tenantId, tenantId),
          eq(notificationLog.recipientUserId, userId),
          eq(notificationLog.channel, 'IN_APP'),
          eq(notificationLog.status, 'SENT')
        )
      );

    return rows.filter((r) => r).length;
  }
}
