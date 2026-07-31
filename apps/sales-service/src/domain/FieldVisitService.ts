import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { crmVisitRoutes, crmVisitRouteStops, crmFieldVisits, customers } from '@erp/db';
import type { ErpDatabase, CrmVisitRoute, CrmFieldVisit } from '@erp/db';
import { NotFoundError, OptimisticLockError } from '@erp/types';
import { isUniqueConstraintViolation } from '@erp/sdk';

export interface RouteProgress {
  route: CrmVisitRoute;
  stops: Array<{
    id: number;
    customerId: number;
    customerName: string | null;
    sequenceNumber: number;
    status: 'PENDING' | 'VISITED' | 'SKIPPED';
    visitId: number | null;
  }>;
  completedCount: number;
  totalCount: number;
}

/**
 * CRM-ROADMAP Phase 4, Feature 1 — Field Sales / Distributor CRM.
 *
 * `crmVisitRoutes`/`crmVisitRouteStops` are the planned side (a distribution manager lays out a
 * rep's stops); `crmFieldVisits` is the actual-visit log, optionally linked to a planned stop but
 * also valid standalone (an unplanned/ad-hoc visit is a real, supported case).
 *
 * `logVisit` reuses this codebase's existing offline-created-record idempotency mechanism
 * (the `clientOperationId` unique-constraint + catch-and-return-existing pattern already used by
 * `CustomerService.create`/`InvoiceService.create` for OFFLINE-02/05) rather than inventing a new
 * conflict-resolution strategy — the roadmap's own spec explicitly calls for reusing the
 * existing pattern, not a new one.
 */
export class FieldVisitService {
  static async createRoute(
    db: ErpDatabase,
    tenantId: number,
    userId: number,
    params: {
      name: string;
      assignedTo: number;
      territoryId?: number | undefined;
      scheduledDate: Date;
    }
  ): Promise<CrmVisitRoute> {
    const [created] = await db
      .insert(crmVisitRoutes)
      .values({
        tenantId,
        name: params.name,
        assignedTo: params.assignedTo,
        territoryId: params.territoryId ?? null,
        scheduledDate: params.scheduledDate,
        createdBy: userId,
      })
      .returning();
    if (!created) throw new Error('Route creation failed unexpectedly');
    return created;
  }

  static async listRoutes(
    db: ErpDatabase,
    tenantId: number,
    scope: { canViewAll: boolean; callerId: number }
  ): Promise<CrmVisitRoute[]> {
    const whereClause = scope.canViewAll
      ? eq(crmVisitRoutes.tenantId, tenantId)
      : and(eq(crmVisitRoutes.tenantId, tenantId), eq(crmVisitRoutes.assignedTo, scope.callerId));
    return db
      .select()
      .from(crmVisitRoutes)
      .where(whereClause)
      .orderBy(crmVisitRoutes.scheduledDate);
  }

  /** Replace-all: the caller sends the complete desired ordered stop list, not an incremental diff. */
  static async setStops(
    db: ErpDatabase,
    tenantId: number,
    routeId: number,
    stops: Array<{ customerId: number; sequenceNumber: number }>
  ): Promise<void> {
    const [route] = await db
      .select({ id: crmVisitRoutes.id })
      .from(crmVisitRoutes)
      .where(and(eq(crmVisitRoutes.id, routeId), eq(crmVisitRoutes.tenantId, tenantId)));
    if (!route) throw new NotFoundError('VisitRoute', routeId);

    await db.transaction(async (trx) => {
      await trx.delete(crmVisitRouteStops).where(eq(crmVisitRouteStops.routeId, routeId));
      if (stops.length > 0) {
        await trx.insert(crmVisitRouteStops).values(
          stops.map((s) => ({
            tenantId,
            routeId,
            customerId: s.customerId,
            sequenceNumber: s.sequenceNumber,
          }))
        );
      }
    });
  }

  static async getRouteProgress(
    db: ErpDatabase,
    tenantId: number,
    routeId: number
  ): Promise<RouteProgress> {
    const [route] = await db
      .select()
      .from(crmVisitRoutes)
      .where(and(eq(crmVisitRoutes.id, routeId), eq(crmVisitRoutes.tenantId, tenantId)));
    if (!route) throw new NotFoundError('VisitRoute', routeId);

    const stopRows = await db
      .select({
        id: crmVisitRouteStops.id,
        customerId: crmVisitRouteStops.customerId,
        customerName: customers.displayName,
        sequenceNumber: crmVisitRouteStops.sequenceNumber,
        status: crmVisitRouteStops.status,
        visitId: crmVisitRouteStops.visitId,
      })
      .from(crmVisitRouteStops)
      .leftJoin(customers, eq(customers.id, crmVisitRouteStops.customerId))
      .where(eq(crmVisitRouteStops.routeId, routeId))
      .orderBy(crmVisitRouteStops.sequenceNumber);

    return {
      route,
      stops: stopRows,
      completedCount: stopRows.filter((s) => s.status !== 'PENDING').length,
      totalCount: stopRows.length,
    };
  }

