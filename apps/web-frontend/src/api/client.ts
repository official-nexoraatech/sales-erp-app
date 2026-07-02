import { useAuthStore } from '../store/auth.store.js';

const BASE_URLS: Record<string, string> = {
  auth: import.meta.env.VITE_AUTH_URL ?? 'http://localhost:3010',
  tenant: import.meta.env.VITE_TENANT_URL ?? 'http://localhost:3011',
  inventory: import.meta.env.VITE_INVENTORY_URL ?? 'http://localhost:3012',
  sales: import.meta.env.VITE_SALES_URL ?? 'http://localhost:3013',
  gst: import.meta.env.VITE_GST_URL ?? 'http://localhost:3018',
  accounting: import.meta.env.VITE_ACCOUNTING_URL ?? 'http://localhost:3019',
  purchase: import.meta.env.VITE_PURCHASE_URL ?? 'http://localhost:3020',
  hr: import.meta.env.VITE_HR_URL ?? 'http://localhost:3021',
  production: import.meta.env.VITE_PRODUCTION_URL ?? 'http://localhost:3022',
  report: import.meta.env.VITE_REPORT_URL ?? 'http://localhost:3015',
  event: import.meta.env.VITE_EVENT_URL ?? 'http://localhost:3023',
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

async function request<T>(
  service: keyof typeof BASE_URLS,
  path: string,
  options?: RequestInit
): Promise<T> {
  const { accessToken } = useAuthStore.getState();
  const url = `${BASE_URLS[service]}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options?.headers ?? {}),
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const err = data.error ?? {};
    throw new ApiError(err.code ?? 'UNKNOWN', err.message ?? 'Request failed', response.status, err.details);
  }

  return data.data as T;
}

export const apiClient = {
  get: <T>(service: keyof typeof BASE_URLS, path: string) =>
    request<T>(service, path, { method: 'GET' }),

  post: <T>(service: keyof typeof BASE_URLS, path: string, body?: unknown) =>
    request<T>(service, path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),

  put: <T>(service: keyof typeof BASE_URLS, path: string, body?: unknown) =>
    request<T>(service, path, { method: 'PUT', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),

  patch: <T>(service: keyof typeof BASE_URLS, path: string, body?: unknown) =>
    request<T>(service, path, { method: 'PATCH', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),

  delete: <T>(service: keyof typeof BASE_URLS, path: string) =>
    request<T>(service, path, { method: 'DELETE' }),
};
