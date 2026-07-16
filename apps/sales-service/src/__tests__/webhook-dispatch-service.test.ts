// CP-8 (Campaign Management Platform initiative): outbound campaign-lifecycle webhook signing
// and single-delivery dispatch. Mirrors the rigor applied to CP-6's inbound webhook verification
// tests (webhookVerification.test.ts) since an unsigned/predictable outbound webhook would let a
// receiving endpoint be spoofed just as easily as an unverified inbound one.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  signWebhookPayload,
  verifyWebhookSignature,
  deliverWebhook,
} from '../domain/WebhookDispatchService.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signWebhookPayload / verifyWebhookSignature', () => {
  it('round-trips: a signature produced with the right secret verifies successfully', () => {
    const body = JSON.stringify({ eventType: 'CAMPAIGN_SENT', campaignId: 1 });
    const sig = signWebhookPayload('my-secret', body);
    expect(verifyWebhookSignature('my-secret', body, sig)).toBe(true);
  });

  it('rejects a signature produced with the wrong secret', () => {
    const body = JSON.stringify({ eventType: 'CAMPAIGN_SENT', campaignId: 1 });
    const sig = signWebhookPayload('my-secret', body);
    expect(verifyWebhookSignature('wrong-secret', body, sig)).toBe(false);
  });

  it('rejects when the body is tampered with after signing', () => {
    const body = JSON.stringify({ eventType: 'CAMPAIGN_SENT', campaignId: 1 });
    const sig = signWebhookPayload('my-secret', body);
    const tampered = JSON.stringify({ eventType: 'CAMPAIGN_SENT', campaignId: 999 });
    expect(verifyWebhookSignature('my-secret', tampered, sig)).toBe(false);
  });

  it('produces different signatures for different secrets over the same body', () => {
    const body = 'same body';
    expect(signWebhookPayload('secret-a', body)).not.toBe(signWebhookPayload('secret-b', body));
  });
});

describe('deliverWebhook', () => {
  it('signs the outgoing body and returns success on a 2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await deliverWebhook({
      targetUrl: 'https://example.com/webhook',
      secret: 'sub-secret',
      eventType: 'CAMPAIGN_SENT',
      aggregateType: 'CAMPAIGN',
      aggregateId: 42,
      payload: { sentCount: 10 },
    });

    expect(outcome).toEqual({ success: true, httpStatus: 200 });
    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://example.com/webhook');
    expect(options.method).toBe('POST');
    expect(options.headers['X-Webhook-Event']).toBe('CAMPAIGN_SENT');
    expect(options.headers['X-Webhook-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

    const expectedSig = `sha256=${signWebhookPayload('sub-secret', options.body)}`;
    expect(options.headers['X-Webhook-Signature']).toBe(expectedSig);

    const parsed = JSON.parse(options.body) as {
      eventType: string;
      aggregateType: string;
      aggregateId: number;
    };
    expect(parsed.eventType).toBe('CAMPAIGN_SENT');
    expect(parsed.aggregateType).toBe('CAMPAIGN');
    expect(parsed.aggregateId).toBe(42);
  });

  it('returns success:false with the HTTP status on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const outcome = await deliverWebhook({
      targetUrl: 'https://example.com/webhook',
      secret: 's',
      eventType: 'CAMPAIGN_SENT',
      aggregateType: 'CAMPAIGN',
      aggregateId: 1,
      payload: {},
    });
    expect(outcome).toEqual({ success: false, httpStatus: 500 });
  });

  it('returns success:false with an error message when the fetch itself throws (e.g. DNS failure)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND example.invalid'))
    );
    const outcome = await deliverWebhook({
      targetUrl: 'https://example.invalid/webhook',
      secret: 's',
      eventType: 'CAMPAIGN_CANCELLED',
      aggregateType: 'CAMPAIGN',
      aggregateId: 2,
      payload: {},
    });
    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('ENOTFOUND');
  });
});
