import { useAuthStore } from '../store/auth.store.js';

// Services below mount all their routes under an `/api/v2` prefix (see each
// service's main.ts). report, production and event are the exceptions: their
// call paths in endpoints.ts already embed `/api/v2` (report's analytics/dashboard
// routes) or `/api/v1` (report's two aging reports) directly, or no prefix at all
// (report's PDF/number-series routes, which this frontend never calls), so their
// base URLs must stay unsuffixed here to avoid doubling the prefix.
// PG-010: auth, notification and search now register under /api/v2 too (auth-service's
// /auth/refresh call in refreshAccessToken() below relies on this same base URL).
const BASE_URLS: Record<string, string> = {
  auth: (import.meta.env.VITE_AUTH_URL ?? 'http://localhost:3010') + '/api/v2',
  tenant: (import.meta.env.VITE_TENANT_URL ?? 'http://localhost:3011') + '/api/v2',
  inventory: (import.meta.env.VITE_INVENTORY_URL ?? 'http://localhost:3012') + '/api/v2',
  sales: (import.meta.env.VITE_SALES_URL ?? 'http://localhost:3013') + '/api/v2',
  gst: (import.meta.env.VITE_GST_URL ?? 'http://localhost:3018') + '/api/v2',
  accounting: (import.meta.env.VITE_ACCOUNTING_URL ?? 'http://localhost:3019') + '/api/v2',
  purchase: (import.meta.env.VITE_PURCHASE_URL ?? 'http://localhost:3020') + '/api/v2',
  hr: (import.meta.env.VITE_HR_URL ?? 'http://localhost:3021') + '/api/v2',
  production: import.meta.env.VITE_PRODUCTION_URL ?? 'http://localhost:3022',
  search: (import.meta.env.VITE_SEARCH_URL ?? 'http://localhost:3017') + '/api/v2',
  report: import.meta.env.VITE_REPORT_URL ?? 'http://localhost:3015',
  event: import.meta.env.VITE_EVENT_URL ?? 'http://localhost:3023',
  notification: (import.meta.env.VITE_NOTIFICATION_URL ?? 'http://localhost:3014') + '/api/v2',
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
