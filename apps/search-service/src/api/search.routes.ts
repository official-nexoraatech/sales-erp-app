import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { searchAnalytics } from '@erp/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { PERMISSIONS, type Permission } from '@erp/types';
import { getBranchScope } from '@erp/sdk';
import { z } from 'zod';
import type { SearchEngine, SearchEntity } from '../domain/SearchEngine.js';
import { ALL_SEARCH_ENTITIES, BRANCH_SCOPED_ENTITIES } from '../domain/SearchEngine.js';
import { authenticate } from '../middleware/authenticate.js';

type AuthedRequest = {
  auth: { tenantId: number; userId?: number; permissions: string[]; branchIds: number[] };
};

function hasPermission(request: unknown, perm: string): boolean {
  return ((request as AuthedRequest).auth?.permissions ?? []).includes(perm);
}

const VALID_ENTITIES: SearchEntity[] = ALL_SEARCH_ENTITIES;

// Per-entity permission required to see that entity's results at all. Checked both when a
// specific `entity` is requested (403 if missing) and to filter which entities are included
// in an untyped global search (silently omitted, per "a user should never discover records
// they cannot access").
const ENTITY_PERMISSION: Record<SearchEntity, Permission> = {
  customer: PERMISSIONS.CUSTOMER_VIEW,
  supplier: PERMISSIONS.SUPPLIER_VIEW,
  item: PERMISSIONS.ITEM_VIEW,
  invoice: PERMISSIONS.INVOICE_VIEW,
  purchase_order: PERMISSIONS.PO_VIEW,
  stock: PERMISSIONS.STOCK_VIEW,
  employee: PERMISSIONS.EMPLOYEE_VIEW,
  quotation: PERMISSIONS.QUOTATION_VIEW,
  crm_interaction: PERMISSIONS.CRM_INTERACTION_VIEW,
  crm_segment: PERMISSIONS.CRM_SEGMENT_VIEW,
  crm_campaign: PERMISSIONS.CRM_VIEW,
  category: PERMISSIONS.CATEGORY_VIEW,
  brand: PERMISSIONS.BRAND_VIEW,
  unit: PERMISSIONS.UNIT_VIEW,
  warehouse: PERMISSIONS.WAREHOUSE_VIEW,
  stock_transfer: PERMISSIONS.STOCK_TRANSFER_VIEW,
  stock_adjustment: PERMISSIONS.STOCK_ADJUSTMENT_VIEW,
  grn: PERMISSIONS.GRN_VIEW,
  purchase_return: PERMISSIONS.PURCHASE_RETURN_VIEW,
  account: PERMISSIONS.ACCOUNT_VIEW,
  journal_entry: PERMISSIONS.JOURNAL_VIEW,
  payment: PERMISSIONS.PAYMENT_VIEW,
  attendance: PERMISSIONS.ATTENDANCE_VIEW,
  payroll_run: PERMISSIONS.PAYROLL_VIEW,
  leave_application: PERMISSIONS.LEAVE_VIEW,
  user: PERMISSIONS.USER_VIEW,
  role: PERMISSIONS.ROLE_VIEW,
  branch: PERMISSIONS.BRANCH_VIEW,
  organization: PERMISSIONS.ORGANIZATION_VIEW,
  // Attachments don't have one fixed permission — a single attachment's visibility depends
  // on which parent record type it belongs to (see ATTACHMENT_PARENT_PERMISSION below, which
  // does the real per-document filtering off the ES `entityType` field). This entry is only
  // used as the baseline "search access at all" gate for untyped/global search filtering
  // below; it's intentionally SEARCH_GLOBAL, not a stand-in for actual attachment visibility.
  attachment: PERMISSIONS.SEARCH_GLOBAL,
};

