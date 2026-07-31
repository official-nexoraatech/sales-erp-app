import { usePortalAuthStore } from '../store/portalAuth.store.js';

// Routed through api-gateway, same reasoning as web-frontend's own client.ts — see that
// file's header comment.
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:3000';
const BASE_URLS = {
  auth: `${GATEWAY_URL}/api/auth`,
  sales: `${GATEWAY_URL}/api/sales`,
} as const;

export class PortalApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'PortalApiError';
  }
}

// /auth/portal/refresh returns tokens unenveloped, matching the staff /auth/refresh route's
// own response shape (see e2e_helpers_cors_credentials_fix memory / WEB-FRONTEND client.ts's
// refreshAccessToken — the same asymmetry exists here on purpose, for consistency).
async function refreshPortalAccessToken(): Promise<string | null> {
  const response = await fetch(`${BASE_URLS.auth}/auth/portal/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body.accessToken as string;
}

let refreshPromise: Promise<string | null> | null = null;

// Called once on app mount (see App.tsx) to silently re-derive an in-memory access token
// from the httpOnly portal_refresh_token cookie — the access token itself is never persisted
// to localStorage (see portalAuth.store.ts's partialize).
export async function performPortalRefresh(): Promise<string | null> {
  const { setAccessToken, logout } = usePortalAuthStore.getState();
  const token = await refreshPortalAccessToken();
  if (!token) {
    logout();
    return null;
  }
  setAccessToken(token);
  return token;
}

async function request<T>(
  service: keyof typeof BASE_URLS,
  path: string,
  options?: RequestInit,
  isRetry = false
): Promise<T> {
  const { accessToken } = usePortalAuthStore.getState();
  const url = `${BASE_URLS[service]}${path}`;

  const response = await fetch(url, {
    ...options,
    // Only the portal-auth routes ever set/read the httpOnly portal_refresh_token cookie.
    ...(service === 'auth' ? { credentials: 'include' as RequestCredentials } : {}),
    headers: {
      ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options?.headers ?? {}),
    },
  });

  const isRefreshRoute = service === 'auth' && path === '/auth/portal/refresh';

  if (response.status === 401 && !isRetry && !isRefreshRoute && accessToken) {
    if (!refreshPromise) {
      refreshPromise = performPortalRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    const newToken = await refreshPromise;
    if (newToken) {
      return request<T>(service, path, options, true);
    }
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new PortalApiError('UNAUTHENTICATED', 'Session expired', 401);
  }

  const data = response.status === 204 ? null : await response.json();

  if (!response.ok) {
    // auth-service sends `{ error: 'some message' }` (a plain string), every other service
    // sends `{ error: { code, message } }` — accept both, same as web-frontend's client.ts.
    const errRaw = data?.error;
    const err = typeof errRaw === 'string' ? { message: errRaw } : (errRaw ?? {});
    throw new PortalApiError(
      err.code ?? 'UNKNOWN',
      err.message ?? 'Request failed',
      response.status
    );
  }

  return (data === null ? null : data.data) as T;
}

export const portalApiClient = {
  get: <T>(service: keyof typeof BASE_URLS, path: string) =>
    request<T>(service, path, { method: 'GET' }),
  post: <T>(service: keyof typeof BASE_URLS, path: string, body?: unknown) =>
    request<T>(service, path, {
      method: 'POST',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  put: <T>(service: keyof typeof BASE_URLS, path: string, body?: unknown) =>
    request<T>(service, path, {
      method: 'PUT',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
};
