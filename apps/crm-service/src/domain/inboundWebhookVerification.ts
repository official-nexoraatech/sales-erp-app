import { createHmac, timingSafeEqual } from 'node:crypto';

// CRM-ROADMAP Phase 2, Feature 5 (Omnichannel Communication Hub). Mirrors
// notification-service's own webhookVerification.ts (built for CP-6's outbound delivery-status
// webhooks) — same provider signature schemes, applied here to INBOUND messages instead. Not
// imported cross-service (no shared package carries this), same as every other small utility
// this codebase duplicates per-service rather than centralizing. Every verifier returns a plain
// boolean (never throws) so route handlers can uniformly reject on `false`.

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Meta WhatsApp Cloud API: X-Hub-Signature-256 header is `sha256=<hex hmac>` of the raw request
 * body, keyed with the app secret — the actual protocol Meta uses, not a choice made here.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!appSecret || !signatureHeader) return false;
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;
  const provided = signatureHeader.slice(prefix.length);
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  return safeEqual(provided, expected);
}

/** Constant-time shared-secret comparison — Meta's own GET webhook-verification handshake has no signature scheme either. */
export function verifySharedSecret(provided: string | undefined, expectedSecret: string): boolean {
  if (!expectedSecret || !provided) return false;
  return safeEqual(provided, expectedSecret);
}

/**
 * Email inbound-parse and SMS two-way providers vary widely in whether they offer a
 * cryptographic signature at all (unlike Meta's fixed, documented HMAC scheme) — since WE
 * configure both integrations ourselves rather than adapting to a single fixed external
 * protocol, both use the same HMAC-SHA256-over-raw-body scheme this codebase's own
 * WebhookDispatchService already uses for OUTBOUND deliveries (`X-Webhook-Signature:
 * sha256=<hex>`), applied here in reverse for consistency rather than inventing a third scheme.
 */
export function verifyInboundHmacSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!secret || !signatureHeader) return false;
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;
  const provided = signatureHeader.slice(prefix.length);
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return safeEqual(provided, expected);
}

/**
 * CRM-ROADMAP Phase 4, Feature 7 (CTI / Call Center Integration) — Twilio's actual protocol,
 * not a choice made here: `X-Twilio-Signature` is base64(HMAC-SHA1(authToken, url + sorted
 * "key"+"value" pairs concatenated, no delimiter)), computed over the exact public URL Twilio
 * was configured to call plus its form-encoded POST params — never the raw body bytes directly
 * (Twilio's own algorithm, different from every other provider integrated so far in this file,
 * which is why it needs its own function rather than reusing verifyInboundHmacSignature/
 * verifyMetaSignature).
 */
export function verifyTwilioSignature(
  fullUrl: string,
  params: Record<string, string>,
  signatureHeader: string | undefined,
  authToken: string
): boolean {
  if (!authToken || !signatureHeader) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = fullUrl;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
  return safeEqual(signatureHeader, expected);
}
