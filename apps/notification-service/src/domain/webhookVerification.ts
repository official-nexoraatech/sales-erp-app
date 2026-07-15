import { createHmac, timingSafeEqual, verify as cryptoVerify } from 'node:crypto';

// CP-6: delivery-webhook signature verification for the 3 channel providers. Every verifier
// returns a plain boolean (never throws) so route handlers can uniformly reject on `false`
// without needing per-provider try/catch. Timing-safe comparisons throughout — never a plain
// `===` on secret-derived bytes.

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Meta WhatsApp Cloud API: X-Hub-Signature-256 header is `sha256=<hex hmac>` of the raw request
 * body, keyed with the app secret. https://developers.facebook.com/docs/messenger-platform/webhooks#security
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

/**
 * SendGrid Signed Event Webhook: Ed25519 signature over
 * `${timestampHeader}${rawBody}`, verified against SendGrid's published base64-encoded public
 * key (configured per-tenant-integration in the SendGrid dashboard, not a shared secret we
 * generate). https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features
 */
export function verifySendGridSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  publicKeyBase64: string
): boolean {
  if (!publicKeyBase64 || !signatureHeader || !timestampHeader) return false;
  try {
    const publicKeyDer = Buffer.concat([
      // SPKI wrapper for a raw Ed25519 public key — SendGrid publishes the raw 32-byte key;
      // Node's crypto.verify needs a full SPKI-wrapped key to construct a KeyObject from PEM/DER.
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(publicKeyBase64, 'base64'),
    ]);
    const keyObject = {
      key: publicKeyDer,
      format: 'der' as const,
      type: 'spki' as const,
    };
    const signature = Buffer.from(signatureHeader, 'base64');
    const payload = Buffer.from(`${timestampHeader}${rawBody}`, 'utf8');
    return cryptoVerify(null, payload, keyObject, signature);
  } catch {
    return false;
  }
}

/** Constant-time shared-secret comparison — used for both MSG91's DLR callback and Meta's GET webhook-verification handshake, neither of which has a cryptographic signature scheme. */
export function verifySharedSecret(provided: string | undefined, expectedSecret: string): boolean {
  if (!expectedSecret || !provided) return false;
  return safeEqual(provided, expectedSecret);
}

/**
 * MSG91's delivery-report callback API has no cryptographic signature scheme (unlike Meta/
 * SendGrid) — verification here is a shared-secret token MSG91 is configured to echo back,
 * compared in constant time. Weaker than the other two providers by MSG91's own design, not a
 * shortcut taken here — see the CP-6 completion report.
 */
export function verifyMsg91Token(
  providedToken: string | undefined,
  expectedSecret: string
): boolean {
  return verifySharedSecret(providedToken, expectedSecret);
}
