import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { ApiKeyService, PUBLIC_API_SCOPES } from '../domain/ApiKeyService.js';

// CRM-ROADMAP Phase 4, Feature 8 — Public CRM API & BI/Data-Warehouse Export. Staff-side
// management of API keys, gated by API_KEY_MANAGE (OWNER/ADMIN/SUPER_ADMIN only — see
// permissions.ts's comment on why this isn't granted to SALES_MANAGER like most other CRM
// permissions this roadmap has added).

const ApiKeyCreateSchema = z.object({
  name: z.string().min(2).max(200),
  scopes: z.array(z.enum(PUBLIC_API_SCOPES)).min(1),
  expiresAt: z.string().datetime().optional(),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O — ApiKeyService has no
// fetch() calls. Post-hoc ctx.audit.log() calls are safe per caveat 4b.
export async function apiKeyRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/api-keys',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.API_KEY_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const rows = await ApiKeyService.list(ctx.db.raw, ctx.tenant.tenantId);
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.post(
    '/api-keys',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.API_KEY_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = ApiKeyCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const { apiKey, plaintextKey } = await ApiKeyService.create(
        ctx.db.raw,
        ctx.tenant.tenantId,
        ctx.tenant.userId,
        {
          name: body.data.name,
          scopes: body.data.scopes,
          ...(body.data.expiresAt ? { expiresAt: new Date(body.data.expiresAt) } : {}),
        }
      );

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_api_key',
        entityId: apiKey.id,
        after: apiKey as unknown as Record<string, unknown>,
      });

      // The only point in this key's lifetime the raw value is ever available — never stored,
      // never logged, never retrievable again after this response.
      return reply.code(201).send({ data: { ...apiKey, plaintextKey } });
    })
  );

  fastify.delete(
    '/api-keys/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.API_KEY_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);

      await ApiKeyService.revoke(ctx.db.raw, ctx.tenant.tenantId, ctx.tenant.userId, id);

      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'crm_api_key',
        entityId: id,
        after: { revoked: true },
      });
      return reply.code(200).send({ data: { message: 'API key revoked' } });
    })
  );
}
