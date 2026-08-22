import { and, eq, isNull, asc } from 'drizzle-orm';
import { routings, routingOperations, items, workCenters, productionOrders } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { BusinessError, NotFoundError } from '@erp/types';

export interface RoutingOperationInput {
  sequenceNo: number;
  operationName: string;
  workCenterId?: number | undefined;
  standardTimeMinutes?: number | undefined;
}

export interface CreateRoutingParams {
  tenantId: number;
  name: string;
  finishedItemId: number;
  finishedVariantId?: number | undefined;
  operations: RoutingOperationInput[];
  createdBy: number;
}

// Manufacturing vertical — Routing: multi-step operation sequences (Cut -> Stitch -> Finish),
// each step optionally assigned to a Work Center. Deliberately mirrors BOMService's CRUD shape
// (versioned by isActive-flag deactivation of the prior routing for the same finished item, same
// convention as BOM/branches/itemVariants elsewhere in this codebase) — a routing describes HOW
// an item is produced, independent of BOM's WHAT.
export class RoutingService {
  constructor(private db: ErpDatabase) {}

  async create(params: CreateRoutingParams): Promise<number> {
    if (params.operations.length === 0) {
      throw new BusinessError('ROUTING_EMPTY', 'A routing must have at least one operation');
    }
    const sequences = params.operations.map((o) => o.sequenceNo);
    if (new Set(sequences).size !== sequences.length) {
      throw new BusinessError(
        'ROUTING_DUPLICATE_SEQUENCE',
        'Operation sequence numbers must be unique within a routing'
      );
    }

    return this.db.transaction(async (trx) => {
      const [finishedItem] = await trx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.id, params.finishedItemId), eq(items.tenantId, params.tenantId)));
      if (!finishedItem) throw new NotFoundError('Item', params.finishedItemId);

      for (const op of params.operations) {
        if (op.workCenterId !== undefined) {
          const [wc] = await trx
            .select({ id: workCenters.id })
            .from(workCenters)
            .where(
              and(eq(workCenters.id, op.workCenterId), eq(workCenters.tenantId, params.tenantId))
            );
          if (!wc) throw new NotFoundError('WorkCenter', op.workCenterId);
        }
      }

      // Only one active routing per (tenant, finished item, variant) at a time — same convention
      // as BOMService.create()'s deactivation guard.
      await trx
        .update(routings)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(routings.tenantId, params.tenantId),
            eq(routings.finishedItemId, params.finishedItemId),
            params.finishedVariantId !== undefined
              ? eq(routings.finishedVariantId, params.finishedVariantId)
              : isNull(routings.finishedVariantId)
          )
        );

      const [row] = await trx
        .insert(routings)
        .values({
          tenantId: params.tenantId,
          name: params.name,
          finishedItemId: params.finishedItemId,
          finishedVariantId: params.finishedVariantId,
          isActive: true,
          createdBy: params.createdBy,
        })
        .returning({ id: routings.id });

      if (!row) throw new BusinessError('ROUTING_CREATE_FAILED', 'Failed to create routing');
      const routingId = row.id;

      await trx.insert(routingOperations).values(
        params.operations.map((o) => ({
          routingId,
          tenantId: params.tenantId,
          sequenceNo: o.sequenceNo,
          operationName: o.operationName,
          workCenterId: o.workCenterId,
          standardTimeMinutes: String(o.standardTimeMinutes ?? 0),
        }))
      );

      return routingId;
    });
  }

  async getById(
    id: number,
    tenantId: number
  ): Promise<{
    routing: typeof routings.$inferSelect;
    operations: (typeof routingOperations.$inferSelect)[];
  } | null> {
    const [routing] = await this.db
      .select()
      .from(routings)
      .where(and(eq(routings.id, id), eq(routings.tenantId, tenantId)));
    if (!routing) return null;
    const operations = await this.db
      .select()
      .from(routingOperations)
      .where(eq(routingOperations.routingId, id))
      .orderBy(asc(routingOperations.sequenceNo));
    return { routing, operations };
  }

  async listForItem(itemId: number, tenantId: number): Promise<(typeof routings.$inferSelect)[]> {
    return this.db
      .select()
      .from(routings)
      .where(and(eq(routings.tenantId, tenantId), eq(routings.finishedItemId, itemId)));
  }

  // Hard delete, deliberately restricted to non-active routings — the active one is what live
  // Production Order creation reads (see ProductionOrderService.create()'s routingId handling),
  // so deleting it out from under that would silently break the next order for this finished
  // item. No PERMISSIONS.ROUTING_UPDATE exists (versioning happens via create() instead), so a
  // caller who wants a routing "gone" replaces it with a new create() call, then deletes the
  // now-inactive old one via this method once nothing references it historically.
  async delete(id: number, tenantId: number): Promise<void> {
    const [routing] = await this.db
      .select({ isActive: routings.isActive })
      .from(routings)
      .where(and(eq(routings.id, id), eq(routings.tenantId, tenantId)));
    if (!routing) throw new NotFoundError('Routing', id);
    if (routing.isActive) {
      throw new BusinessError(
        'ROUTING_ACTIVE',
        'Cannot delete the active routing for a finished item — create a replacement first, which deactivates this one'
      );
    }

    const [referencingOrder] = await this.db
      .select({ id: productionOrders.id })
      .from(productionOrders)
      .where(and(eq(productionOrders.tenantId, tenantId), eq(productionOrders.routingId, id)))
      .limit(1);
    if (referencingOrder) {
      throw new BusinessError(
        'ROUTING_IN_USE',
        `Cannot delete routing ${id} — at least one production order (e.g. #${referencingOrder.id}) still references it`
      );
    }

    await this.db.transaction(async (trx) => {
      await trx.delete(routingOperations).where(eq(routingOperations.routingId, id));
      await trx.delete(routings).where(and(eq(routings.id, id), eq(routings.tenantId, tenantId)));
    });
  }
}
