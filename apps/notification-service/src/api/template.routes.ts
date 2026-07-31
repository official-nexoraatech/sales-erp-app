import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { notificationTemplates } from '@erp/db';
import { eq, and, desc } from 'drizzle-orm';
import Handlebars from 'handlebars';
import { z } from 'zod';
import { ValidationError, PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

// Notification-service audit 2026-07-23: templates could previously only be created via 4
// hardcoded internal seed routes (seed-crm/seed-hr/seed-auth/seed-tenant) or a direct DB insert
// — there was no tenant-facing template management surface at all, despite NOTIFICATION_CONFIG
// existing as a permission constant apparently meant to gate exactly this. This file wires it up.
// isSystem templates (password reset, welcome email, etc. — seeded by the internal routes) are
// deliberately not editable/deletable here, since a tenant admin mistake would break those
// critical flows platform-wide, not just this tenant's own custom templates.

type AuthedRequest = { auth: { tenantId: number; userId?: number } };

const ChannelEnum = z.enum(['SMS', 'EMAIL', 'WHATSAPP', 'IN_APP']);

const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  eventType: z.string().min(1).max(100),
  channel: ChannelEnum,
  subject: z.string().max(500).optional(),
  bodyTemplate: z.string().min(1),
});

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().max(500).optional(),
  bodyTemplate: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

const PreviewSchema = z.object({
  bodyTemplate: z.string().min(1),
  subject: z.string().optional(),
  sampleData: z.record(z.unknown()).default({}),
});

export async function templateRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  const guard = [authenticate, requirePermission(PERMISSIONS.NOTIFICATION_CONFIG)];

  // ── GET /notifications/templates — List this tenant's templates ──────────
  fastify.get('/notifications/templates', { preHandler: guard }, async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const rows = await db
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.tenantId, tenantId))
      .orderBy(desc(notificationTemplates.createdAt));
    return reply.code(200).send({ data: { content: rows } });
  });

  // ── GET /notifications/templates/:id ──────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/notifications/templates/:id',
    { preHandler: guard },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const [row] = await db
        .select()
        .from(notificationTemplates)
        .where(and(eq(notificationTemplates.id, id), eq(notificationTemplates.tenantId, tenantId)));
      if (!row) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Template not found' } });
      }
      return reply.code(200).send({ data: row });
    }
  );

  // ── POST /notifications/templates — Create a tenant-custom template ──────
  fastify.post('/notifications/templates', { preHandler: guard }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const body = CreateTemplateSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    }

    const [existing] = await db
      .select({ id: notificationTemplates.id })
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.tenantId, tenantId),
          eq(notificationTemplates.eventType, body.data.eventType),
          eq(notificationTemplates.channel, body.data.channel)
        )
      );
    if (existing) {
      return reply.code(409).send({
        error: {
          code: 'DUPLICATE_TEMPLATE',
          message: `A ${body.data.channel} template for event type "${body.data.eventType}" already exists — edit it instead of creating a duplicate.`,
        },
      });
    }

    const [created] = await db
      .insert(notificationTemplates)
      .values({
        tenantId,
        createdBy: userId ?? 0,
        name: body.data.name,
        eventType: body.data.eventType,
        channel: body.data.channel,
        subject: body.data.subject,
        bodyTemplate: body.data.bodyTemplate,
        isSystem: false,
      })
      .returning();

    return reply.code(201).send({ data: created });
  });

  // ── PUT /notifications/templates/:id — Edit a tenant-custom template ─────
  fastify.put<{ Params: { id: string } }>(
    '/notifications/templates/:id',
    { preHandler: guard },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);
      const body = UpdateTemplateSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [existing] = await db
        .select()
        .from(notificationTemplates)
        .where(and(eq(notificationTemplates.id, id), eq(notificationTemplates.tenantId, tenantId)));
      if (!existing) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Template not found' } });
      }
      if (existing.isSystem) {
        return reply.code(400).send({
          error: {
            code: 'SYSTEM_TEMPLATE_LOCKED',
            message:
              'System templates (password reset, welcome email, etc.) cannot be edited here — they are relied on by critical platform flows.',
          },
        });
      }

      await db
        .update(notificationTemplates)
        .set({
          ...(body.data.name !== undefined ? { name: body.data.name } : {}),
          ...(body.data.subject !== undefined ? { subject: body.data.subject } : {}),
          ...(body.data.bodyTemplate !== undefined ? { bodyTemplate: body.data.bodyTemplate } : {}),
          ...(body.data.isActive !== undefined ? { isActive: body.data.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(eq(notificationTemplates.id, id));

      return reply.code(200).send({ data: { message: 'Template updated' } });
    }
  );

  // ── DELETE /notifications/templates/:id — Remove a tenant-custom template ─
  fastify.delete<{ Params: { id: string } }>(
    '/notifications/templates/:id',
    { preHandler: guard },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);

      const [existing] = await db
        .select()
        .from(notificationTemplates)
        .where(and(eq(notificationTemplates.id, id), eq(notificationTemplates.tenantId, tenantId)));
      if (!existing) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Template not found' } });
      }
      if (existing.isSystem) {
        return reply.code(400).send({
          error: { code: 'SYSTEM_TEMPLATE_LOCKED', message: 'System templates cannot be deleted.' },
        });
      }

      await db.delete(notificationTemplates).where(eq(notificationTemplates.id, id));
      return reply.code(200).send({ data: { message: 'Template deleted' } });
    }
  );

  // ── POST /notifications/templates/preview — Render with sample data ──────
  // No persistence — lets an admin see the rendered output before saving.
  fastify.post(
    '/notifications/templates/preview',
    { preHandler: guard },
    async (request, reply) => {
      const body = PreviewSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      try {
        const renderedBody = Handlebars.compile(body.data.bodyTemplate)(body.data.sampleData);
        const renderedSubject = body.data.subject
          ? Handlebars.compile(body.data.subject)(body.data.sampleData)
          : undefined;
        return reply.code(200).send({ data: { renderedBody, renderedSubject } });
      } catch (err) {
        throw new ValidationError(
          `Template failed to render: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  );
}
