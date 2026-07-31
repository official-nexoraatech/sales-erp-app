import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getActiveSessionId,
  setActiveSessionId,
  clearActiveSessionId,
  fetchActiveSession,
} from '../session.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('active session id persistence', () => {
  it('round-trips through localStorage under the pos_session_id key', () => {
    expect(getActiveSessionId()).toBeNull();
    setActiveSessionId(42);
    expect(getActiveSessionId()).toBe(42);
    expect(localStorage.getItem('pos_session_id')).toBe('42');
    clearActiveSessionId();
    expect(getActiveSessionId()).toBeNull();
  });
});

describe('fetchActiveSession', () => {
  it('returns the session from a successful GET /pos/sessions/active response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: 5, sessionNumber: 'S-1' } }))
    );
    const result = await fetchActiveSession();
    expect(result).toEqual({ status: 'found', session: { id: 5, sessionNumber: 'S-1' } });
  });

  it('reports not-found when the server has no open session for the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: null })));
    expect(await fetchActiveSession()).toEqual({ status: 'not-found' });
  });

  it('reports not-found (rather than throwing) on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));
    expect(await fetchActiveSession()).toEqual({ status: 'not-found' });
  });

  it('reports offline (rather than throwing) when the network request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await fetchActiveSession()).toEqual({ status: 'offline' });
  });
});
