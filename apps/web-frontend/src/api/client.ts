import { useAuthStore } from '../store/auth.store.js';

// Routed through api-gateway (apps/api-gateway) rather than calling each service
// directly by port — the gateway strips its own `/api/<service>` prefix and rewrites
// it to whatever prefix that service actually expects (see api-gateway/src/config.ts),
// so every entry here is just `<gateway>/api/<service>` regardless of that service's
// own internal versioning convention. Call paths in endpoints.ts are unchanged.
const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:3000';
const BASE_URLS: Record<string, string> = {
  auth: `${GATEWAY_URL}/api/auth`,
  tenant: `${GATEWAY_URL}/api/tenant`,
  inventory: `${GATEWAY_URL}/api/inventory`,
  sales: `${GATEWAY_URL}/api/sales`,
  gst: `${GATEWAY_URL}/api/gst`,
  accounting: `${GATEWAY_URL}/api/accounting`,
  purchase: `${GATEWAY_URL}/api/purchase`,
  hr: `${GATEWAY_URL}/api/hr`,
  production: `${GATEWAY_URL}/api/production`,
  search: `${GATEWAY_URL}/api/search`,
  report: `${GATEWAY_URL}/api/report`,
  event: `${GATEWAY_URL}/api/event`,
  notification: `${GATEWAY_URL}/api/notification`,
};

export function notificationServiceUrl(): string {
  return BASE_URLS['notification']!;
}

// Every service's requirePermission()/requireAnyPermission() middleware throws a 403 with
// code 'FORBIDDEN' and a raw `Missing permission: X` message meant for logs/API consumers
// (see apps/sales-service/src/middleware/authorize.ts and its near-identical copies across
// the other services). Translated once here so every one of this app's ~200 ad hoc
// `toast.error(err.message)` call sites gets user-facing copy for free, instead of needing
// each site individually updated.
const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN:
    "You don't have permission to do this. Contact your administrator if you think this is a mistake.",
  PERMISSION_DENIED:
    "You don't have permission to do this. Contact your administrator if you think this is a mistake.",
};

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The refresh endpoint returns tokens directly (no {data:...} envelope), unlike every
// other route, so it's called with a plain fetch rather than through request()/apiClient.
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const response = await fetch(`${BASE_URLS.auth}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) return null;
  const body = await response.json();
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const { refreshToken, setTokens, setUser, user, logout } = useAuthStore.getState();
  if (!refreshToken) {
    logout();
    return null;
  }
  const result = await refreshAccessToken(refreshToken);
  if (!result) {
    logout();
    return null;
  }
  setTokens(result.accessToken, result.refreshToken);

  // Re-decode roles/permissions from the fresh token — otherwise a mid-session permission
  // change (role edit, revoke) never reaches the UI until the user logs out and back in,
  // since the auth store only updated permissions at initial login.
  if (user) {
    try {
      const jwtPayload = JSON.parse(atob(result.accessToken.split('.')[1]!)) as {
        roles?: string[];
        permissions?: string[];
      };
      setUser({
        ...user,
        roles: jwtPayload.roles ?? user.roles,
        permissions: jwtPayload.permissions ?? user.permissions,
      });
    } catch {
      // malformed token payload — keep the previous permissions rather than crash the refresh flow
    }
  }

  return result.accessToken;
}

async function request<T>(
  service: keyof typeof BASE_URLS,
  path: string,
  options?: RequestInit,
  isRetry = false
): Promise<T> {
  const { accessToken } = useAuthStore.getState();
  const url = `${BASE_URLS[service]}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options?.headers ?? {}),
    },
  });

  const isRefreshRoute = service === 'auth' && path === '/auth/refresh';

  // A 401 with no access token attached (login, MFA verify, forgot-password) means the
  // credentials themselves were rejected, not that a session expired — let it fall through
  // to the normal error path below instead of trying to refresh/redirect.
  if (response.status === 401 && !isRetry && !isRefreshRoute && accessToken) {
    // An impersonation access token has no refresh token of its own (see /admin/impersonate) —
    // a 401 here means it expired or was revoked, so fall back to the admin's real session
    // rather than attempting to refresh it (which would silently trade impersonated
    // permissions for the admin's own without the UI ever telling the user).
    if (useAuthStore.getState().realSession) {
      useAuthStore.getState().stopImpersonation();
      return request<T>(service, path, options, true);
    }
    if (!refreshPromise) {
      refreshPromise = performRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    const newToken = await refreshPromise;
    if (newToken) {
      return request<T>(service, path, options, true);
    }
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError('UNAUTHENTICATED', 'Session expired', 401);
  }

  // A 204 No Content response (used by several DELETE routes, e.g. SSO config removal,
  // cost centers, roles, attachments) has no body — calling .json() on it throws
  // "Unexpected end of JSON input", which every caller then saw as a failed mutation
  // even though the request actually succeeded server-side.
  const data = response.status === 204 ? null : await response.json();

  if (!response.ok) {
    // auth-service sends `{ error: 'some message' }` (a plain string), while every
    // other service sends `{ error: { code, message, details } }` (an object) — accept both.
    const errRaw = data.error;
    const err = typeof errRaw === 'string' ? { message: errRaw } : (errRaw ?? {});

    // Every service now enforces tenant suspension/closure (PG-012) — every request
    // from a blocked tenant fails identically, so redirect once to a dedicated full-page
    // message instead of letting each caller's own error handling show a confusing
    // generic toast for what is really an account-level, not request-level, problem.
    if (
      (err.code === 'TENANT_SUSPENDED' || err.code === 'TENANT_CLOSED') &&
      typeof window !== 'undefined'
    ) {
      const reason = err.code === 'TENANT_CLOSED' ? 'closed' : 'suspended';
      if (!window.location.pathname.startsWith('/account-suspended')) {
        window.location.href = `/account-suspended?reason=${reason}`;
      }
    }

    throw new ApiError(
      err.code ?? 'UNKNOWN',
      (err.code && FRIENDLY_ERROR_MESSAGES[err.code]) || err.message || 'Request failed',
      response.status,
      err.details
    );
  }

  return (data === null ? null : data.data) as T;
}

export const apiClient = {
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

  patch: <T>(service: keyof typeof BASE_URLS, path: string, body?: unknown) =>
    request<T>(service, path, {
      method: 'PATCH',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),

  delete: <T>(service: keyof typeof BASE_URLS, path: string, body?: unknown) =>
    request<T>(service, path, {
      method: 'DELETE',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),

  getBlob: async (service: keyof typeof BASE_URLS, path: string): Promise<Blob> => {
    const { accessToken } = useAuthStore.getState();
    const response = await fetch(`${BASE_URLS[service]}${path}`, {
      headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    });
    if (!response.ok)
      throw new ApiError('DOWNLOAD_FAILED', 'Failed to download file', response.status);
    return response.blob();
  },

  upload: async <T>(
    service: keyof typeof BASE_URLS,
    path: string,
    formData: FormData
  ): Promise<T> => {
    const { accessToken } = useAuthStore.getState();
    const response = await fetch(`${BASE_URLS[service]}${path}`, {
      method: 'POST',
      headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      const err = data.error ?? {};
      throw new ApiError(
        err.code ?? 'UNKNOWN',
        err.message ?? 'Upload failed',
        response.status,
        err.details
      );
    }
    return data.data as T;
  },
};
