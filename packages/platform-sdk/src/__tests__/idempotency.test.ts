import { describe, it, expect } from 'vitest';
import {
  DuplicateOperationError,
  isUniqueConstraintViolation,
  withIdempotentInsert,
  deriveTimeBucketedDedupKey,
} from '../idempotency.js';

function uniqueViolation(constraintName: string) {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: constraintName,
  });
}

// Mirrors drizzle-orm's real DrizzleQueryError (see errors.ts): `.insert(x).values(...)`
// never throws the raw postgres.js PostgresError directly, it wraps it as `.cause`.
function drizzleWrappedUniqueViolation(constraintName: string) {
  return Object.assign(new Error('Failed query: insert into ...'), {
    cause: uniqueViolation(constraintName),
  });
}

describe('isUniqueConstraintViolation', () => {
  it('returns true for a matching Postgres 23505 error', () => {
    expect(
      isUniqueConstraintViolation(
        uniqueViolation('invoices_tenant_client_operation_id'),
        'invoices_tenant_client_operation_id'
      )
    ).toBe(true);
  });

  it('returns true when the real error is wrapped in a DrizzleQueryError .cause (the actual shape thrown by .insert().values(), found in live QA 2026-07-17)', () => {
    expect(
      isUniqueConstraintViolation(
        drizzleWrappedUniqueViolation('items_tenant_code'),
        'items_tenant_code'
      )
    ).toBe(true);
  });

  it('returns false when the constraint name differs', () => {
    expect(
      isUniqueConstraintViolation(
        uniqueViolation('invoices_tenant_number'),
        'invoices_tenant_client_operation_id'
      )
    ).toBe(false);
    expect(
      isUniqueConstraintViolation(
        drizzleWrappedUniqueViolation('invoices_tenant_number'),
        'invoices_tenant_client_operation_id'
      )
    ).toBe(false);
  });

  it('returns false for a non-Postgres error', () => {
    expect(
      isUniqueConstraintViolation(new Error('boom'), 'invoices_tenant_client_operation_id')
    ).toBe(false);
    expect(isUniqueConstraintViolation(null, 'invoices_tenant_client_operation_id')).toBe(false);
  });
});

describe('withIdempotentInsert', () => {
  it('translates a matching unique-violation into DuplicateOperationError', async () => {
    const err = await withIdempotentInsert(
      () => Promise.reject(uniqueViolation('invoices_tenant_client_operation_id')),
      'invoices_tenant_client_operation_id',
      'op-123'
    ).catch((e) => e);

    expect(err).toBeInstanceOf(DuplicateOperationError);
    expect((err as DuplicateOperationError).operationId).toBe('op-123');
    expect((err as DuplicateOperationError).statusCode).toBe(409);
  });

  it('passes through any other error unchanged', async () => {
    const original = new Error('unrelated failure');
    const err = await withIdempotentInsert(
      () => Promise.reject(original),
      'invoices_tenant_client_operation_id',
      'op-123'
    ).catch((e) => e);

    expect(err).toBe(original);
  });

  it('resolves normally when fn succeeds', async () => {
    const result = await withIdempotentInsert(
      () => Promise.resolve(42),
      'invoices_tenant_client_operation_id',
      'op-123'
    );
    expect(result).toBe(42);
  });
});

describe('deriveTimeBucketedDedupKey', () => {
  it('produces a stable hash within the same time bucket', () => {
    const now = Date.now();
    const a = deriveTimeBucketedDedupKey(
      1,
      'INVOICE_REMINDER',
      'SMS',
      '+911234567890',
      { invoiceId: 1 },
      5 * 60 * 1000
    );
    const b = deriveTimeBucketedDedupKey(
      1,
      'INVOICE_REMINDER',
      'SMS',
      '+911234567890',
      { invoiceId: 1 },
      5 * 60 * 1000
    );
    expect(a).toBe(b);
    expect(now).toBeGreaterThan(0);
  });

  it('produces a different hash across buckets', () => {
    const bucketMs = 5 * 60 * 1000;
    const a = deriveTimeBucketedDedupKey(
      1,
      'INVOICE_REMINDER',
      'SMS',
      '+911234567890',
      { invoiceId: 1 },
      bucketMs
    );
    const b = deriveTimeBucketedDedupKey(
      1,
      'INVOICE_REMINDER',
      'SMS',
      '+911234567890',
      { invoiceId: 1 },
      1
    );
    expect(a).not.toBe(b);
  });

  it('produces a different hash for a different tenant/recipient', () => {
    const bucketMs = 5 * 60 * 1000;
    const a = deriveTimeBucketedDedupKey(
      1,
      'INVOICE_REMINDER',
      'SMS',
      '+911234567890',
      { invoiceId: 1 },
      bucketMs
    );
    const b = deriveTimeBucketedDedupKey(
      2,
      'INVOICE_REMINDER',
      'SMS',
      '+911234567890',
      { invoiceId: 1 },
      bucketMs
    );
    expect(a).not.toBe(b);
  });
});
