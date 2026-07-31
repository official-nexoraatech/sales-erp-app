import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { crmDltTemplates } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, OptimisticLockError, ValidationError, PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

// CRM-ROADMAP Phase 1, Feature 6 — DLT/TRAI SMS Compliance. Admin-only config CRUD — the
// actual enforcement gate lives in notification-service's NotificationEngine.sendRaw (AR-8:
// "the code's job is to enforce the gate, not to handle the registration process itself").

const DltTemplateSchema = z.object({
  templateId: z.string().min(1).max(50),
  header: z.string().min(1).max(20),
  messagePattern: z.string().min(1).max(2000),
  isActive: z.boolean().default(true),
  expiresAt: z.string().datetime().optional(),
});

const DltTemplateUpdateSchema = DltTemplateSchema.extend({ version: z.number().int().min(0) });

type AuthedRequest = { auth: { tenantId: number; userId: number } };

export async function dltTemplateRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/dlt-templates',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const rows = await ctx.db.raw
        .select()
        .from(crmDltTemplates)
        .where(eq(crmDltTemplates.tenantId, tenantId));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.post(
    '/dlt-templates',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const body = DltTemplateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [created] = await ctx.db.raw
        .insert(crmDltTemplates)
        .values({
          tenantId,
          createdBy: userId,
          templateId: body.data.templateId,
          header: body.data.header,
          messagePattern: body.data.messagePattern,
          isActive: body.data.isActive,
          expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : undefined,
        } as unknown as typeof crmDltTemplates.$inferInsert)
        .returning();
      if (!created) throw new Error('DLT template creation failed unexpectedly');

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_dlt_template',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });

      return reply.code(201).send({ data: created });
    }
  );

  fastify.put<{ Params: { id: string } }>(
    '/dlt-templates/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = DltTemplateUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(crmDltTemplates)
        .where(and(eq(crmDltTemplates.id, id), eq(crmDltTemplates.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('CrmDltTemplate', id);

      const [updated] = await ctx.db.raw
        .update(crmDltTemplates)
        .set({
          templateId: body.data.templateId,
          header: body.data.header,
          messagePattern: body.data.messagePattern,
          isActive: body.data.isActive,
          expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
          updatedAt: new Date(),
          version: existing.version + 1,
        })
        .where(
          and(
            eq(crmDltTemplates.id, id),
            eq(crmDltTemplates.tenantId, tenantId),
            eq(crmDltTemplates.version, body.data.version)
          )
        )
        .returning();
      if (!updated) throw new OptimisticLockError('CrmDltTemplate');

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_dlt_template',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: updated });
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/dlt-templates/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const [existing] = await ctx.db.raw
        .select()
        .from(crmDltTemplates)
        .where(and(eq(crmDltTemplates.id, id), eq(crmDltTemplates.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('CrmDltTemplate', id);

      await ctx.db.raw.delete(crmDltTemplates).where(eq(crmDltTemplates.id, id));
      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'crm_dlt_template',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: { message: 'DLT template deleted', id } });
    }
  );
}