  static async logVisit(
    db: ErpDatabase,
    tenantId: number,
    repUserId: number,
    params: {
      customerId: number;
      routeStopId?: number | undefined;
      checkInLat?: number | undefined;
      checkInLng?: number | undefined;
      notes?: string | undefined;
      clientOperationId?: string | undefined;
    }
  ): Promise<{ visit: CrmFieldVisit; alreadyExisted: boolean }> {
    let created: CrmFieldVisit | undefined;
    try {
      [created] = await db
        .insert(crmFieldVisits)
        .values({
          tenantId,
          repUserId,
          customerId: params.customerId,
          routeStopId: params.routeStopId ?? null,
          ...(params.checkInLat !== undefined ? { checkInLat: String(params.checkInLat) } : {}),
          ...(params.checkInLng !== undefined ? { checkInLng: String(params.checkInLng) } : {}),
          notes: params.notes ?? null,
          clientOperationId: params.clientOperationId ?? null,
        } as unknown as typeof crmFieldVisits.$inferInsert)
        .returning();
    } catch (err) {
      if (
        isUniqueConstraintViolation(err, 'crm_field_visits_tenant_client_operation_id') &&
        params.clientOperationId
      ) {
        const [existing] = await db
          .select()
          .from(crmFieldVisits)
          .where(
            and(
              eq(crmFieldVisits.tenantId, tenantId),
              eq(crmFieldVisits.clientOperationId, params.clientOperationId)
            )
          );
        if (existing) return { visit: existing, alreadyExisted: true };
      }
      throw err;
    }
    if (!created) throw new Error('Visit log failed unexpectedly');

    if (params.routeStopId) {
      await db
        .update(crmVisitRouteStops)
        .set({ status: 'VISITED', visitId: created.id })
        .where(
          and(
            eq(crmVisitRouteStops.id, params.routeStopId),
            eq(crmVisitRouteStops.tenantId, tenantId)
          )
        );
    }

    return { visit: created, alreadyExisted: false };
  }

  /** Ownership mismatch returns NotFoundError (404), never a 403 — same discipline as the
   *  Customer Portal's own routes: a rep probing another rep's visit id learns nothing. */
  static async checkOut(
    db: ErpDatabase,
    tenantId: number,
    repUserId: number,
    visitId: number,
    params: { checkOutLat?: number | undefined; checkOutLng?: number | undefined }
  ): Promise<CrmFieldVisit> {
    const [updated] = await db
      .update(crmFieldVisits)
      .set({
        checkOutAt: new Date(),
        ...(params.checkOutLat !== undefined ? { checkOutLat: String(params.checkOutLat) } : {}),
        ...(params.checkOutLng !== undefined ? { checkOutLng: String(params.checkOutLng) } : {}),
        updatedAt: new Date(),
      } as unknown as Partial<typeof crmFieldVisits.$inferInsert>)
      .where(
        and(
          eq(crmFieldVisits.id, visitId),
          eq(crmFieldVisits.tenantId, tenantId),
          eq(crmFieldVisits.repUserId, repUserId)
        )
      )
      .returning();
    if (!updated) throw new NotFoundError('FieldVisit', visitId);
    return updated;
  }

  static async listVisits(
    db: ErpDatabase,
    tenantId: number,
    scope: { canViewAll: boolean; callerId: number },
    filters: {
      repUserId?: number | undefined;
      dateFrom?: Date | undefined;
      dateTo?: Date | undefined;
    }
  ): Promise<CrmFieldVisit[]> {
    const conditions = [eq(crmFieldVisits.tenantId, tenantId)];
    if (!scope.canViewAll) {
      conditions.push(eq(crmFieldVisits.repUserId, scope.callerId));
    } else if (filters.repUserId !== undefined) {
      conditions.push(eq(crmFieldVisits.repUserId, filters.repUserId));
    }
    if (filters.dateFrom) conditions.push(gte(crmFieldVisits.checkInAt, filters.dateFrom));
    if (filters.dateTo) conditions.push(lte(crmFieldVisits.checkInAt, filters.dateTo));

    return db
      .select()
      .from(crmFieldVisits)
      .where(and(...conditions))
      .orderBy(sql`${crmFieldVisits.checkInAt} desc`);
  }

  static async updateRoute(
    db: ErpDatabase,
    tenantId: number,
    routeId: number,
    patch: { status?: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | undefined; version: number }
  ): Promise<CrmVisitRoute> {
    const [updated] = await db
      .update(crmVisitRoutes)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updatedAt: new Date(),
        version: sql`${crmVisitRoutes.version} + 1`,
      })
      .where(
        and(
          eq(crmVisitRoutes.id, routeId),
          eq(crmVisitRoutes.tenantId, tenantId),
          eq(crmVisitRoutes.version, patch.version)
        )
      )
      .returning();
    if (!updated) {
      const [existing] = await db
        .select({ id: crmVisitRoutes.id })
        .from(crmVisitRoutes)
        .where(and(eq(crmVisitRoutes.id, routeId), eq(crmVisitRoutes.tenantId, tenantId)));
      throw existing
        ? new OptimisticLockError('VisitRoute')
        : new NotFoundError('VisitRoute', routeId);
    }
    return updated;
  }
}
