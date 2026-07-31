// CRM-ROADMAP Phase 4, Feature 1 — Field Sales / Distributor CRM.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient } from '@erp/db';
import {
  branches,
  users,
  customers,
  crmVisitRoutes,
  crmVisitRouteStops,
  crmFieldVisits,
} from '@erp/db';
import { eq } from 'drizzle-orm';
import { NotFoundError } from '@erp/types';
import { FieldVisitService } from '../domain/FieldVisitService.js';

const DB_URL = process.env['DATABASE_URL'];

describe.skipIf(!DB_URL)('FieldVisitService', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  const TEST_TENANT = 909_701 + Math.floor(Math.random() * 1000);
  let repX: number;
  let repY: number;
  let customerA: number;
  let customerB: number;

  beforeAll(async () => {
    db = createDatabaseClient({ url: DB_URL! });

    const [branch] = await db
      .insert(branches)
      .values({
        tenantId: TEST_TENANT,
        name: 'Field Sales Branch',
        code: 'FS',
        isHeadOffice: true,
        isActive: true,
        createdBy: 1,
      })
      .returning();

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

    const customerRows = await db
      .insert(customers)
      .values([
        {
          tenantId: TEST_TENANT,
          branchId: branch!.id,
          displayName: 'Distributor A',
          customerCode: `DA-${TEST_TENANT}`,
          phone: '9000000001',
          createdBy: 1,
        },
        {
          tenantId: TEST_TENANT,
          branchId: branch!.id,
          displayName: 'Distributor B',
          customerCode: `DB-${TEST_TENANT}`,
          phone: '9000000002',
          createdBy: 1,
        },
      ] as unknown as (typeof customers.$inferInsert)[])
      .returning();
    [customerA, customerB] = customerRows.map((c) => c.id) as [number, number];
  });

  afterAll(async () => {
    await db.delete(crmFieldVisits).where(eq(crmFieldVisits.tenantId, TEST_TENANT));
    await db.delete(crmVisitRouteStops).where(eq(crmVisitRouteStops.tenantId, TEST_TENANT));
    await db.delete(crmVisitRoutes).where(eq(crmVisitRoutes.tenantId, TEST_TENANT));
    await db.delete(customers).where(eq(customers.tenantId, TEST_TENANT));
    await db.delete(users).where(eq(users.tenantId, TEST_TENANT));
    await db.delete(branches).where(eq(branches.tenantId, TEST_TENANT));
  });

  it('creates a route and lists it scoped to the assigned rep when canViewAll is false', async () => {
    const route = await FieldVisitService.createRoute(db, TEST_TENANT, 1, {
      name: 'Monday Route',
      assignedTo: repX,
      scheduledDate: new Date(),
    });

    const asRepX = await FieldVisitService.listRoutes(db, TEST_TENANT, {
      canViewAll: false,
      callerId: repX,
    });
    expect(asRepX.some((r) => r.id === route.id)).toBe(true);

    const asRepY = await FieldVisitService.listRoutes(db, TEST_TENANT, {
      canViewAll: false,
      callerId: repY,
    });
    expect(asRepY.some((r) => r.id === route.id)).toBe(false);

    const asManager = await FieldVisitService.listRoutes(db, TEST_TENANT, {
      canViewAll: true,
      callerId: repY,
    });
    expect(asManager.some((r) => r.id === route.id)).toBe(true);
  });

  it('setStops replaces the full stop list and getRouteProgress reflects it', async () => {
    const route = await FieldVisitService.createRoute(db, TEST_TENANT, 1, {
      name: 'Stops Route',
      assignedTo: repX,
      scheduledDate: new Date(),
    });
    await FieldVisitService.setStops(db, TEST_TENANT, route.id, [
      { customerId: customerA, sequenceNumber: 0 },
      { customerId: customerB, sequenceNumber: 1 },
    ]);

    const progress = await FieldVisitService.getRouteProgress(db, TEST_TENANT, route.id);
    expect(progress.totalCount).toBe(2);
    expect(progress.completedCount).toBe(0);
    expect(progress.stops[0]!.customerName).toBe('Distributor A');
  });

  it('logVisit marks the linked route stop VISITED and getRouteProgress reflects the completion', async () => {
    const route = await FieldVisitService.createRoute(db, TEST_TENANT, 1, {
      name: 'Progress Route',
      assignedTo: repX,
      scheduledDate: new Date(),
    });
    await FieldVisitService.setStops(db, TEST_TENANT, route.id, [
      { customerId: customerA, sequenceNumber: 0 },
    ]);
    const progressBefore = await FieldVisitService.getRouteProgress(db, TEST_TENANT, route.id);
    const stopId = progressBefore.stops[0]!.id;

    await FieldVisitService.logVisit(db, TEST_TENANT, repX, {
      customerId: customerA,
      routeStopId: stopId,
      clientOperationId: `visit-${route.id}`,
    });

    const progressAfter = await FieldVisitService.getRouteProgress(db, TEST_TENANT, route.id);
    expect(progressAfter.completedCount).toBe(1);
    expect(progressAfter.stops[0]!.status).toBe('VISITED');
  });

  it('logVisit is idempotent — a retried clientOperationId returns the original visit, not a duplicate', async () => {
    const opId = `idempotent-op-${TEST_TENANT}`;
    const first = await FieldVisitService.logVisit(db, TEST_TENANT, repX, {
      customerId: customerB,
      clientOperationId: opId,
    });
    expect(first.alreadyExisted).toBe(false);

    const retry = await FieldVisitService.logVisit(db, TEST_TENANT, repX, {
      customerId: customerB,
      clientOperationId: opId,
    });
    expect(retry.alreadyExisted).toBe(true);
    expect(retry.visit.id).toBe(first.visit.id);

    const [count] = await db
      .select()
      .from(crmFieldVisits)
      .where(eq(crmFieldVisits.clientOperationId, opId));
    expect(count).toBeDefined();
  });

  it("checkOut succeeds for the visit's own rep", async () => {
    const { visit } = await FieldVisitService.logVisit(db, TEST_TENANT, repX, {
      customerId: customerA,
      clientOperationId: `checkout-op-${TEST_TENANT}`,
    });
    const updated = await FieldVisitService.checkOut(db, TEST_TENANT, repX, visit.id, {
      checkOutLat: 12.9,
      checkOutLng: 77.6,
    });
    expect(updated.checkOutAt).not.toBeNull();
  });

  it('checkOut throws NotFoundError (not 403) when a different rep attempts it', async () => {
    const { visit } = await FieldVisitService.logVisit(db, TEST_TENANT, repX, {
      customerId: customerA,
      clientOperationId: `checkout-ownership-op-${TEST_TENANT}`,
    });
    await expect(FieldVisitService.checkOut(db, TEST_TENANT, repY, visit.id, {})).rejects.toThrow(
      NotFoundError
    );
  });

  it("listVisits scopes to the caller's own visits unless canViewAll", async () => {
    await FieldVisitService.logVisit(db, TEST_TENANT, repY, {
      customerId: customerA,
      clientOperationId: `repy-visit-${TEST_TENANT}`,
    });

    const ownOnly = await FieldVisitService.listVisits(
      db,
      TEST_TENANT,
      { canViewAll: false, callerId: repX },
      {}
    );
    expect(ownOnly.every((v) => v.repUserId === repX)).toBe(true);

    const all = await FieldVisitService.listVisits(
      db,
      TEST_TENANT,
      { canViewAll: true, callerId: repX },
      {}
    );
    expect(all.some((v) => v.repUserId === repY)).toBe(true);
  });
});
