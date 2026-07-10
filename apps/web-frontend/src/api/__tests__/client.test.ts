import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient } from '../client.js';
import { useAuthStore } from '../../store/auth.store.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiClient refresh-on-401 interceptor', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: 'old-token', refreshToken: 'old-refresh', user: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes once on a 401 and retries the original request with the new token', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/refresh')) {
        return jsonResponse({ accessToken: 'new-token', refreshToken: 'new-refresh' }, 200);
      }
      const authHeader = (init?.headers as Record<string, string>)?.Authorization;
      if (authHeader === 'Bearer old-token') {
        return jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'expired' } }, 401);
      }
      if (authHeader === 'Bearer new-token') {
        return jsonResponse({ data: { ok: true } }, 200);
      }
      return jsonResponse({}, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiClient.get<{ ok: boolean }>('sales', '/customers');

    expect(result).toEqual({ ok: true });
    expect(useAuthStore.getState().accessToken).toBe('new-token');

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('does not loop when the retried request also gets a 401', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return jsonResponse({ accessToken: 'new-token', refreshToken: 'new-refresh' }, 200);
      }
      return jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'still expired' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.get('sales', '/customers')).rejects.toThrow();

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('single-flights concurrent 401s into exactly one refresh call', async () => {
    let refreshCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/auth/refresh')) {
        refreshCount++;
        return jsonResponse({ accessToken: 'new-token', refreshToken: 'new-refresh' }, 200);
      }
      const authHeader = (init?.headers as Record<string, string>)?.Authorization;
      if (authHeader === 'Bearer old-token') {
        return jsonResponse({ error: { message: 'expired' } }, 401);
      }
      return jsonResponse({ data: { ok: true } }, 200);
    });
    vi.stubGlobal('fetch', fetchMock);

    const [r1, r2] = await Promise.all([
      apiClient.get('sales', '/customers'),
      apiClient.get('sales', '/suppliers'),
    ]);

    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(refreshCount).toBe(1);
  });
});
