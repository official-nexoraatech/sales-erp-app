import { afterEach, describe, expect, it, vi } from 'vitest';
import { LokiTransport } from '../loki-transport.js';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('LokiTransport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flushes a batch to Loki once batchSize is reached', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const transport = new LokiTransport({
      lokiUrl: 'http://loki:3100',
      labels: { service: 'test-service', env: 'test' },
      batchSize: 2,
      flushIntervalMs: 60_000,
    });

    transport.log({ level: 'info', message: 'first' }, () => undefined);
    transport.log({ level: 'info', message: 'second' }, () => undefined);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://loki:3100/loki/api/v1/push');
    const body = JSON.parse(options.body as string) as { streams: Array<{ stream: unknown; values: unknown[] }> };
    expect(body.streams).toHaveLength(1);
    expect(body.streams[0]?.stream).toEqual({ service: 'test-service', env: 'test' });
    expect(body.streams[0]?.values).toHaveLength(2);

    transport.close();
  });

  // batchSize is set high enough that these tests never auto-trigger a flush from
  // log() itself — the private flush() is invoked directly so each attempt is
  // deterministic, independent of how many entries happen to be queued.
  function manualFlush(transport: LokiTransport): Promise<void> {
    return (transport as unknown as { flush: () => Promise<void> }).flush();
  }

  it('re-queues entries instead of dropping them when Loki responds with a non-2xx status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const transport = new LokiTransport({
      lokiUrl: 'http://loki:3100',
      batchSize: 10,
      flushIntervalMs: 60_000,
    });

    transport.log({ level: 'error', message: 'boom' }, () => undefined);
    await manualFlush(transport);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce({ ok: true } as Response);
    await manualFlush(transport);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCall = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondBody = JSON.parse(secondCall[1].body as string) as { streams: Array<{ values: unknown[] }> };
    // The entry from the failed first attempt must survive into the retry — not dropped.
    expect(secondBody.streams[0]?.values).toHaveLength(1);

    transport.close();
  });

  it('re-queues entries instead of dropping them on a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    const transport = new LokiTransport({
      lokiUrl: 'http://loki:3100',
      batchSize: 10,
      flushIntervalMs: 60_000,
    });

    transport.log({ level: 'error', message: 'network-down' }, () => undefined);
    await manualFlush(transport);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce({ ok: true } as Response);
    await manualFlush(transport);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCall = fetchMock.mock.calls[1] as [string, RequestInit];
    const secondBody = JSON.parse(secondCall[1].body as string) as { streams: Array<{ values: unknown[] }> };
    expect(secondBody.streams[0]?.values).toHaveLength(1);

    transport.close();
  });

  it('invokes the winston callback synchronously so logging never blocks on the network call', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response));

    const transport = new LokiTransport({ lokiUrl: 'http://loki:3100', batchSize: 50, flushIntervalMs: 60_000 });
    const callback = vi.fn();
    transport.log({ level: 'info', message: 'sync-callback' }, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    transport.close();
  });
});
