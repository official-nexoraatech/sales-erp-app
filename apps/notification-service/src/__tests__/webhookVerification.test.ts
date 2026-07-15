// CP-6 (Campaign Management Platform initiative): delivery-webhook signature verification.
// These are the security-critical guard for every public-facing webhook route this phase adds —
// tested with valid, tampered, and missing-secret cases for each provider, per this initiative's
// own risk assessment (20_RISK_ASSESSMENT.md, R3) which named webhook spoofing as the top risk
// of this specific phase.
import { describe, it, expect } from 'vitest';
import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import {
  verifyMetaSignature,
  verifySendGridSignature,
  verifyMsg91Token,
} from '../domain/webhookVerification.js';

describe('verifyMetaSignature', () => {
  const appSecret = 'meta-app-secret';
  const body = JSON.stringify({ entry: [{ id: '123' }] });

  function sign(secret: string, payload: string): string {
    return `sha256=${createHmac('sha256', secret).update(payload, 'utf8').digest('hex')}`;
  }

  it('accepts a correctly-signed payload', () => {
    expect(verifyMetaSignature(body, sign(appSecret, body), appSecret)).toBe(true);
  });

  it('rejects a payload signed with the wrong secret', () => {
    expect(verifyMetaSignature(body, sign('wrong-secret', body), appSecret)).toBe(false);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const validSig = sign(appSecret, body);
    expect(verifyMetaSignature(body + 'tampered', validSig, appSecret)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyMetaSignature(body, undefined, appSecret)).toBe(false);
  });

  it('rejects when no app secret is configured', () => {
    expect(verifyMetaSignature(body, sign(appSecret, body), '')).toBe(false);
  });

  it('rejects a header missing the sha256= prefix', () => {
    const { hex } = { hex: createHmac('sha256', appSecret).update(body, 'utf8').digest('hex') };
    expect(verifyMetaSignature(body, hex, appSecret)).toBe(false);
  });
});

describe('verifySendGridSignature', () => {
  // SendGrid publishes a raw 32-byte Ed25519 public key, base64-encoded (not SPKI-wrapped) —
  // generate a real keypair and extract the raw key the same way to test the real verification
  // path, not a mocked one.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' });
  const rawPublicKey = publicKeyDer.subarray(publicKeyDer.length - 32); // strip the SPKI header
  const publicKeyBase64 = rawPublicKey.toString('base64');

  const timestamp = '1700000000';
  const body = JSON.stringify([{ event: 'delivered', sg_message_id: 'abc123' }]);

  function sign(payload: string): string {
    return cryptoSign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64');
  }

  it('accepts a correctly-signed payload', () => {
    const signature = sign(`${timestamp}${body}`);
    expect(verifySendGridSignature(body, signature, timestamp, publicKeyBase64)).toBe(true);
  });

  it('rejects a signature from a different keypair', () => {
    const { privateKey: otherKey } = generateKeyPairSync('ed25519');
    const badSignature = cryptoSign(
      null,
      Buffer.from(`${timestamp}${body}`, 'utf8'),
      otherKey
    ).toString('base64');
    expect(verifySendGridSignature(body, badSignature, timestamp, publicKeyBase64)).toBe(false);
  });

  it('rejects a tampered body', () => {
    const signature = sign(`${timestamp}${body}`);
    expect(verifySendGridSignature(body + 'x', signature, timestamp, publicKeyBase64)).toBe(false);
  });

  it('rejects a tampered timestamp', () => {
    const signature = sign(`${timestamp}${body}`);
    expect(verifySendGridSignature(body, signature, '1700000001', publicKeyBase64)).toBe(false);
  });

  it('rejects missing headers', () => {
    expect(verifySendGridSignature(body, undefined, timestamp, publicKeyBase64)).toBe(false);
    expect(
      verifySendGridSignature(body, sign(`${timestamp}${body}`), undefined, publicKeyBase64)
    ).toBe(false);
  });

  it('rejects when no public key is configured', () => {
    expect(verifySendGridSignature(body, sign(`${timestamp}${body}`), timestamp, '')).toBe(false);
  });

  it('does not throw on garbage signature input (malformed base64/DER)', () => {
    expect(verifySendGridSignature(body, 'not-valid-base64!!!', timestamp, publicKeyBase64)).toBe(
      false
    );
  });
});

describe('verifyMsg91Token', () => {
  it('accepts the correct shared-secret token', () => {
    expect(verifyMsg91Token('correct-secret', 'correct-secret')).toBe(true);
  });

  it('rejects an incorrect token', () => {
    expect(verifyMsg91Token('wrong-secret', 'correct-secret')).toBe(false);
  });

  it('rejects a missing token', () => {
    expect(verifyMsg91Token(undefined, 'correct-secret')).toBe(false);
  });

  it('rejects when no secret is configured', () => {
    expect(verifyMsg91Token('anything', '')).toBe(false);
  });
});
