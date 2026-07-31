// Lead capture from the public marketing site — POST /public/demo-requests is fed by two
// entry points (landing-page Hero "Book a Demo" form and the /contact "Talk to Sales" form,
// distinguished by `source`), no auth required, following the same no-auth-route +
// gateway-exemption pattern established for POST /public/signup. GET /admin/demo-requests
// reuses the PLATFORM_ADMIN gate tenant.routes.ts already defines for cross-tenant platform
// data, rather than introducing a new permission constant that would need its own
// role-seeding migration.
import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { demoRequests } from '@erp/db';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { ValidationError, PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import type { TenantServiceConfig } from '../config.js';

const PLATFORM_ADMIN: [typeof authenticate, ReturnType<typeof requirePermission>] = [
  authenticate,
  requirePermission(PERMISSIONS.PLATFORM_TENANT_MANAGE),
];

const DemoRequestSchema = z.object({
  fullName: z.string().min(1).max(200),
  email: z.string().email(),
  countryCode: z.string().max(5).optional(),
  phone: z.string().max(20).optional(),
  company: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  designation: z.string().max(100).optional(),
  productType: z.enum(['RETAIL', 'DISTRIBUTION', 'MANUFACTURING', 'OTHER']).optional(),
  message: z.string().max(2000).optional(),
  source: z.enum(['HERO_FORM', 'CONTACT_PAGE']),
});

export async function demoRequestRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: TenantServiceConfig
): Promise<void> {
  // ── POST /public/demo-requests — no auth required ────────────────────────
  fastify.post(
    '/public/demo-requests',
    {
      config: {
        rateLimit: {
          max: config.demoRequestRateLimitMax,
          timeWindow: config.demoRequestRateLimitWindowMs,
        },
      },
    },
    async (request, reply) => {
      const body = DemoRequestSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [created] = await db.insert(demoRequests).values(body.data).returning();
      if (!created) throw new Error('Demo request creation failed unexpectedly');

      return reply.code(201).send({ data: { id: created.id } });
    }
  );

  // ── GET /admin/demo-requests — every submitted request, newest first ─────
  fastify.get('/admin/demo-requests', { preHandler: PLATFORM_ADMIN }, async (_request, reply) => {
    const rows = await db.select().from(demoRequests).orderBy(desc(demoRequests.createdAt));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });
}
