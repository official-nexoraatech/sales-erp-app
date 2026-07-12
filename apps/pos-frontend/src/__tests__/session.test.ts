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
    const session = await fetchActiveSession();
    expect(session?.id).toBe(5);
  });

  it('returns null when the server has no open session for the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { data: null })));
    expect(await fetchActiveSession()).toBeNull();
  });

  it('returns null (rather than throwing) on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));
    expect(await fetchActiveSession()).toBeNull();
  });
});
