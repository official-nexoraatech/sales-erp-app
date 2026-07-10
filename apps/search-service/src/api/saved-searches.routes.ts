import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { savedSearches } from '@erp/db';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { PERMISSIONS, NotFoundError, ValidationError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';

type AuthedRequest = { auth: { tenantId: number; userId: number; permissions: string[] } };

function hasPermission(request: unknown, perm: string): boolean {
  return ((request as AuthedRequest).auth?.permissions ?? []).includes(perm);
}

const CreateSavedSearchSchema = z.object({
  name: z.string().min(1).max(100),
  query: z.string().min(1).max(200),
  entity: z.string().max(50).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

// User-scoped, so JWT-authenticated like /search — unlike search-sync.internal.routes.ts
// (internal-key-gated, for scheduler-service) this always acts as the calling user, never
// on behalf of an arbitrary tenantId supplied by the caller.
export async function savedSearchesRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  fastify.get('/saved-searches', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_GLOBAL)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_GLOBAL' } });
    }
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;

    const rows = await db
      .select()
      .from(savedSearches)
      .where(and(eq(savedSearches.tenantId, tenantId), eq(savedSearches.userId, userId)))
      .orderBy(desc(savedSearches.createdAt));

    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.post('/saved-searches', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_GLOBAL)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_GLOBAL' } });
    }
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;

    const body = CreateSavedSearchSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [created] = await db
      .insert(savedSearches)
      .values({
        tenantId,
        userId,
        name: body.data.name,
        query: body.data.query,
        entity: body.data.entity,
        filters: body.data.filters ?? {},
      })
      .returning();

    return reply.code(201).send({ data: created });
  });

  fastify.delete<{ Params: { id: string } }>('/saved-searches/:id', { preHandler: [authenticate] }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.SEARCH_GLOBAL)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: SEARCH_GLOBAL' } });
    }
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const id = parseInt(request.params.id, 10);

    const [existing] = await db
      .select()
      .from(savedSearches)
      .where(and(eq(savedSearches.id, id), eq(savedSearches.tenantId, tenantId), eq(savedSearches.userId, userId)));
    if (!existing) throw new NotFoundError('Saved search', id);

    await db.delete(savedSearches).where(eq(savedSearches.id, id));
    return reply.code(200).send({ data: { message: 'Saved search deleted', id } });
  });
}
