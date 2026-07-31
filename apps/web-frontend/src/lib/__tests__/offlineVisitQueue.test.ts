// CRM-ROADMAP Phase 4, Feature 1 — Field Sales / Distributor CRM.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  submitOrQueueVisitAction,
  flushVisitQueue,
  listQueuedVisitActions,
} from '../offlineVisitQueue.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('submitOrQueueVisitAction', () => {
  it('returns the real response when the network request succeeds (no queueing)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 201 })) as unknown as typeof fetch;
    const result = await submitOrQueueVisitAction(
      {
        url: 'https://api.local/field-visits',
        method: 'POST',
        body: { customerId: 1, clientOperationId: 'op-1' },
      },
      () => 'token-abc'
    );
    expect(result.queued).toBe(false);
    const pending = await listQueuedVisitActions();
    expect(pending.length).toBe(0);
  });

  it('queues the action in IndexedDB when fetch throws (offline)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    const result = await submitOrQueueVisitAction(
      {
        url: 'https://api.local/field-visits',
        method: 'POST',
        body: { customerId: 2, clientOperationId: 'op-2' },
      },
      () => 'token-abc'
    );
    expect(result.queued).toBe(true);
    const pending = await listQueuedVisitActions();
    expect(
      pending.some((a) => (a.body as { clientOperationId: string }).clientOperationId === 'op-2')
    ).toBe(true);
  });

  it('sends the current token from getAccessToken, not a captured one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await submitOrQueueVisitAction(
      {
        url: 'https://api.local/field-visits',
        method: 'POST',
        body: { clientOperationId: 'op-3' },
      },
      () => 'fresh-token'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.local/field-visits',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      })
    );
  });
});

describe('flushVisitQueue', () => {
  beforeEach(async () => {
    // Ensure a clean slate — queue a known action via a forced offline submit.
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch;
    await submitOrQueueVisitAction(
      {
        url: 'https://api.local/field-visits',
        method: 'POST',
        body: { clientOperationId: 'flush-op-1' },
      },
      () => 'token'
    );
  });

  it('replays a queued action and removes it once the server accepts it', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 201 })) as unknown as typeof fetch;
    const { flushed } = await flushVisitQueue(() => 'token');
    expect(flushed).toBeGreaterThanOrEqual(1);
    const remaining = await listQueuedVisitActions();
    expect(
      remaining.some(
        (a) => (a.body as { clientOperationId: string }).clientOperationId === 'flush-op-1'
      )
    ).toBe(false);
  });

  it('stops flushing (keeps the action queued) if still offline', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('still offline')) as unknown as typeof fetch;
    const { remaining } = await flushVisitQueue(() => 'token');
    expect(remaining).toBeGreaterThanOrEqual(1);
  });

  it('keeps the action queued (does not remove it) on a 5xx server error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 503 })) as unknown as typeof fetch;
    const { flushed, remaining } = await flushVisitQueue(() => 'token');
    expect(flushed).toBe(0);
    expect(remaining).toBeGreaterThanOrEqual(1);
  });
});
