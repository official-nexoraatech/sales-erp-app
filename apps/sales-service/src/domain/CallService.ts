import { and, desc, eq } from 'drizzle-orm';
import { crmCallLogs, users } from '@erp/db';
import type { ErpDatabase, CrmCallLog } from '@erp/db';
import { ValidationError, NotFoundError } from '@erp/types';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

export type TwilioStatus =
  'queued' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'no-answer' | 'canceled';

function mapTwilioStatus(status: TwilioStatus): CrmCallLog['status'] {
  switch (status) {
    case 'queued':
      return 'INITIATED';
    case 'ringing':
      return 'RINGING';
    case 'in-progress':
      return 'IN_PROGRESS';
    case 'completed':
      return 'COMPLETED';
    case 'busy':
      return 'BUSY';
    case 'failed':
      return 'FAILED';
    case 'no-answer':
      return 'NO_ANSWER';
    case 'canceled':
      return 'CANCELED';
  }
}

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  callerNumber: string;
  voiceWebhookUrl: string;
  statusWebhookUrl: string;
  recordingWebhookUrl: string;
  recordingEnabled: boolean;
}

export function loadTwilioConfig(): TwilioConfig {
  return {
    accountSid: process.env['TWILIO_ACCOUNT_SID'] ?? '',
    authToken: process.env['TWILIO_AUTH_TOKEN'] ?? '',
    callerNumber: process.env['TWILIO_CALLER_NUMBER'] ?? '',
    // Must be the exact public URL configured in the Twilio console for each callback — Twilio's
    // request-signature scheme signs over this literal URL string, and this service runs behind
    // api-gateway, so the URL Fastify perceives (internal host/port) is never the one Twilio
    // actually called. Reconstructing it from the request would silently break signature
    // verification the moment a proxy/port changes; using the same configured value on both ends
    // (Twilio console and here) is the only reliable option.
    voiceWebhookUrl: process.env['TWILIO_VOICE_WEBHOOK_URL'] ?? '',
    statusWebhookUrl: process.env['TWILIO_STATUS_WEBHOOK_URL'] ?? '',
    recordingWebhookUrl: process.env['TWILIO_RECORDING_WEBHOOK_URL'] ?? '',
    // Recording is OFF by default — enabling it is a tenant/legal decision (call-recording
    // consent + retention policy) outside this feature's own remit, never an engineering
    // default. See completion report for what a real deployment needs to confirm before
    // flipping this on.
    recordingEnabled: process.env['TWILIO_RECORDING_ENABLED'] === 'true',
  };
}

/**
 * CRM-ROADMAP Phase 4, Feature 7 — CTI / Call Center Integration.
 *
 * Click-to-call is implemented as a classic two-leg bridge, not a browser-based softphone (no
 * Twilio Voice JS SDK/WebRTC in this pass — flagged in the completion report as a larger,
 * separate undertaking): Twilio first calls the REP's own phone (from `users.phone`); once they
 * answer, `voiceWebhook` returns TwiML that dials the CUSTOMER's number, bridging the two legs.
 * No SDK — raw `fetch` against the Twilio REST API, mirroring this codebase's own established
 * "no vendor SDK, plain fetch, a *ChannelProvider-shaped class" convention (WhatsApp/MSG91
 * providers in notification-service).
 */