// Real per-document attachment visibility: a document's `entityType` field (INVOICE /
// PURCHASE_ORDER / GRN — see attachment.routes.ts in sales-service/purchase-service) decides
// which permission actually gates it, mirroring each service's real attachment-route gate —
// not an idealized one. GRN now maps to its own GRN_VIEW (fixed alongside GRN_UPDATE being
// added): purchase-service's attachment.routes.ts previously gated GET/download for both
// PURCHASE_ORDER and GRN attachments on PO_VIEW alone; it now checks GRN_VIEW for GRN
// attachments specifically, so this mapping was updated to match.
const ATTACHMENT_PARENT_PERMISSION: Record<string, Permission> = {
  INVOICE: PERMISSIONS.INVOICE_VIEW,
  PURCHASE_ORDER: PERMISSIONS.PO_VIEW,
  GRN: PERMISSIONS.GRN_VIEW,
};
const ALL_ATTACHMENT_PARENT_TYPES = Object.keys(ATTACHMENT_PARENT_PERMISSION);

function allowedAttachmentParentTypes(request: unknown): string[] {
  return ALL_ATTACHMENT_PARENT_TYPES.filter((t) =>
    hasPermission(request, ATTACHMENT_PARENT_PERMISSION[t]!)
  );
}

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  entity: z.enum(VALID_ENTITIES as [SearchEntity, ...SearchEntity[]]).optional(),
  size: z.coerce.number().int().min(1).max(100).optional(),
  from: z.coerce.number().int().min(0).optional(),
  fuzziness: z.enum(['AUTO', '0', '1', '2']).optional(),
  // Advanced search (Phase 6) — a fixed, known set of filterable fields rather than an
  // arbitrary key/value map, so a caller can't probe unmapped ES fields.
  status: z.string().max(50).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  dateField: z.string().max(50).optional(),
  dateFrom: z.string().max(30).optional(),
  dateTo: z.string().max(30).optional(),
});

