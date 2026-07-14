import Handlebars from 'handlebars';
import { createHash } from 'crypto';
import { eq, and } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import {
  notificationTemplates,
  notificationLog,
  notificationPreferences,
  featureFlags,
} from '@erp/db';
import { createLogger } from '@erp/logger';
import type { NotificationServiceConfig } from '../config.js';
import { ChannelRegistry } from './channels/ChannelRegistry.js';
import type { ChannelDeliveryParams } from './channels/types.js';

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
  status: 'SENT' | 'SKIPPED' | 'FAILED';
  logId: number;
}

export interface SendRawInput {
  tenantId: number;
  eventType: string;
  channel: 'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP';
  recipientPhone?: string;
  recipientEmail?: string;
  subject?: string;
  body: string;
  createdBy?: number;
  idempotencyKey?: string;
  /** CP-2: signed URL to a media asset attached to the sending campaign, if any. */
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'document';
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NotificationEngine {
  // CP-2: channel dispatch now goes through a pluggable adapter registry (see domain/channels/)
  // instead of an inline switch — built from the same config this class already took, so the
  // public constructor signature is unchanged and every existing caller/test is unaffected.
  private readonly channels: ChannelRegistry;

  constructor(
    private readonly db: ErpDatabase,
    private readonly config: NotificationServiceConfig
  ) {
    this.channels = new ChannelRegistry(config);
  }

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

      const sent = await this.deliverWithRetry(
        channel,
        {
          ...(input.recipientPhone !== undefined ? { phone: input.recipientPhone } : {}),
          ...(input.recipientEmail !== undefined ? { email: input.recipientEmail } : {}),
          ...(subject !== undefined ? { subject } : {}),
          body,
          tenantId: input.tenantId,
        },
        logEntry.id
      );

      results.push({
        channel,
        status: sent ? 'SENT' : 'FAILED',
        logId: logEntry.id,
      });
    }

    return results;
  }

  /**
   * Sends a pre-rendered message directly on one channel, bypassing the eventType→template
   * lookup — used by callers (e.g. CRM campaigns) that author their own message body per call.
   */
  async sendRaw(input: SendRawInput): Promise<NotificationResult> {
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

    const sent = await this.deliverWithRetry(
      input.channel,
      {
        ...(input.recipientPhone !== undefined ? { phone: input.recipientPhone } : {}),
        ...(input.recipientEmail !== undefined ? { email: input.recipientEmail } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.mediaUrl !== undefined ? { mediaUrl: input.mediaUrl } : {}),
        ...(input.mediaType !== undefined ? { mediaType: input.mediaType } : {}),
        body: input.body,
        tenantId: input.tenantId,
      },
      logEntry.id
    );

    return { channel: input.channel, status: sent ? 'SENT' : 'FAILED', logId: logEntry.id };
  }

  private async deliverWithRetry(
    channel: 'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP',
    params: ChannelDeliveryParams,
    logId: number
  ): Promise<boolean> {
    let sent = false;
    let lastError = '';

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { externalId } = await this.channels.get(channel).send(params);

        await this.db
          .update(notificationLog)
          .set({
            status: 'SENT',
            externalMessageId: externalId,
            attemptCount: attempt,
            lastAttemptAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(notificationLog.id, logId));

        sent = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn({ channel, attempt, err: lastError }, 'Notification delivery failed, retrying');

        await this.db
          .update(notificationLog)
          .set({ attemptCount: attempt, lastAttemptAt: new Date(), updatedAt: new Date() })
          .where(eq(notificationLog.id, logId));

        if (attempt < 3) await sleep(Math.pow(2, attempt) * 1000);
      }
    }

    if (!sent) {
      await this.db
        .update(notificationLog)
        .set({ status: 'FAILED', errorMessage: lastError, updatedAt: new Date() })
        .where(eq(notificationLog.id, logId));
    }

    return sent;
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
