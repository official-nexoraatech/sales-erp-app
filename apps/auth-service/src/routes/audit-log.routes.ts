import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, gte, lte, desc, count } from 'drizzle-orm';
import { auditLog } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import { requirePermission } from '../middleware/authorize.js';

const QuerySchema = z.object({
  entity: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function auditLogRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  fastify.get('/admin/audit-logs', {
    preHandler: [requirePermission(PERMISSIONS.VIEW_AUDIT_LOG)],
    handler: async (request, reply) => {
      const query = QuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'Invalid query' });

      const { entity, from, to, page, limit } = query.data;
      const { tenantId } = request.auth;

      const conditions = [eq(auditLog.tenantId, tenantId)];
      if (entity) conditions.push(eq(auditLog.entityType, entity));
      if (from) conditions.push(gte(auditLog.createdAt, new Date(from)));
      if (to) conditions.push(lte(auditLog.createdAt, new Date(to)));

      const where = and(...conditions);

      const [rows, totalRows] = await Promise.all([
        db
          .select()
          .from(auditLog)
          .where(where)
          .orderBy(desc(auditLog.createdAt))
          .limit(limit)
          .offset((page - 1) * limit),
        db.select({ total: count() }).from(auditLog).where(where),
      ]);

      const totalElements = totalRows[0]?.total ?? 0;
      return reply.code(200).send({ data: { content: rows, page, limit, totalElements } });
    },
  });
}
