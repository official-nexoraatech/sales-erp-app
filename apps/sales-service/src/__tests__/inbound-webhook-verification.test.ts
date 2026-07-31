// CRM-ROADMAP Phase 2, Feature 5 (Omnichannel Communication Hub). Pure functions — no DB, no
// skip guard needed, mirrors notification-service's own webhookVerification.test.ts convention.
import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  verifyMetaSignature,
  verifySharedSecret,
  verifyInboundHmacSignature,
  verifyTwilioSignature,
} from '../domain/inboundWebhookVerification.js';

describe('verifyMetaSignature', () => {
  const secret = 'meta-app-secret';
  const rawBody = JSON.stringify({ entry: [{ id: '123' }] });

  it('accepts a signature computed with the correct secret', () => {
    const sig = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
    expect(verifyMetaSignature(rawBody, sig, secret)).toBe(true);
  });

  it('rejects a signature computed with the wrong secret (forged webhook)', () => {
    const sig = `sha256=${createHmac('sha256', 'wrong-secret').update(rawBody, 'utf8').digest('hex')}`;
    expect(verifyMetaSignature(rawBody, sig, secret)).toBe(false);
  });

  it('rejects a signature against a tampered body', () => {
    const sig = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
    const tamperedBody = JSON.stringify({ entry: [{ id: '999' }] });
    expect(verifyMetaSignature(tamperedBody, sig, secret)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyMetaSignature(rawBody, undefined, secret)).toBe(false);
  });

  it('rejects a signature missing the sha256= prefix', () => {
    const hex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    expect(verifyMetaSignature(rawBody, hex, secret)).toBe(false);
  });

  it('rejects when no app secret is configured', () => {
    const sig = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
    expect(verifyMetaSignature(rawBody, sig, '')).toBe(false);
  });
});

describe('verifySharedSecret', () => {
  it('accepts a matching token', () => {
    expect(verifySharedSecret('correct-token', 'correct-token')).toBe(true);
  });

  it('rejects a mismatched token', () => {
    expect(verifySharedSecret('wrong-token', 'correct-token')).toBe(false);
  });

  it('rejects a missing token', () => {
    expect(verifySharedSecret(undefined, 'correct-token')).toBe(false);
  });
});

describe('verifyInboundHmacSignature', () => {
  const secret = 'email-webhook-secret';
  const rawBody = JSON.stringify({
    to: 'support@tenant.com',
    from: 'customer@example.com',
    text: 'hi',
  });

  it('accepts a signature computed with the correct secret', () => {
    const sig = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
    expect(verifyInboundHmacSignature(rawBody, sig, secret)).toBe(true);
  });

  it('rejects a forged signature', () => {
    const sig = `sha256=${createHmac('sha256', 'attacker-secret').update(rawBody, 'utf8').digest('hex')}`;
    expect(verifyInboundHmacSignature(rawBody, sig, secret)).toBe(false);
  });
});

// CRM-ROADMAP Phase 4, Feature 7 (CTI / Call Center Integration). Twilio's own algorithm:
// base64(HMAC-SHA1(authToken, url + sorted "key"+"value" pairs concatenated)) — a different
// scheme (SHA1, over url+params rather than raw body) from every provider above, hence its own
// describe block computing the expected signature independently rather than reusing a helper.
describe('verifyTwilioSignature', () => {
  const authToken = 'twilio-auth-token';
  const url = 'https://gateway.example.com/api/sales/webhooks/twilio/status';
  const params = { CallSid: 'CA123', CallStatus: 'completed', CallDuration: '42' };

  function sign(u: string, p: Record<string, string>, token: string): string {
    const sortedKeys = Object.keys(p).sort();
    let data = u;
    for (const key of sortedKeys) data += key + p[key];
    return createHmac('sha1', token).update(data, 'utf8').digest('base64');
  }

  it('accepts a signature computed with the correct auth token, url, and params', () => {
    const sig = sign(url, params, authToken);
    expect(verifyTwilioSignature(url, params, sig, authToken)).toBe(true);
  });

  it('rejects a signature computed with the wrong auth token', () => {
    const sig = sign(url, params, 'wrong-token');
    expect(verifyTwilioSignature(url, params, sig, authToken)).toBe(false);
  });

  it('rejects when the URL does not match what was signed (e.g. reconstructed from the request instead of the configured value)', () => {
    const sig = sign(url, params, authToken);
    expect(
      verifyTwilioSignature(
        'https://gateway.example.com/api/sales/webhooks/twilio/voice',
        params,
        sig,
        authToken
      )
    ).toBe(false);
  });

  it('rejects when a param value is tampered with', () => {
    const sig = sign(url, params, authToken);
    expect(verifyTwilioSignature(url, { ...params, CallDuration: '9999' }, sig, authToken)).toBe(
      false
    );
  });

  it('rejects a missing signature header', () => {
    expect(verifyTwilioSignature(url, params, undefined, authToken)).toBe(false);
  });

  it('rejects when no auth token is configured', () => {
    const sig = sign(url, params, authToken);
    expect(verifyTwilioSignature(url, params, sig, '')).toBe(false);
  });
});
