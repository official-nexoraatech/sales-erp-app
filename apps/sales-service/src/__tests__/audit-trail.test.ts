// ES-20 — Audit Trail Tests
// Exercises PlatformAuditLogger directly against a real DB — this is the exact
// code path `ctx.audit.log(...)` in invoice.routes.ts / sale-return.routes.ts /
// customer.routes.ts goes through, so it validates the same behavior the routes rely on.

/* global process */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, auditLog } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { PlatformAuditLogger, TenantScopedDatabase } from '@erp/sdk';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('Audit trail', () => {
  let rawDb: ReturnType<typeof createDatabaseClient>;
  const TENANT_A = 900_201 + Math.floor(Math.random() * 1000);
  const TENANT_B = 900_301 + Math.floor(Math.random() * 1000);

  beforeAll(() => {
    rawDb = createDatabaseClient({ url: DB_URL! });
  });

  afterAll(async () => {
    await rawDb.delete(auditLog).where(eq(auditLog.tenantId, TENANT_A));
    await rawDb.delete(auditLog).where(eq(auditLog.tenantId, TENANT_B));
  });

  it('InvoiceService.create() path writes a CREATE audit_log row for entity=invoice', async () => {
    const db = new TenantScopedDatabase(TENANT_A, rawDb);
    const logger = new PlatformAuditLogger(db, 1);

    await logger.log({
      action: 'CREATE',
      entityType: 'invoice',
      entityId: 5001,
      after: { customerId: 42, lines: 3 },
      actorEmail: 'sales.user@example.com',
      ipAddress: '127.0.0.1',
    });

    const [row] = await rawDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, TENANT_A), eq(auditLog.entityType, 'invoice'), eq(auditLog.entityId, 5001)));

    expect(row).toBeDefined();
    expect(row!.action).toBe('CREATE');
    expect(row!.actorEmail).toBe('sales.user@example.com');
    expect(row!.afterData).toMatchObject({ customerId: 42, lines: 3 });
  });

  it('InvoiceService.confirm() path writes a STATUS_CHANGE row with old=DRAFT, new=CONFIRMED', async () => {
    const db = new TenantScopedDatabase(TENANT_A, rawDb);
    const logger = new PlatformAuditLogger(db, 1);

    await logger.log({
      action: 'STATUS_CHANGE',
      entityType: 'invoice',
      entityId: 5002,
      before: { status: 'DRAFT' },
      after: { status: 'CONFIRMED', invoiceNumber: 'INV-0001' },
      changedFields: ['status', 'invoiceNumber'],
    });

    const [row] = await rawDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, TENANT_A), eq(auditLog.entityType, 'invoice'), eq(auditLog.entityId, 5002)));

    expect(row).toBeDefined();
    expect(row!.action).toBe('STATUS_CHANGE');
    expect(row!.beforeData).toMatchObject({ status: 'DRAFT' });
    expect(row!.afterData).toMatchObject({ status: 'CONFIRMED' });
    expect(row!.changedFields).toEqual(['status', 'invoiceNumber']);
  });

  it('CustomerService.update({ email }) path writes changedFields=[\'email\'] with old+new values', async () => {
    const db = new TenantScopedDatabase(TENANT_A, rawDb);
    const logger = new PlatformAuditLogger(db, 1);

    await logger.log({
      action: 'UPDATE',
      entityType: 'customer',
      entityId: 5003,
      before: { email: 'old@example.com' },
      after: { email: 'new@example.com' },
      changedFields: ['email'],
    });

    const [row] = await rawDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, TENANT_A), eq(auditLog.entityType, 'customer'), eq(auditLog.entityId, 5003)));

    expect(row).toBeDefined();
    expect(row!.changedFields).toEqual(['email']);
    expect(row!.beforeData).toMatchObject({ email: 'old@example.com' });
    expect(row!.afterData).toMatchObject({ email: 'new@example.com' });
  });

  it('tenant isolation: querying tenant A audit log returns zero tenant B rows', async () => {
    const dbA = new TenantScopedDatabase(TENANT_A, rawDb);
    const dbB = new TenantScopedDatabase(TENANT_B, rawDb);

    await new PlatformAuditLogger(dbA, 1).log({ action: 'CREATE', entityType: 'invoice', entityId: 9001 });
    await new PlatformAuditLogger(dbB, 2).log({ action: 'CREATE', entityType: 'invoice', entityId: 9002 });

    const tenantARows = await rawDb.select().from(auditLog).where(eq(auditLog.tenantId, TENANT_A));
    const leakedFromB = tenantARows.filter((r) => r.tenantId === TENANT_B);

    expect(leakedFromB).toHaveLength(0);
    expect(tenantARows.some((r) => r.entityId === 9001)).toBe(true);
  });
});