// `db` is optional so existing tests (and any other caller that only cares about search
// itself) can keep calling searchRoutes(app, engine) — analytics logging (Phase 8) is a
// best-effort side capability, not core to search working, and is skipped entirely if no db
// is supplied rather than becoming a required dependency of this route module.
export async function searchRoutes(
  fastify: FastifyInstance,
  engine: SearchEngine,
  db?: ErpDatabase
): Promise<void> {
  // ── GET /search — Global fuzzy search ────────────────────────────────────
  fastify.get('/search', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_GLOBAL)) {
      return reply.code(403).send({
        error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_GLOBAL' },
      });
    }

    const auth = (request as unknown as AuthedRequest).auth;
    const { tenantId } = auth;
    const params = SearchQuerySchema.parse(request.query);

    if (params.entity === 'attachment') {
      if (allowedAttachmentParentTypes(request).length === 0) {
        return reply.code(403).send({
          error: {
            code: 'PERMISSION_DENIED',
            message: 'Missing permission: INVOICE_VIEW, PO_VIEW, or GRN_VIEW',
          },
        });
      }
    } else if (
      params.entity !== undefined &&
      !hasPermission(request, ENTITY_PERMISSION[params.entity])
    ) {
      return reply.code(403).send({
        error: {
          code: 'PERMISSION_DENIED',
          message: `Missing permission: ${ENTITY_PERMISSION[params.entity]}`,
        },
      });
    }

    const branchScope = getBranchScope(auth);
    const branchIds = branchScope === 'all' ? undefined : branchScope;

    // Untyped (no `entity`) search is restricted to entities the caller can view. Branch-
    // scoped entities are additionally excluded here when the caller is branch-restricted —
    // see BRANCH_SCOPED_ENTITIES / SearchOptions.branchIds for why a multi-index query can't
    // cheaply apply a branch filter only to the indices that have one. Request a specific
    // `entity` to search a branch-scoped entity directly, where the filter is applied exactly.
    // `attachment` gets the same treatment for the same reason: a per-document `entityType`
    // filter can't be safely mixed into a multi-index query, so it's only included here when
    // the caller can see every parent type outright — a caller with partial attachment
    // visibility must search `entity=attachment` directly to get the properly filtered subset.
    const allowedEntities =
      params.entity === undefined
        ? VALID_ENTITIES.filter((e) => {
            if (e === 'attachment')
              return (
                allowedAttachmentParentTypes(request).length === ALL_ATTACHMENT_PARENT_TYPES.length
              );
            if (!hasPermission(request, ENTITY_PERMISSION[e])) return false;
            if (branchIds !== undefined && BRANCH_SCOPED_ENTITIES.has(e)) return false;
            return true;
          })
        : undefined;

    // Advanced-search filters (Phase 6) — exact-match fields folded into `filters`, plus a
    // separate date-range clause since `filters` can only express equality.
    const filters: Record<string, unknown> = {};
    if (params.status !== undefined) filters['status'] = params.status;
    if (params.branchId !== undefined) filters['branchId'] = String(params.branchId);
    if (params.warehouseId !== undefined) filters['warehouseId'] = String(params.warehouseId);
    if (params.customerId !== undefined) filters['customerId'] = params.customerId;
    if (params.supplierId !== undefined) filters['supplierId'] = params.supplierId;

    // Smart Search ranking boost: documents this tenant's users have previously clicked on
    // for this exact query text, sourced from search_analytics (already populated by the
    // click-tracking below and in search-analytics.routes.ts). Best-effort — a lookup
    // failure never blocks the actual search.
    let boostedIds: string[] | undefined;
    if (db) {
      try {
        const clicked = await db
          .selectDistinct({ id: searchAnalytics.clickedResultId })
          .from(searchAnalytics)
          .where(
            and(
              eq(searchAnalytics.tenantId, tenantId),
              eq(searchAnalytics.query, params.q),
              isNotNull(searchAnalytics.clickedResultId)
            )
          )
          .limit(20);
        const ids = clicked.map((c) => c.id).filter((id): id is string => id !== null);
        if (ids.length > 0) boostedIds = ids;
      } catch {
        // best-effort — fall through with no boost
      }
    }

    const result = await engine.search(tenantId, params.q, {
      ...(params.entity !== undefined ? { entity: params.entity } : {}),
      ...(allowedEntities !== undefined ? { entities: allowedEntities } : {}),
      ...(params.entity !== undefined &&
      branchIds !== undefined &&
      BRANCH_SCOPED_ENTITIES.has(params.entity)
        ? { branchIds }
        : {}),
      ...(params.entity === 'attachment'
        ? { attachmentEntityTypes: allowedAttachmentParentTypes(request) }
        : {}),
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
      ...(params.dateField && (params.dateFrom || params.dateTo)
        ? {
            dateRange: {
              field: params.dateField,
              ...(params.dateFrom ? { from: params.dateFrom } : {}),
              ...(params.dateTo ? { to: params.dateTo } : {}),
            },
          }
        : {}),
      ...(boostedIds ? { boostedIds } : {}),
      size: params.size ?? 20,
      from: params.from ?? 0,
      fuzziness: params.fuzziness ?? 'AUTO',
    });

    // Fire-and-forget analytics logging (Phase 8) — never let a logging failure affect the
    // actual search response, and don't make the caller wait on it either.
    if (db) {
      void db
        .insert(searchAnalytics)
        .values({
          tenantId,
          userId: auth.userId ?? 0,
          query: params.q,
          entity: params.entity,
          resultCount: result.total,
          latencyMs: result.took,
        })
        .catch(() => {});
    }

    return reply.code(200).send({
      data: {
        hits: result.hits,
        total: result.total,
        took: result.took,
        query: params.q,
      },
    });
  });

  // ── POST /admin/search/reindex/:entity — full delete-and-recreate reindex ──
  // Called by scheduler-service's `search.full-reindex` job (Phase 4), which has already
  // paged the owning service's internal listing endpoint for every row and sends the
  // complete document set for this tenant+entity in the body.
  fastify.post<{
    Params: { entity: string };
    Body: { documents?: Array<{ id: string; doc: Record<string, unknown> }> };
  }>('/admin/search/reindex/:entity', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
      return reply.code(403).send({
        error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' },
      });
    }

    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const entity = request.params.entity as SearchEntity;

    if (!VALID_ENTITIES.includes(entity)) {
      return reply
        .code(422)
        .send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
    }

    const documents = request.body?.documents ?? [];
    const result = await engine.fullReindex(tenantId, entity, async () => documents);

    return reply.code(200).send({
      data: { message: 'Reindex complete', tenantId, entity, ...result },
    });
  });

  // ── POST /admin/search/bulk-index — upsert without dropping the index first ──
  // Called by scheduler-service's `search.incremental-sync` job (Phase 4) as a catch-up
  // reconciliation pass, and reusable by any future backfill caller that already has the
  // records in hand.
  fastify.post<{
    Body: { entity: SearchEntity; documents: Array<{ id: string; doc: Record<string, unknown> }> };
  }>('/admin/search/bulk-index', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
      return reply.code(403).send({
        error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' },
      });
    }

    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const { entity, documents } = request.body;

    if (!VALID_ENTITIES.includes(entity)) {
      return reply
        .code(422)
        .send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
    }

    const result = await engine.bulkIndex(tenantId, entity, documents ?? []);
    return reply
      .code(200)
      .send({ data: { message: 'Bulk index complete', tenantId, entity, ...result } });
  });

  // ── POST /admin/search/indices — Create all indices for caller's tenant ──
  fastify.post('/admin/search/indices', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
      return reply.code(403).send({
        error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' },
      });
    }

    const { tenantId } = (request as unknown as AuthedRequest).auth;
    await engine.createTenantIndices(tenantId);
    return reply.code(201).send({ data: { message: 'Indices created', tenantId } });
  });

  // ── DELETE /admin/search/indices — Remove all indices for caller's tenant ─
  fastify.delete(
    '/admin/search/indices',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
        return reply.code(403).send({
          error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' },
        });
      }

      const { tenantId } = (request as unknown as AuthedRequest).auth;
      await engine.deleteTenantIndices(tenantId);
      return reply.code(200).send({ data: { message: 'Tenant indices deleted', tenantId } });
    }
  );

  // ── GET /admin/search/stats/:entity — Stats for caller's tenant ──────────
  fastify.get<{ Params: { entity: string } }>(
    '/admin/search/stats/:entity',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
        return reply.code(403).send({
          error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' },
        });
      }

      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const entity = request.params.entity as SearchEntity;
      if (!VALID_ENTITIES.includes(entity)) {
        return reply
          .code(422)
          .send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
      }

      const stats = await engine.getIndexStats(tenantId, entity);
      return reply.code(200).send({ data: stats });
    }
  );

  // ── POST /search/index — Index single document (called internally) ────────
  fastify.post<{
    Body: { entity: SearchEntity; id: string; document: Record<string, unknown> };
  }>('/search/index', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
      return reply.code(403).send({
        error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' },
      });
    }

    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const { entity, id, document } = request.body;

    if (!VALID_ENTITIES.includes(entity)) {
      return reply
        .code(422)
        .send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
    }

    await engine.index(tenantId, entity, id, document);
    return reply.code(200).send({ data: { message: 'Document indexed' } });
  });

  // ── DELETE /search/index/:entity/:id — Delete document from index ────────
  fastify.delete<{ Params: { entity: string; id: string } }>(
    '/search/index/:entity/:id',
    { preHandler: [authenticate] },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.SEARCH_REINDEX)) {
        return reply.code(403).send({
          error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_REINDEX' },
        });
      }

      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const entity = request.params.entity as SearchEntity;
      if (!VALID_ENTITIES.includes(entity)) {
        return reply
          .code(422)
          .send({ error: { code: 'INVALID_ENTITY', message: `Unknown entity: ${entity}` } });
      }

      await engine.delete(tenantId, entity, request.params.id);
      return reply.code(200).send({ data: { message: 'Document removed from index' } });
    }
  );
}
