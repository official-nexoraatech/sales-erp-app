// CRM-ROADMAP Phase 4, Feature 4 — Territory Management.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  users,
  crmLeads,
  crmOpportunities,
  crmTerritories,
  crmTerritoryBranches,
  crmTerritoryUsers,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { OptimisticLockError, ValidationError } from '@erp/types';
import { TerritoryService } from '../domain/TerritoryService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('TerritoryService', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 904_401 + Math.floor(Math.random() * 1000);
  let branchA: number;
  let branchB: number;
  let branchC: number;
  let repX: number;
  let repY: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const branchRows = await db
      .insert(branches)
      .values([
        {
          tenantId: TEST_TENANT,
          name: 'Territory Branch A',
          code: 'TA',
          isHeadOffice: true,
          isActive: true,
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          name: 'Territory Branch B',
          code: 'TB',
          isHeadOffice: false,
          isActive: true,
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          name: 'Territory Branch C',
          code: 'TC',
          isHeadOffice: false,
          isActive: true,
          createdBy: 1,
        },
      ])
      .returning();
    [branchA, branchB, branchC] = branchRows.map((b) => b.id) as [number, number, number];

    const userRows = await db
      .insert(users)
      .values([
        {
          tenantId: TEST_TENANT,
          email: `repx-${TEST_TENANT}@test.local`,
          passwordHash: 'x',
          firstName: 'Rep',
          lastName: 'X',
        },
        {
          tenantId: TEST_TENANT,
          email: `repy-${TEST_TENANT}@test.local`,
          passwordHash: 'x',
          firstName: 'Rep',
          lastName: 'Y',
        },
      ])
      .returning();
    [repX, repY] = userRows.map((u) => u.id) as [number, number];
  });

  afterAll(async () => {
    await db.delete(crmTerritoryUsers).where(eq(crmTerritoryUsers.tenantId, TEST_TENANT));
    await db.delete(crmTerritoryBranches).where(eq(crmTerritoryBranches.tenantId, TEST_TENANT));
    await db.delete(crmTerritories).where(eq(crmTerritories.tenantId, TEST_TENANT));
    await db.delete(crmLeads).where(eq(crmLeads.tenantId, TEST_TENANT));
    await db.delete(crmOpportunities).where(eq(crmOpportunities.tenantId, TEST_TENANT));
    await db.delete(users).where(eq(users.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('creates a territory', async () => {
    const t = await TerritoryService.create(db, TEST_TENANT, 1, { name: 'North Region' });
    expect(t.name).toBe('North Region');
    expect(t.isActive).toBe(true);
  });

  it('updates a territory with optimistic locking, rejecting a stale version', async () => {
    const t = await TerritoryService.create(db, TEST_TENANT, 1, { name: 'To Rename' });
    await TerritoryService.update(db, TEST_TENANT, t.id, { name: 'Renamed', version: t.version });

    await expect(
      TerritoryService.update(db, TEST_TENANT, t.id, { name: 'Stale Write', version: t.version })
    ).rejects.toThrow(OptimisticLockError);
  });

  it('setBranches replaces the full branch set, not an incremental diff', async () => {
    const t = await TerritoryService.create(db, TEST_TENANT, 1, { name: 'Replace Test' });
    await TerritoryService.setBranches(db, TEST_TENANT, t.id, [branchA, branchB]);
    let coverage = await TerritoryService.getCoverage(db, TEST_TENANT, t.id);
    expect(coverage.branches.map((b) => b.id).sort()).toEqual([branchA, branchB].sort());

    await TerritoryService.setBranches(db, TEST_TENANT, t.id, [branchC]);
    coverage = await TerritoryService.getCoverage(db, TEST_TENANT, t.id);
    expect(coverage.branches.map((b) => b.id)).toEqual([branchC]);
  });

  it('setBranches rejects a branchId that does not belong to this tenant', async () => {
    const t = await TerritoryService.create(db, TEST_TENANT, 1, { name: 'Bad Branch Test' });
    await expect(TerritoryService.setBranches(db, TEST_TENANT, t.id, [999999999])).rejects.toThrow(
      ValidationError
    );
  });

  it('setUsers replaces the full rep set, not an incremental diff', async () => {
    const t = await TerritoryService.create(db, TEST_TENANT, 1, { name: 'Rep Replace Test' });
    await TerritoryService.setUsers(db, TEST_TENANT, t.id, [repX, repY]);
    let coverage = await TerritoryService.getCoverage(db, TEST_TENANT, t.id);
    expect(coverage.users.map((u) => u.id).sort()).toEqual([repX, repY].sort());

    await TerritoryService.setUsers(db, TEST_TENANT, t.id, [repX]);
    coverage = await TerritoryService.getCoverage(db, TEST_TENANT, t.id);
    expect(coverage.users.map((u) => u.id)).toEqual([repX]);
  });

  it('getTerritoryScope returns an empty array for a rep in no territory', async () => {
    const scope = await TerritoryService.getTerritoryScope(db, TEST_TENANT, repY);
    expect(scope).toEqual([]);
  });

  it("getTerritoryScope returns the UNION of branches across a rep's overlapping territories, not a conflict", async () => {
    const north = await TerritoryService.create(db, TEST_TENANT, 1, { name: 'Union North' });
    const south = await TerritoryService.create(db, TEST_TENANT, 1, { name: 'Union South' });
    await TerritoryService.setBranches(db, TEST_TENANT, north.id, [branchA, branchB]);
    await TerritoryService.setBranches(db, TEST_TENANT, south.id, [branchB, branchC]);
    await TerritoryService.setUsers(db, TEST_TENANT, north.id, [repX]);
    await TerritoryService.setUsers(db, TEST_TENANT, south.id, [repX]);

    const scope = await TerritoryService.getTerritoryScope(db, TEST_TENANT, repX);
    expect(scope.sort()).toEqual([branchA, branchB, branchC].sort());
  });

  it('getCoverage counts leads and opportunities across every branch in the territory', async () => {
    const t = await TerritoryService.create(db, TEST_TENANT, 1, { name: 'Coverage Count Test' });
    await TerritoryService.setBranches(db, TEST_TENANT, t.id, [branchA]);

    await db.insert(crmLeads).values({
      tenantId: TEST_TENANT,
      phone: '9900000099',
      branchId: branchA,
      source: 'OTHER',
    } as unknown as typeof crmLeads.$inferInsert);

    const coverage = await TerritoryService.getCoverage(db, TEST_TENANT, t.id);
    expect(coverage.leadCount).toBe(1);
    expect(coverage.opportunityCount).toBe(0);
  });
});
