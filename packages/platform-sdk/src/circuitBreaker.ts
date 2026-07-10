import CircuitBreaker from 'opossum';
import { ServiceUnavailableError } from '@erp/types';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  rollingCountTimeout?: number;
}

// Wraps a cross-service HTTP call: 5 failures in 10s -> open; 30s half-open; close on success.
// On open, callers get a 503 ERPError immediately instead of a hung/failing HTTP request.
export function createCircuitBreaker<Args extends unknown[], Result>(
  action: (...args: Args) => Promise<Result>,
  serviceName: string,
  options?: CircuitBreakerOptions
): CircuitBreaker<Args, Result> {
  const breaker = new CircuitBreaker(action, {
    timeout: options?.timeout ?? 3000,
    errorThresholdPercentage: options?.errorThresholdPercentage ?? 50,
    resetTimeout: options?.resetTimeout ?? 30000,
    rollingCountTimeout: options?.rollingCountTimeout ?? 10000,
    rollingCountBuckets: 10,
    volumeThreshold: 5,
  });

  breaker.fallback(() => {
    throw new ServiceUnavailableError(
      `${serviceName.toUpperCase()}_UNAVAILABLE`,
      `${serviceName} is temporarily unavailable. Try again in 30 seconds.`
    );
  });

  return breaker;
}
