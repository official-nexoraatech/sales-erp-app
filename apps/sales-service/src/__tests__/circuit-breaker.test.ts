/**
 * ES-16 — createCircuitBreaker (packages/platform-sdk/src/circuitBreaker.ts).
 * Exercises the generic breaker sales-service and scheduler-service wrap their
 * cross-service HTTP calls with (notification-service / inventory-service).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCircuitBreaker } from '@erp/sdk';
import { ServiceUnavailableError } from '@erp/types';

describe('createCircuitBreaker — ES-16', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens after 5 consecutive failures — the 6th call fails fast without invoking the action', async () => {
    const action = vi.fn().mockRejectedValue(new Error('downstream service down'));
    const breaker = createCircuitBreaker(action, 'inventory-service', {
      timeout: 1000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      rollingCountTimeout: 10000,
    });

    for (let i = 0; i < 5; i++) {
      await expect(breaker.fire()).rejects.toBeInstanceOf(ServiceUnavailableError);
    }
    expect(breaker.opened).toBe(true);

    const callsBeforeSixth = action.mock.calls.length;
    await expect(breaker.fire()).rejects.toBeInstanceOf(ServiceUnavailableError);

    // Circuit was open, so the 6th call must not have reached the action at all.
    expect(action.mock.calls.length).toBe(callsBeforeSixth);
  });

  it('half-opens after resetTimeout and a successful call closes the circuit', async () => {
    const action = vi.fn().mockRejectedValue(new Error('downstream service down'));
    const breaker = createCircuitBreaker(action, 'inventory-service', {
      timeout: 1000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      rollingCountTimeout: 10000,
    });

    for (let i = 0; i < 5; i++) {
      await expect(breaker.fire()).rejects.toBeInstanceOf(ServiceUnavailableError);
    }
    expect(breaker.opened).toBe(true);

    action.mockResolvedValueOnce('ok');
    await vi.advanceTimersByTimeAsync(30001);

    const result = await breaker.fire();
    expect(result).toBe('ok');
    expect(breaker.closed).toBe(true);
  });
});
