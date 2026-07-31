import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UpstreamCircuitBreaker } from '../upstream-circuit-breaker.js';

// Thresholds mirrored from upstream-circuit-breaker.ts (kept in sync manually — small
// enough surface that duplicating them here for readability outweighs exporting internals
// just for tests).
const FAILURE_THRESHOLD = 5;
const ROLLING_WINDOW_MS = 10_000;
const OPEN_DURATION_MS = 30_000;
const HALF_OPEN_PROBE_TIMEOUT_MS = 10_000;

describe('UpstreamCircuitBreaker', () => {
  let breaker: UpstreamCircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new UpstreamCircuitBreaker();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed — requests are allowed with no prior traffic', () => {
    expect(breaker.allowRequest('sales')).toBe(true);
  });

  it('stays closed for fewer than the failure threshold within the window', () => {
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) breaker.recordFailure('sales');
    expect(breaker.allowRequest('sales')).toBe(true);
  });

  it('opens once the failure threshold is reached within the rolling window', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) breaker.recordFailure('sales');
    expect(breaker.allowRequest('sales')).toBe(false);
  });

  it('resets the failure count once the rolling window elapses', () => {
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) breaker.recordFailure('sales');
    vi.advanceTimersByTime(ROLLING_WINDOW_MS + 1);
    // One more failure now starts a fresh window rather than adding to the stale count —
    // threshold - 1 (old) + 1 (new) would open it if the window incorrectly persisted.
    breaker.recordFailure('sales');
    expect(breaker.allowRequest('sales')).toBe(true);
  });

  it('rejects every request while open, before the cool-down elapses', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) breaker.recordFailure('sales');
    vi.advanceTimersByTime(OPEN_DURATION_MS - 1);
    expect(breaker.allowRequest('sales')).toBe(false);
  });

  it('allows exactly one half-open trial request after the cool-down, and rejects concurrent others', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) breaker.recordFailure('sales');
    vi.advanceTimersByTime(OPEN_DURATION_MS + 1);

    expect(breaker.allowRequest('sales')).toBe(true); // claims the trial slot
    expect(breaker.allowRequest('sales')).toBe(false); // a second, concurrent request
  });

  it('closes and resets on a successful half-open trial', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) breaker.recordFailure('sales');
    vi.advanceTimersByTime(OPEN_DURATION_MS + 1);
    expect(breaker.allowRequest('sales')).toBe(true); // trial

    breaker.recordSuccess('sales');

    expect(breaker.allowRequest('sales')).toBe(true);
    // A fresh failure count too — one failure alone shouldn't reopen it.
    breaker.recordFailure('sales');
    expect(breaker.allowRequest('sales')).toBe(true);
  });

  it('re-opens for a fresh cool-down if the half-open trial fails', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) breaker.recordFailure('sales');
    vi.advanceTimersByTime(OPEN_DURATION_MS + 1);
    expect(breaker.allowRequest('sales')).toBe(true); // trial

    breaker.recordFailure('sales'); // trial failed

    expect(breaker.allowRequest('sales')).toBe(false);
    vi.advanceTimersByTime(OPEN_DURATION_MS - 1);
    expect(breaker.allowRequest('sales')).toBe(false);
    vi.advanceTimersByTime(2);
    expect(breaker.allowRequest('sales')).toBe(true); // new trial after the new cool-down
  });

  it('self-heals if a half-open trial never resolves (stuck-probe safety net)', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) breaker.recordFailure('sales');
    vi.advanceTimersByTime(OPEN_DURATION_MS + 1);
    expect(breaker.allowRequest('sales')).toBe(true); // trial claimed, never resolves

    vi.advanceTimersByTime(HALF_OPEN_PROBE_TIMEOUT_MS + 1);
    // Re-opened with a fresh cool-down rather than permanently stuck rejecting forever.
    expect(breaker.allowRequest('sales')).toBe(false);
    vi.advanceTimersByTime(OPEN_DURATION_MS + 1);
    expect(breaker.allowRequest('sales')).toBe(true);
  });

  it('tracks each service independently — one tripped breaker does not affect another', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) breaker.recordFailure('sales');
    expect(breaker.allowRequest('sales')).toBe(false);
    expect(breaker.allowRequest('inventory')).toBe(true);
  });
});
