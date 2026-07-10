import type { ErpDatabase } from './index.js';
import { isReplicaHealthy } from './replica-health.js';

export interface ReplicaRouterOptions {
  /** Max replication lag (ms) tolerated before falling back to primary. Default 5000. */
  maxLagMs?: number;
  /** How long a health-check result is cached before re-checking. Default 1000ms. */
  healthCacheMs?: number;
  /** Called each time forRead() falls back to primary due to lag/connection failure. */
  onFallback?: () => void;
}

/**
 * Per-query read routing between a primary and a read-replica Postgres client.
 * Never used for writes — callers keep using the primary client directly for those.
 */
export class ReplicaRouter {
  private readonly maxLagMs: number;
  private readonly healthCacheMs: number;
  private readonly onFallback: (() => void) | undefined;
  private cachedHealthy: boolean | undefined;
  private cachedAt = 0;

  constructor(
    private readonly primary: ErpDatabase,
    private readonly replica: ErpDatabase,
    options: ReplicaRouterOptions = {}
  ) {
    this.maxLagMs = options.maxLagMs ?? 5000;
    this.healthCacheMs = options.healthCacheMs ?? 1000;
    this.onFallback = options.onFallback;
  }

  async forRead(): Promise<ErpDatabase> {
    const now = Date.now();
    if (this.cachedHealthy === undefined || now - this.cachedAt >= this.healthCacheMs) {
      this.cachedHealthy = await isReplicaHealthy(this.replica, this.maxLagMs);
      this.cachedAt = now;
    }
    if (!this.cachedHealthy) {
      this.onFallback?.();
      return this.primary;
    }
    return this.replica;
  }
}
