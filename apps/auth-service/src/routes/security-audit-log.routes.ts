import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, desc, count } from 'drizzle-orm';
import { securityAuditLog } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import { requireAnyPermission } from '../middleware/authorize.js';

const QuerySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().optional(),
});

export async function securityAuditLogRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase
): Promise<void> {
  fastify.get('/admin/security-audit-log', {
    preHandler: [requireAnyPermission([PERMISSIONS.VIEW_AUDIT_LOG, PERMISSIONS.AUDIT_LOG_VIEW])],
    handler: async (request, reply) => {
      const query = QuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'Invalid query' });

      const { page, size, action } = query.data;
      const { tenantId } = request.auth;

      const conditions = action
        ? and(eq(securityAuditLog.tenantId, tenantId), eq(securityAuditLog.action, action as never))
        : eq(securityAuditLog.tenantId, tenantId);

      const [rows, totalRows] = await Promise.all([
        db
          .select()
          .from(securityAuditLog)
          .where(conditions)
          .orderBy(desc(securityAuditLog.createdAt))
          .limit(size)
          .offset(page * size),
        db.select({ total: count() }).from(securityAuditLog).where(conditions),
      ]);

      const totalElements = totalRows[0]?.total ?? 0;
      return reply.code(200).send({ data: { content: rows, page, size, totalElements } });
    },
  });
}