export class CallService {
  static async initiateCall(
    db: ErpDatabase,
    tenantId: number,
    repUserId: number,
    params: { customerId?: number | undefined; toNumber: string }
  ): Promise<CrmCallLog> {
    const config = loadTwilioConfig();
    if (!config.accountSid || !config.authToken || !config.callerNumber) {
      throw new ValidationError(
        'Twilio is not configured for this environment (missing TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_CALLER_NUMBER)'
      );
    }

    const [rep] = await db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, repUserId));
    if (!rep?.phone) {
      throw new ValidationError('Set your phone number in your profile before making calls');
    }

    const voiceUrl = new URL(config.voiceWebhookUrl);
    voiceUrl.searchParams.set('customerNumber', params.toNumber);

    const body = new URLSearchParams({
      To: rep.phone,
      From: config.callerNumber,
      Url: voiceUrl.toString(),
      StatusCallback: config.statusWebhookUrl,
      StatusCallbackEvent: 'initiated ringing answered completed',
      ...(config.recordingEnabled ? { Record: 'true' } : {}),
    });

    const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64');
    const res = await fetch(`${TWILIO_API_BASE}/Accounts/${config.accountSid}/Calls.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Twilio call creation failed: ${res.status} ${errText}`);
    }
    const twilioCall = (await res.json()) as { sid: string; status: TwilioStatus };

    const [created] = await db
      .insert(crmCallLogs)
      .values({
        tenantId,
        customerId: params.customerId ?? null,
        repUserId,
        direction: 'OUTBOUND',
        fromNumber: config.callerNumber,
        toNumber: params.toNumber,
        twilioCallSid: twilioCall.sid,
        status: mapTwilioStatus(twilioCall.status),
        recordingConsentConfirmed: config.recordingEnabled,
      })
      .returning();
    if (!created) throw new Error('Call log creation failed unexpectedly');
    return created;
  }

  /** TwiML for the second leg — bridges the rep's now-answered call to the customer's number. */
  static buildBridgeTwiml(customerNumber: string): string {
    const escaped = customerNumber
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${escaped}</Dial></Response>`;
  }

  /**
   * Twilio's status-callback webhook carries no tenantId of its own — resolved by looking up
   * the (globally-unique, Twilio-generated) CallSid directly. A platform-wide single Twilio
   * account is assumed (same "one shared vendor credential, not per-tenant" model as this
   * codebase's existing WhatsApp/MSG91 integrations) — per-tenant Twilio sub-accounts are out of
   * scope for this pass.
   */
  static async handleStatusCallback(
    db: ErpDatabase,
    params: { callSid: string; status: TwilioStatus; durationSeconds?: number | undefined }
  ): Promise<void> {
    const [existing] = await db
      .select()
      .from(crmCallLogs)
      .where(eq(crmCallLogs.twilioCallSid, params.callSid));
    if (!existing) return; // Unknown SID — nothing to update, not an error (a stale/replayed webhook).

    const terminal: CrmCallLog['status'][] = [
      'COMPLETED',
      'BUSY',
      'FAILED',
      'NO_ANSWER',
      'CANCELED',
    ];
    const mappedStatus = mapTwilioStatus(params.status);
    await db
      .update(crmCallLogs)
      .set({
        status: mappedStatus,
        ...(params.durationSeconds !== undefined
          ? { durationSeconds: params.durationSeconds }
          : {}),
        ...(terminal.includes(mappedStatus) ? { endedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(crmCallLogs.id, existing.id));
  }

  static async handleRecordingCallback(
    db: ErpDatabase,
    params: { callSid: string; recordingUrl: string }
  ): Promise<void> {
    const config = loadTwilioConfig();
    if (!config.recordingEnabled) return; // Recording wasn't requested — ignore any stray callback.

    const [existing] = await db
      .select()
      .from(crmCallLogs)
      .where(eq(crmCallLogs.twilioCallSid, params.callSid));
    if (!existing) return;
    await db
      .update(crmCallLogs)
      .set({ recordingUrl: params.recordingUrl, updatedAt: new Date() })
      .where(eq(crmCallLogs.id, existing.id));
  }

  static async listCalls(
    db: ErpDatabase,
    tenantId: number,
    scope: { canViewAll: boolean; callerId: number },
    filters: { customerId?: number | undefined }
  ): Promise<CrmCallLog[]> {
    const conditions = [eq(crmCallLogs.tenantId, tenantId)];
    if (!scope.canViewAll) conditions.push(eq(crmCallLogs.repUserId, scope.callerId));
    if (filters.customerId !== undefined)
      conditions.push(eq(crmCallLogs.customerId, filters.customerId));

    return db
      .select()
      .from(crmCallLogs)
      .where(and(...conditions))
      .orderBy(desc(crmCallLogs.startedAt));
  }

  static async addNotes(
    db: ErpDatabase,
    tenantId: number,
    repUserId: number,
    callLogId: number,
    notes: string
  ): Promise<CrmCallLog> {
    const [updated] = await db
      .update(crmCallLogs)
      .set({ notes, updatedAt: new Date() })
      .where(
        and(
          eq(crmCallLogs.id, callLogId),
          eq(crmCallLogs.tenantId, tenantId),
          eq(crmCallLogs.repUserId, repUserId)
        )
      )
      .returning();
    if (!updated) throw new NotFoundError('CallLog', callLogId);
    return updated;
  }
}
