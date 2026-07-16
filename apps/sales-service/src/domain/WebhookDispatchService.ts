// CP-8 (Campaign Management Platform initiative): outbound webhook signing + single-delivery
// dispatch. Kept separate from WebhookDispatchWorker's poll loop so the signing/HTTP logic is
// unit-testable without a real database or timer.
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 over the raw JSON body, hex-encoded — same primitive this codebase already uses
 * to *verify* inbound webhooks (notification-service's webhookVerification.ts), applied here to
 * *produce* a signature for an outbound call instead.
 */
export function signWebhookPayload(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Constant-time comparison — exposed for the receiving side's own tests/tooling to reuse. */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signature: string
): boolean {
  const expected = signWebhookPayload(secret, rawBody);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

export interface WebhookDeliveryAttempt {
  targetUrl: string;
  secret: string;
  eventType: string;
  aggregateType: string;
  aggregateId: number;
  payload: Record<string, unknown>;
}

export interface WebhookDeliveryOutcome {
  success: boolean;
  httpStatus?: number;
  error?: string;
}

const DELIVERY_TIMEOUT_MS = 10_000;

/** Performs one outbound POST — no DB access, no retry logic (that's the worker's job). */
export async function deliverWebhook(
  attempt: WebhookDeliveryAttempt
): Promise<WebhookDeliveryOutcome> {
  const body = JSON.stringify({
    eventType: attempt.eventType,
    aggregateType: attempt.aggregateType,
    aggregateId: attempt.aggregateId,
    data: attempt.payload,
  });
  const signature = signWebhookPayload(attempt.secret, body);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(attempt.targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': attempt.eventType,
      },
      body,
      signal: controller.signal,
    });
    return { success: res.ok, httpStatus: res.status };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}
