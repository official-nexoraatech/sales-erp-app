import Handlebars from 'handlebars';
import { eq, and } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { notificationTemplates, notificationLog, notificationPreferences } from '@erp/db';
import { createLogger } from '@erp/logger';
import type { NotificationServiceConfig } from '../config.js';

const logger = createLogger({ serviceName: 'notification-service' });

export interface SendNotificationInput {
  tenantId: number;
  eventType: string;
  recipientUserId?: number;
  recipientPhone?: string;
  recipientEmail?: string;
  templateData: Record<string, unknown>;
  channels?: Array<'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP'>;
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
}

const QUIET_HOURS_START = 22; // 22:00 IST
const QUIET_HOURS_END = 8;    // 08:00 IST

function isQuietHours(): boolean {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  const hour = istTime.getUTCHours();
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}

function renderTemplate(template: string, data: Record<string, unknown>): string {
  const compiled = Handlebars.compile(template);
  return compiled(data);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NotificationEngine {
  constructor(
    private readonly db: ErpDatabase,
    private readonly config: NotificationServiceConfig
  ) {}

  async send(input: SendNotificationInput): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    const channelsToSend = input.channels ?? ['SMS', 'EMAIL', 'IN_APP'];

    // Get user preferences if we have a recipient user
    let prefs: Record<string, boolean> = {};
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
      }
    }

    for (const channel of channelsToSend) {
      // Skip if user disabled this channel
      if (input.recipientUserId && prefs[channel] === false) {
        results.push({ channel, status: 'SKIPPED', logId: 0 });
        continue;
      }

      // Quiet hours: skip SMS between 22:00 and 08:00 IST
      if (channel === 'SMS' && isQuietHours()) {
        logger.info({ tenantId: input.tenantId, channel, eventType: input.eventType }, 'SMS skipped — quiet hours');
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
      const subject = template.subject ? renderTemplate(template.subject, input.templateData) : undefined;

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
        })
        .returning();

      if (!logEntry) continue;

      const sent = await this.deliverWithRetry(channel, {
        ...(input.recipientPhone !== undefined ? { phone: input.recipientPhone } : {}),
        ...(input.recipientEmail !== undefined ? { email: input.recipientEmail } : {}),
        ...(subject !== undefined ? { subject } : {}),
        body,
        tenantId: input.tenantId,
      }, logEntry.id);

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
    if (input.channel === 'SMS' && isQuietHours()) {
      logger.info({ tenantId: input.tenantId, eventType: input.eventType }, 'Raw SMS skipped — quiet hours');
      return { channel: input.channel, status: 'SKIPPED', logId: 0 };
    }

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
      })
      .returning();

    if (!logEntry) return { channel: input.channel, status: 'FAILED', logId: 0 };

    const sent = await this.deliverWithRetry(input.channel, {
      ...(input.recipientPhone !== undefined ? { phone: input.recipientPhone } : {}),
      ...(input.recipientEmail !== undefined ? { email: input.recipientEmail } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      body: input.body,
      tenantId: input.tenantId,
    }, logEntry.id);

    return { channel: input.channel, status: sent ? 'SENT' : 'FAILED', logId: logEntry.id };
  }

  private async deliverWithRetry(
    channel: 'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP',
    params: { phone?: string; email?: string; subject?: string; body: string; tenantId: number },
    logId: number
  ): Promise<boolean> {
    let sent = false;
    let lastError = '';

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const externalId = await this.deliverViaChannel(channel, params);

        await this.db
          .update(notificationLog)
          .set({ status: 'SENT', externalMessageId: externalId, attemptCount: attempt, lastAttemptAt: new Date(), updatedAt: new Date() })
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

  private async deliverViaChannel(
    channel: 'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP',
    params: {
      phone?: string;
      email?: string;
      subject?: string;
      body: string;
      tenantId: number;
    }
  ): Promise<string> {
    switch (channel) {
      case 'SMS':
        return this.sendSms(params.phone ?? '', params.body);
      case 'EMAIL':
        return this.sendEmail(params.email ?? '', params.subject ?? 'Notification', params.body);
      case 'WHATSAPP':
        return this.sendWhatsApp(params.phone ?? '', params.body);
      case 'IN_APP':
        return this.deliverInApp(params.tenantId, params.body);
    }
  }

  private async sendSms(phone: string, body: string): Promise<string> {
    if (!phone) throw new Error('SMS requires phone number');

    const response = await fetch('https://api.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        'authkey': this.config.msg91AuthKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: this.config.msg91TemplateId,
        recipients: [{ mobiles: `91${phone}`, body }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MSG91 error: ${text}`);
    }

    const data = (await response.json()) as { request_id?: string };
    return data.request_id ?? `sms_${Date.now()}`;
  }

  private async sendEmail(to: string, subject: string, html: string): Promise<string> {
    if (!to) throw new Error('Email requires recipient address');

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: this.config.fromEmail },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SendGrid error: ${text}`);
    }

    const msgId = response.headers.get('X-Message-Id') ?? `email_${Date.now()}`;
    return msgId;
  }

  private async sendWhatsApp(phone: string, body: string): Promise<string> {
    if (!phone) throw new Error('WhatsApp requires phone number');
    // WhatsApp Business API integration
    // Using Meta's Cloud API
    const url = `https://graph.facebook.com/v18.0/${this.config.whatsappPhoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.whatsappAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: `91${phone}`,
        type: 'text',
        text: { body },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WhatsApp API error: ${text}`);
    }

    const data = (await response.json()) as { messages?: Array<{ id: string }> };
    return data.messages?.[0]?.id ?? `wa_${Date.now()}`;
  }

  private async deliverInApp(_tenantId: number, _body: string): Promise<string> {
    // In-app delivery = notification written to DB (already done via log entry)
    // SSE/WebSocket push is done by the SSE endpoint
    return `inapp_${ulid()}`;
  }
}

// Import ulid at top for in-app IDs
import { ulid } from 'ulid';
