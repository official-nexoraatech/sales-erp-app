import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAccessToken,
  setTokens,
  clearTokens,
  authFetch,
  getAuthClaims,
  hasPermission,
} from '../auth.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// A JWT's payload is just base64url JSON — getAuthClaims only decodes it, it doesn't
// verify the signature (that already happened server-side), so a junk signature is fine.
function fakeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'RS256' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', {
    value: { href: '' },
    writable: true,
    configurable: true,
  });
});

describe('setTokens / getAccessToken', () => {
  it('persists both access and refresh tokens', () => {
    setTokens('access-1', 'refresh-1');
    expect(getAccessToken()).toBe('access-1');
    expect(localStorage.getItem('pos_refresh_token')).toBe('refresh-1');
  });

  it('clearTokens removes both', () => {
    setTokens('access-1', 'refresh-1');
    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem('pos_refresh_token')).toBeNull();
  });
});

describe('getAuthClaims — OFFLINE-05', () => {
  it('decodes tenantId, branchIds and permissions from the current access token', () => {
    setTokens(
      fakeJwt({ tenantId: 7, branchIds: [2, 3], permissions: ['POS_MANAGE'] }),
      'refresh-1'
    );
    expect(getAuthClaims()).toEqual({
      tenantId: 7,
      branchIds: [2, 3],
      permissions: ['POS_MANAGE'],
    });
  });

  it('defaults branchIds and permissions to [] when absent from the token', () => {
    setTokens(fakeJwt({ tenantId: 7 }), 'refresh-1');
    expect(getAuthClaims()).toEqual({ tenantId: 7, branchIds: [], permissions: [] });
  });

  it('returns null with no token stored', () => {
    expect(getAuthClaims()).toBeNull();
  });

  it('returns null for a malformed token instead of throwing', () => {
    setTokens('not-a-jwt', 'refresh-1');
    expect(getAuthClaims()).toBeNull();
  });
});

// RBAC gate for pos-frontend routes (main.tsx's RequirePermission) — every real POS backend
// route is gated on POS_MANAGE uniformly, so this is the one permission that decides whether
// an authenticated user can use the app at all. See qa scenario: a user with a valid ERP
// login but no till access (e.g. HR Manager) previously reached /shift/open and only found
// out via a raw "Missing permission: POS_MANAGE" toast at submit time.
describe('hasPermission', () => {
  it('returns true when the token carries the permission', () => {
    setTokens(fakeJwt({ tenantId: 7, permissions: ['POS_MANAGE', 'INVOICE_VIEW'] }), 'refresh-1');
    expect(hasPermission('POS_MANAGE')).toBe(true);
  });

  it('returns false when the token lacks the permission', () => {
    setTokens(fakeJwt({ tenantId: 7, permissions: ['EMPLOYEE_VIEW'] }), 'refresh-1');
    expect(hasPermission('POS_MANAGE')).toBe(false);
  });

  it('returns false with no token stored', () => {
    expect(hasPermission('POS_MANAGE')).toBe(false);
  });
});

describe('authFetch — refresh-and-retry', () => {
  it('passes through a successful call with no refresh attempt', async () => {
    setTokens('access-1', 'refresh-1');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authFetch('http://sales/api/thing');

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('on a 401, refreshes exactly once and retries the original request with the new token', async () => {
    setTokens('dead-access', 'refresh-1');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' })) // original call
      .mockResolvedValueOnce(
        jsonResponse(200, { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' })
      ) // /auth/refresh
      .mockResolvedValueOnce(jsonResponse(200, { data: 'ok-after-retry' })); // retried call
    vi.stubGlobal('fetch', fetchMock);

    const res = await authFetch('http://sales/api/thing');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: 'ok-after-retry' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]![0]).toContain('/auth/refresh');
    expect(getAccessToken()).toBe('fresh-access');

    // The retried request must carry the newly-refreshed access token.
    const retryHeaders = fetchMock.mock.calls[2]![1].headers as Headers;
    expect(retryHeaders.get('Authorization')).toBe('Bearer fresh-access');
  });

  it('a burst of concurrent 401s triggers only one refresh call, not one per request', async () => {
    setTokens('dead-access', 'refresh-1');
    let refreshCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls++;
        return Promise.resolve(
          jsonResponse(200, { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' })
        );
      }
      // Every plain API call 401s until the token has actually been refreshed.
      const currentToken = getAccessToken();
      if (currentToken === 'fresh-access') {
        return Promise.resolve(jsonResponse(200, { data: 'ok' }));
      }
      return Promise.resolve(jsonResponse(401, { error: 'expired' }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.all([
      authFetch('http://sales/api/pos/sales'),
      authFetch('http://sales/api/pos/sales'),
      authFetch('http://sales/api/pos/sales'),
    ]);

    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(refreshCalls).toBe(1);
  });

  it('a refresh-token failure falls back to clearing tokens and forcing re-login, without an infinite loop', async () => {
    setTokens('dead-access', 'dead-refresh');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' })) // original call
      .mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid or expired refresh token' })); // /auth/refresh fails
    vi.stubGlobal('fetch', fetchMock);

    const res = await authFetch('http://sales/api/thing');

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2); // original + refresh attempt — no retry loop
    expect(getAccessToken()).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  it('with no refresh token stored, a 401 forces re-login without ever calling /auth/refresh', async () => {
    localStorage.setItem('pos_token', 'dead-access'); // refresh token deliberately absent
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await authFetch('http://sales/api/thing');

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/login');
  });
});
