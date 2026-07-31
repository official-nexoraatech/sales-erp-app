// Per-upstream-service circuit breaker for the gateway's proxy path, fed by real proxied
// request outcomes (via @fastify/http-proxy's onError, plus a passing onResponse), not a
// separate synthetic health probe — see the 2026-07-23 API Gateway audit (F3): this reflects
// what actual traffic is experiencing, at zero added per-request cost while the circuit is
// closed (the common case), unlike polling each upstream's own /health on an interval.
//
// Thresholds intentionally match packages/platform-sdk/src/circuitBreaker.ts's
// createCircuitBreaker defaults (5 failures/10s -> open, 30s cool-down) for consistency with
// every direct service-to-service call elsewhere in this codebase, even though that
// opossum-based helper doesn't fit here directly — it wraps a single async action's own
// call/response, and @fastify/http-proxy has no such seam to wrap (it manages its own HTTP
// forwarding internally). This reimplements the same numbers as a small external-signal state
// machine instead, driven by app.ts's per-upstream preHandler/onError/onResponse hooks.
const FAILURE_THRESHOLD = 5;
const ROLLING_WINDOW_MS = 10_000;
const OPEN_DURATION_MS = 30_000;
// Safety net only — guards against a single hung half-open probe (a connection that neither
// completes nor triggers onError, e.g. a black-holed route with no fast connection-refused)
// wedging the breaker open forever with no recovery path. Not expected to fire under normal
// operation; @fastify/http-proxy's own connection handling should surface most failures well
// before this.
const HALF_OPEN_PROBE_TIMEOUT_MS = 10_000;

type BreakerState = 'closed' | 'open' | 'half-open';

interface State {
  state: BreakerState;
  failureCount: number;
  windowStart: number;
  openedAt: number;
  halfOpenProbeStartedAt: number;
}

function freshState(now: number): State {
  return {
    state: 'closed',
    failureCount: 0,
    windowStart: now,
    openedAt: 0,
    halfOpenProbeStartedAt: 0,
  };
}

export class UpstreamCircuitBreaker {
  private readonly states = new Map<string, State>();

  private stateFor(service: string): State {
    let s = this.states.get(service);
    if (!s) {
      s = freshState(Date.now());
      this.states.set(service, s);
    }
    return s;
  }

  // Called from the proxy's preHandler, before forwarding. True means let the request
  // through (and, when transitioning out of 'open', claims the single half-open trial slot —
  // any other request arriving while that trial is in flight is rejected, so a recovering
  // upstream isn't immediately re-flooded).
  allowRequest(service: string): boolean {
    const s = this.stateFor(service);
    const now = Date.now();

    if (s.state === 'open') {
      if (now - s.openedAt >= OPEN_DURATION_MS) {
        s.state = 'half-open';
        s.halfOpenProbeStartedAt = now;
        return true;
      }
      return false;
    }

    if (s.state === 'half-open') {
      if (now - s.halfOpenProbeStartedAt > HALF_OPEN_PROBE_TIMEOUT_MS) {
        // The in-flight trial never resolved — don't wait on it forever; re-open with a
        // fresh cool-down so the next request after that gets its own trial.
        s.state = 'open';
        s.openedAt = now;
        return false;
      }
      return false;
    }

    return true; // closed
  }

  recordSuccess(service: string): void {
    const s = this.stateFor(service);
    s.state = 'closed';
    s.failureCount = 0;
    s.windowStart = Date.now();
  }

  recordFailure(service: string): void {
    const s = this.stateFor(service);
    const now = Date.now();

    if (s.state === 'half-open') {
      s.state = 'open';
      s.openedAt = now;
      return;
    }

    if (now - s.windowStart > ROLLING_WINDOW_MS) {
      s.failureCount = 0;
      s.windowStart = now;
    }
    s.failureCount += 1;
    if (s.failureCount >= FAILURE_THRESHOLD) {
      s.state = 'open';
      s.openedAt = now;
    }
  }
}
