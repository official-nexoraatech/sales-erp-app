// Public marketing site FAQ content management. Global (no tenant_id) — this is platform
// content, so CRUD is platform-operator-only (PLATFORM_CONTENT_MANAGE), mirroring
// tenant.routes.ts's PLATFORM_ADMIN gating. GET /public/faqs is the one unauthenticated
// route, following the same no-auth-route + gateway-exemption pattern established for
// POST /public/signup.
import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { faqItems } from '@erp/db';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, OptimisticLockError, ValidationError, PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const PLATFORM_CONTENT_ADMIN: [typeof authenticate, ReturnType<typeof requirePermission>] = [
  authenticate,
  requirePermission(PERMISSIONS.PLATFORM_CONTENT_MANAGE),
];

const FaqItemSchema = z.object({
  category: z.string().min(1).max(100),
  question: z.string().min(1).max(2000),
  answer: z.string().min(1).max(10_000),
  sortOrder: z.number().int().default(0),
  isPublished: z.boolean().default(true),
});

type AuthedRequest = { auth: { userId: number } };

export async function faqRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  // ── GET /public/faqs — published FAQs only, no auth required ────────────
  fastify.get('/public/faqs', async (_request, reply) => {
    const rows = await db
      .select()
      .from(faqItems)
      .where(eq(faqItems.isPublished, true))
      .orderBy(asc(faqItems.category), asc(faqItems.sortOrder));
    return reply.code(200).send({ data: { content: rows } });
  });

  // ── GET /admin/platform/faqs — every FAQ, published or not ──────────────
  fastify.get(
    '/admin/platform/faqs',
    { preHandler: PLATFORM_CONTENT_ADMIN },
    async (_request, reply) => {
      const rows = await db
        .select()
        .from(faqItems)
        .orderBy(asc(faqItems.category), asc(faqItems.sortOrder));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // ── POST /admin/platform/faqs — create ───────────────────────────────────
  fastify.post(
    '/admin/platform/faqs',
    { preHandler: PLATFORM_CONTENT_ADMIN },
    async (request, reply) => {
      const { userId } = (request as unknown as AuthedRequest).auth;
      const body = FaqItemSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [created] = await db
        .insert(faqItems)
        .values({ ...body.data, createdBy: userId })
        .returning();
      if (!created) throw new Error('FAQ item creation failed unexpectedly');

      return reply.code(201).send({ data: created });
    }
  );

  // ── PUT /admin/platform/faqs/:id — update (partial) ──────────────────────
  fastify.put<{ Params: { id: string } }>(
    '/admin/platform/faqs/:id',
    { preHandler: PLATFORM_CONTENT_ADMIN },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const body = FaqItemSchema.partial()
        .extend({ version: z.number().int().min(0) })
        .safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await db
        .select({ id: faqItems.id })
        .from(faqItems)
        .where(eq(faqItems.id, id));
      if (!existing) throw new NotFoundError('FAQ item', id);

      const { version, ...patch } = body.data;
      const [updated] = await db
        .update(faqItems)
        .set({ ...patch, version: version + 1, updatedAt: new Date() })
        .where(and(eq(faqItems.id, id), eq(faqItems.version, version)))
        .returning();
      if (!updated) throw new OptimisticLockError('FAQ item');

      return reply.code(200).send({ data: updated });
    }
  );

  // ── DELETE /admin/platform/faqs/:id ───────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/admin/platform/faqs/:id',
    { preHandler: PLATFORM_CONTENT_ADMIN },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const [existing] = await db
        .select({ id: faqItems.id })
        .from(faqItems)
        .where(eq(faqItems.id, id));
      if (!existing) throw new NotFoundError('FAQ item', id);

      await db.delete(faqItems).where(eq(faqItems.id, id));
      return reply.code(204).send();
    }
  );
}
