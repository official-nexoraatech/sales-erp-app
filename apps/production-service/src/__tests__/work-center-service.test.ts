// Manufacturing vertical, Phase B — WorkCenterService against a real Postgres DB, mirroring
// bom-service.test.ts's own real-DB pattern.
import { describe, it, expect, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import { workCenters } from '@erp/db';
import { eq } from 'drizzle-orm';
import { BusinessError, NotFoundError } from '@erp/types';
import { WorkCenterService } from '../domain/WorkCenterService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('WorkCenterService — real Postgres', () => {
  const db = createDatabaseClient({ url: DB_URL! });
  const TEST_TENANT = 906_001 + Math.floor(Math.random() * 1000);

  afterAll(async () => {
    await db.delete(workCenters).where(eq(workCenters.tenantId, TEST_TENANT));
  });

  it('creates a work center and retrieves it via getById()', async () => {
    const svc = new WorkCenterService(db);
    const id = await svc.create({
      tenantId: TEST_TENANT,
      name: 'Cutting Station',
      code: 'CUT-1',
      capacityPerDay: 100,
      createdBy: 1,
    });

    const row = await svc.getById(id, TEST_TENANT);
    expect(row).not.toBeNull();
    expect(row!.name).toBe('Cutting Station');
    expect(row!.isActive).toBe(true);
    expect(parseFloat(row!.capacityPerDay)).toBe(100);
  });

  it('rejects a duplicate code within the same tenant', async () => {
    const svc = new WorkCenterService(db);
    await svc.create({ tenantId: TEST_TENANT, name: 'Press A', code: 'PRESS-1', createdBy: 1 });
    await expect(
      svc.create({ tenantId: TEST_TENANT, name: 'Press B', code: 'PRESS-1', createdBy: 1 })
    ).rejects.toThrow(BusinessError);
  });

  it('allows the same code across different tenants', async () => {
    const OTHER_TENANT = TEST_TENANT + 1;
    const svc = new WorkCenterService(db);
    await svc.create({ tenantId: TEST_TENANT, name: 'Assembly', code: 'ASM-1', createdBy: 1 });
    const id = await svc.create({
      tenantId: OTHER_TENANT,
      name: 'Assembly',
      code: 'ASM-1',
      createdBy: 1,
    });
    expect(id).toBeGreaterThan(0);
    await db.delete(workCenters).where(eq(workCenters.tenantId, OTHER_TENANT));
  });

  it('update() changes fields and getById() reflects them', async () => {
    const svc = new WorkCenterService(db);
    const id = await svc.create({
      tenantId: TEST_TENANT,
      name: 'Paint Booth',
      code: 'PAINT-1',
      createdBy: 1,
    });
    await svc.update(id, TEST_TENANT, { capacityPerDay: 50, isActive: false });
    const row = await svc.getById(id, TEST_TENANT);
    expect(parseFloat(row!.capacityPerDay)).toBe(50);
    expect(row!.isActive).toBe(false);
  });

  it('update() rejects an unknown work center', async () => {
    const svc = new WorkCenterService(db);
    await expect(svc.update(999_999_999, TEST_TENANT, { isActive: false })).rejects.toThrow(
      NotFoundError
    );
  });

  it("list() returns only this tenant's work centers", async () => {
    const svc = new WorkCenterService(db);
    const rows = await svc.list(TEST_TENANT);
    expect(rows.every((r) => r.tenantId === TEST_TENANT)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });
});
