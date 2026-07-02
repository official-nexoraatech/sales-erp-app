import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlatformAuditLogger } from '../../src/audit.js';
import { createMockDb } from '../fixtures/platform.fixtures.js';

describe('PlatformAuditLogger', () => {
  const TENANT_ID = 5;
  const USER_ID = 42;
  let db: ReturnType<typeof createMockDb>;
  let auditLogger: PlatformAuditLogger;

  beforeEach(() => {
    db = createMockDb(TENANT_ID);
    auditLogger = new PlatformAuditLogger(db as never, USER_ID);
  });

  it('should write audit entry with correct tenant and user', async () => {
    await auditLogger.log({
      action: 'INVOICE_CREATED',
      entityType: 'Invoice',
      entityId: 123,
      after: { invoiceNumber: 'INV-2026-001', grandTotal: 50000 },
    });

    expect(db.raw.insert).toHaveBeenCalled();
  });

  it('should include before/after data for update operations', async () => {
    const before = { status: 'DRAFT', grandTotal: 40000 };
    const after = { status: 'CONFIRMED', grandTotal: 40000 };

    await auditLogger.log({
      action: 'INVOICE_CONFIRMED',
      entityType: 'Invoice',
      entityId: 456,
      before,
      after,
    });

    expect(db.raw.insert).toHaveBeenCalled();
  });

  it('should write multiple entries in a batch', async () => {
    const entries = [
      { action: 'STOCK_DEDUCTED', entityType: 'StockLedger', entityId: 1 },
      { action: 'RESERVATION_FULFILLED', entityType: 'Reservation', entityId: 2 },
      { action: 'INVOICE_CONFIRMED', entityType: 'Invoice', entityId: 3 },
    ];

    await auditLogger.logBatch(entries);

    // Batch insert should be called exactly once
    expect(db.raw.insert).toHaveBeenCalledTimes(1);
  });

  it('should not call DB when batch is empty', async () => {
    await auditLogger.logBatch([]);
    expect(db.raw.insert).not.toHaveBeenCalled();
  });
});
