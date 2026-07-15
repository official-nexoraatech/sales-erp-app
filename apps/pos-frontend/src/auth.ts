import { mirrorTokens, clearMirroredTokens } from './tokenStore.js';

const AUTH_API = (import.meta.env['VITE_AUTH_API_URL'] ?? 'http://localhost:3010') + '/api/v2';

const ACCESS_TOKEN_KEY = 'pos_token';
const REFRESH_TOKEN_KEY = 'pos_refresh_token';

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  // OFFLINE-06: fire-and-forget mirror so the service worker can read the current token
  // for a background sync attempt — not on the critical path of page-context auth.
  void mirrorTokens(accessToken, refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  void clearMirroredTokens();
}

// There's no valid session left to recover — same fallback the old 401 handling used
// before this module existed (clear tokens, force a fresh login).
function forceLogout(): void {
  clearTokens();
  window.location.href = '/login';
}

async function callRefreshEndpoint(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const res = await fetch(`${AUTH_API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { accessToken: string; refreshToken: string };
  } catch {
    return null;
  }
}

let refreshPromise: Promise<string | null> | null = null;

// De-dupes concurrent refresh attempts into a single POST /auth/refresh call — mirrors
// apps/web-frontend/src/api/client.ts's convention. Without this, a burst of queued-sale
// syncs all discovering a dead token at once would each fire their own refresh request.
function refreshOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return null;
      const result = await callRefreshEndpoint(refreshToken);
      if (!result) return null;
      setTokens(result.accessToken, result.refreshToken);
      return result.accessToken;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// OFFLINE-05: held sales and offline-created customers need the current tenant/branch to
// write locally-scoped Dexie records — decodes the already-present JWT rather than adding
// a new endpoint or auth state just for this. Also carries permissions (present on every
// access token, see apps/auth-service/src/jwt.ts) so pos-frontend can gate routes/actions
// the same way web-frontend's auth store does, instead of only finding out server-side.
export function getAuthClaims(): {
  tenantId: number;
  branchIds: number[];
  permissions: string[];
} | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!)) as {
      tenantId?: number;
      branchIds?: number[];
      permissions?: string[];
    };
    if (typeof payload.tenantId !== 'number') return null;
    return {
      tenantId: payload.tenantId,
      branchIds: payload.branchIds ?? [],
      permissions: payload.permissions ?? [],
    };
  } catch {
    return null;
  }
}

export function hasPermission(permission: string): boolean {
  return getAuthClaims()?.permissions.includes(permission) ?? false;
}

// Proactive check before a sync batch (rather than relying solely on reactive 401s) so a
// burst of queued-sale POSTs doesn't each independently discover the token is dead.
export async function ensureFreshToken(): Promise<void> {
  const token = getAccessToken();
  if (!token) return;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!)) as { exp?: number };
    const expiresInMs = (payload.exp ?? 0) * 1000 - Date.now();
    if (expiresInMs < 60_000) {
      await refreshOnce();
    }
  } catch {
    // malformed token — the reactive 401 path in authFetch below still covers it
  }
}

// Wraps fetch to the sales-service (and production-service) APIs: attaches the current
// access token, and on a 401 refreshes (deduped) and retries the original request exactly
// once. Falls back to forceLogout() if the refresh token itself is invalid/expired.
export async function authFetch(
  input: string,
  init: RequestInit = {},
  isRetry = false
): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token ?? ''}`);
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401 && !isRetry) {
    const newToken = await refreshOnce();
    if (newToken) {
      return authFetch(input, init, true);
    }
    forceLogout();
  }

  // Every service now enforces tenant suspension/closure (PG-012) — every request from a
  // blocked tenant fails identically with one of these two codes. Redirect once to a
  // dedicated screen instead of leaving the caller to render a confusing generic error
  // for what is really an account-level, not request-level, problem. Clone before reading
  // so the caller's own res.json() still sees an unconsumed body.
  if (res.status === 403 || res.status === 410) {
    try {
      const body = (await res.clone().json()) as { error?: { code?: string } };
      const code = body.error?.code;
      if (code === 'TENANT_SUSPENDED' || code === 'TENANT_CLOSED') {
        const reason = code === 'TENANT_CLOSED' ? 'closed' : 'suspended';
        if (!window.location.pathname.startsWith('/account-suspended')) {
          window.location.href = `/account-suspended?reason=${reason}`;
        }
      }
    } catch {
      // not JSON, or body already consumed elsewhere — fall through, let the caller
      // handle the response as a normal error.
    }
  }

  return res;
}
