// Shared idempotency helpers — the "idempotency keys" pillar of this codebase's
// distributed-consistency story (see ERP_MASTER_SPEC.md §4.10). Two distinct strategies
// live here, kept separate on purpose:
//   - DuplicateOperationError / isUniqueConstraintViolation / withIdempotentInsert: HARD
//     uniqueness, backed by a Postgres unique constraint. The operation must never be
//     double-applied, ever (e.g. invoice/customer/POS-sale creation from a client-generated
//     clientOperationId). Extracted from apps/sales-service/src/domain/InvoiceService.ts,
//     behavior-identical — not a redesign.
//   - deriveTimeBucketedDedupKey: SOFT, time-windowed dedup. Re-sending after the bucket
//     expires is acceptable (e.g. notification sends). Generalized from
//     apps/notification-service/src/domain/NotificationEngine.ts's deriveIdempotencyKey.
//
// Every key/constraint built from these helpers MUST scope by tenantId first — a global,
// non-tenant-scoped idempotency key is a cross-tenant collision risk.
import { createHash } from 'crypto';
import { ERPError } from '@erp/types';

export class DuplicateOperationError extends ERPError {
  constructor(public operationId: string, public entityType?: string) {
    super(
      'DUPLICATE_OPERATION',
      entityType
        ? `${entityType} operation ${operationId} was already submitted`
        : `Operation ${operationId} was already submitted`,
      409
    );
  }
}

export function isUniqueConstraintViolation(err: unknown, constraintName: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === '23505' &&
    (err as { constraint_name?: unknown }).constraint_name === constraintName
  );
}

export async function withIdempotentInsert<T>(
  fn: () => Promise<T>,
  constraintName: string,
  operationId: string,
  entityType?: string
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isUniqueConstraintViolation(err, constraintName)) {
      throw new DuplicateOperationError(operationId, entityType);
    }
    throw err;
  }
}

const DEDUP_BUCKET_MS = 5 * 60 * 1000;

export function deriveTimeBucketedDedupKey(
  tenantId: number,
  eventType: string,
  channel: string,
  recipient: string,
  templateData: unknown,
  bucketMs: number = DEDUP_BUCKET_MS
): string {
  const bucket = Math.floor(Date.now() / bucketMs);
  const raw = `${tenantId}:${eventType}:${channel}:${recipient}:${JSON.stringify(templateData)}:${bucket}`;
  return createHash('sha256').update(raw).digest('hex');
}
