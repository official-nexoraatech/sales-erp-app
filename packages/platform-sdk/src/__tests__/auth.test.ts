/* global process */
// ES-35 — consolidates the JWT-verification and permission-check logic that was
// previously hand-duplicated (with real drift, including one hand-rolled RS256
// implementation in report-service) across 12+ services into one shared, tested
// implementation.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateKeyPair, exportSPKI, exportPKCS8, SignJWT, importPKCS8 } from 'jose';
import { verifyAccessToken, checkPermission, getBranchScope, AuthTokenError } from '../auth.js';

describe('getBranchScope', () => {
  it('restricts to the caller\'s assigned branches by default', () => {
    expect(getBranchScope({ permissions: ['INVOICE_VIEW'], branchIds: [1, 2] })).toEqual([1, 2]);
  });

  it('returns "all" when the caller holds BRANCH_SCOPE_BYPASS, even with branches assigned', () => {
    expect(getBranchScope({ permissions: ['INVOICE_VIEW', 'BRANCH_SCOPE_BYPASS'], branchIds: [1] })).toBe('all');
  });

  it('returns "all" when the caller has no branch assignments — doesn\'t lock out not-yet-assigned users', () => {
    expect(getBranchScope({ permissions: ['INVOICE_VIEW'], branchIds: [] })).toBe('all');
  });
});

describe('checkPermission', () => {
  it('returns "unauthenticated" when auth is undefined', () => {
    expect(checkPermission(undefined, 'INVOICE_VIEW')).toBe('unauthenticated');
  });

  it('returns "forbidden" when the permission is missing', () => {
    expect(checkPermission({ permissions: ['CUSTOMER_VIEW'] }, 'INVOICE_VIEW')).toBe('forbidden');
  });

  it('returns "ok" when the permission is present', () => {
    expect(checkPermission({ permissions: ['INVOICE_VIEW'] }, 'INVOICE_VIEW')).toBe('ok');
  });
});

describe('verifyAccessToken', () => {
  let publicKeyPem: string;
  let privateKeyPem: string;

  beforeEach(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    publicKeyPem = await exportSPKI(publicKey);
    privateKeyPem = await exportPKCS8(privateKey);
    process.env['JWT_PUBLIC_KEY'] = publicKeyPem;
  });

  afterEach(() => {
    delete process.env['JWT_PUBLIC_KEY'];
  });

  async function signToken(claims: Record<string, unknown>): Promise<string> {
    const privateKey = await importPKCS8(privateKeyPem, 'RS256');
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(String(claims['sub'] ?? '1'))
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  it('decodes a validly-signed token into AuthPayload', async () => {
    const token = await signToken({
      sub: '42', tenantId: 7, email: 'a@b.com', roles: ['ADMIN'], permissions: ['INVOICE_VIEW'], branchIds: [3, 5],
    });

    const payload = await verifyAccessToken(token);

    expect(payload).toEqual({
      sub: '42', tenantId: 7, email: 'a@b.com', roles: ['ADMIN'], permissions: ['INVOICE_VIEW'], branchIds: [3, 5], userId: 42,
    });
  });

  it('rejects a token signed with a different key', async () => {
    const { privateKey: otherPrivateKey } = await generateKeyPair('RS256');
    const forged = await new SignJWT({ sub: '1', tenantId: 1 })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('1h')
      .sign(otherPrivateKey);

    await expect(verifyAccessToken(forged)).rejects.toThrow();
  });

  it('rejects when JWT_PUBLIC_KEY is not configured', async () => {
    delete process.env['JWT_PUBLIC_KEY'];
    const token = await signToken({ sub: '1', tenantId: 1 });

    await expect(verifyAccessToken(token)).rejects.toThrow(AuthTokenError);
  });
});
