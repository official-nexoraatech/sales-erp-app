// PG-028 — usage-rollup aggregation logic.
// No live DB this session (see [[es24_no_live_db_available]]) — rollupTenantUsage()'s DB
// round trip is exercised at deploy time via the scheduler's own manual-trigger endpoint
// (see the gap-prompt's Acceptance Criteria); these tests cover the pure aggregation
// functions the DB wrapper calls into.

import { describe, it, expect } from 'vitest';
import { aggregateUsageEvents, computeUsageSummary, computeCurrentPeriod } from '../jobs/usageRollup.js';

describe('aggregateUsageEvents', () => {
  it('sums quantity per event type, ignoring unknown types', () => {
    const result = aggregateUsageEvents([
      { eventType: 'USAGE_INVOICE_CREATED', quantity: 1 },
      { eventType: 'USAGE_INVOICE_CREATED', quantity: 1 },
      { eventType: 'USAGE_API_CALL_BATCH', quantity: 42 },
      { eventType: 'USAGE_API_CALL_BATCH', quantity: 8 },
      { eventType: 'SOME_UNRELATED_EVENT', quantity: 100 },
    ]);

    expect(result).toEqual({ invoiceCount: 2, apiCallCount: 50 });
  });

  it('returns zeros for an empty event set', () => {
    expect(aggregateUsageEvents([])).toEqual({ invoiceCount: 0, apiCallCount: 0 });
  });
});

describe('computeUsageSummary', () => {
  it('combines event aggregation with point-in-time user/storage counts', () => {
    const summary = computeUsageSummary({
      events: [
        { eventType: 'USAGE_INVOICE_CREATED', quantity: 1 },
        { eventType: 'USAGE_INVOICE_CREATED', quantity: 1 },
        { eventType: 'USAGE_INVOICE_CREATED', quantity: 1 },
        { eventType: 'USAGE_API_CALL_BATCH', quantity: 500 },
      ],
      activeUserCount: 12,
      storageBytes: 1_048_576,
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
    });

    expect(summary).toEqual({
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      invoiceCount: 3,
      activeUserCount: 12,
      storageBytes: 1_048_576,
      apiCallCount: 500,
    });
  });
});

describe('computeCurrentPeriod', () => {
  it('returns the first and last day of the given UTC month', () => {
    expect(computeCurrentPeriod(new Date('2026-07-10T12:00:00Z'))).toEqual({
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
    });
  });

  it('handles a 28-day February correctly', () => {
    expect(computeCurrentPeriod(new Date('2026-02-15T00:00:00Z'))).toEqual({
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
    });
  });

  it('handles December → still within the same year', () => {
    expect(computeCurrentPeriod(new Date('2026-12-25T00:00:00Z'))).toEqual({
      periodStart: '2026-12-01',
      periodEnd: '2026-12-31',
    });
  });
});
