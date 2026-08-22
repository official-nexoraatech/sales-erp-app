import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler } from '@erp/sdk';
import { crmDltTemplates } from '@erp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, OptimisticLockError, ValidationError, PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

// CRM-ROADMAP Phase 1, Feature 6 — DLT/TRAI SMS Compliance. Admin-only config CRUD — the
// actual enforcement gate lives in notification-service's NotificationEngine.sendRaw (AR-8:
// "the code's job is to enforce the gate, not to handle the registration process itself").
//
// CRM/O2C split pilot migration — moved from sales-service to crm-service (self-contained,
// touches only its own crm_dlt_templates table; notification-service's read of that table is
// direct-DB, unaffected by which service owns the CRUD routes).
//
// Phase 9 GUC-per-request rollout — migrated 2026-08-21. No external I/O. Post-hoc
// ctx.audit.log() calls are safe per caveat 4b.

const DltTemplateSchema = z.object({
  templateId: z.string().min(1).max(50),
  header: z.string().min(1).max(20),
  messagePattern: z.string().min(1).max(2000),
  isActive: z.boolean().default(true),
  expiresAt: z.string().datetime().optional(),
});

const DltTemplateUpdateSchema = DltTemplateSchema.extend({ version: z.number().int().min(0) });

export async function dltTemplateRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get(
    '/dlt-templates',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const rows = await ctx.db.raw
        .select()
        .from(crmDltTemplates)
        .where(eq(crmDltTemplates.tenantId, ctx.tenant.tenantId));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    })
  );

  fastify.post(
    '/dlt-templates',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const body = DltTemplateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [created] = await ctx.db.raw
        .insert(crmDltTemplates)
        .values({
          tenantId: ctx.tenant.tenantId,
          createdBy: ctx.tenant.userId,
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
    })
  );

  fastify.put(
    '/dlt-templates/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const body = DltTemplateUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(crmDltTemplates)
        .where(and(eq(crmDltTemplates.id, id), eq(crmDltTemplates.tenantId, ctx.tenant.tenantId)));
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
            eq(crmDltTemplates.tenantId, ctx.tenant.tenantId),
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
    })
  );

  fastify.delete(
    '/dlt-templates/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.CRM_DLT_TEMPLATE_MANAGE)] },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { id: idParam } = request.params as { id: string };
      const id = parseInt(idParam, 10);
      const [existing] = await ctx.db.raw
        .select()
        .from(crmDltTemplates)
        .where(and(eq(crmDltTemplates.id, id), eq(crmDltTemplates.tenantId, ctx.tenant.tenantId)));
      if (!existing) throw new NotFoundError('CrmDltTemplate', id);

      await ctx.db.raw.delete(crmDltTemplates).where(eq(crmDltTemplates.id, id));
      await ctx.audit.log({
        action: 'DELETE',
        entityType: 'crm_dlt_template',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: { message: 'DLT template deleted', id } });
    })
  );
}
