import Transport from 'winston-transport';
import type { TransportStreamOptions } from 'winston-transport';

interface LokiEntry {
  streams: Array<{
    stream: Record<string, string>;
    values: Array<[string, string]>;
  }>;
}

interface LokiTransportOptions extends TransportStreamOptions {
  lokiUrl: string;
  labels?: Record<string, string>;
  batchSize?: number;
  flushIntervalMs?: number;
}

export class LokiTransport extends Transport {
  private readonly lokiUrl: string;
  private readonly labels: Record<string, string>;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly batch: Array<[string, string]> = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: LokiTransportOptions) {
    super(options);
    this.lokiUrl = `${options.lokiUrl}/loki/api/v1/push`;
    this.labels = options.labels ?? {};
    this.batchSize = options.batchSize ?? 50;
    this.flushIntervalMs = options.flushIntervalMs ?? 2000;
    this.scheduleFlush();
  }

  log(info: Record<string, unknown>, callback: () => void): void {
    setImmediate(() => this.emit('logged', info));

    const ts = BigInt(Date.now()) * 1_000_000n;
    this.batch.push([String(ts), JSON.stringify(info)]);

    if (this.batch.length >= this.batchSize) {
      void this.flush();
    }

    callback();
  }

  private scheduleFlush(): void {
    this.flushTimer = setTimeout(() => {
      void this.flush().then(() => this.scheduleFlush());
    }, this.flushIntervalMs);
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  private async flush(): Promise<void> {
    if (this.batch.length === 0) return;

    const entries = this.batch.splice(0, this.batchSize);
    const body: LokiEntry = {
      streams: [{ stream: this.labels, values: entries }],
    };

    try {
      const response = await fetch(this.lokiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        // Put entries back — non-destructive failure
        this.batch.unshift(...entries);
      }
    } catch {
      // Network error — put entries back
      this.batch.unshift(...entries);
    }
  }

  close(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    void this.flush();
  }
}
