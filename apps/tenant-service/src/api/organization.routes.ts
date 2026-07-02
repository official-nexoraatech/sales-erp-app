import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { organizationSettings } from '@erp/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

const UpdateOrgSchema = z.object({
  orgName: z.string().min(2).max(200),
  legalName: z.string().max(300).optional(),
  gstin: z
    .string()
    .regex(GSTIN_REGEX, 'Invalid GSTIN format (e.g. 27AAPFU0939F1ZV)')
    .optional()
    .or(z.literal('')),
  pan: z
    .string()
    .regex(/^[A-Z]{5}\d{4}[A-Z]{1}$/, 'Invalid PAN format')
    .optional()
    .or(z.literal('')),
  tan: z.string().max(20).optional(),
  cin: z.string().max(21).optional(),
  address: z
    .object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
      country: z.string().default('India'),
    })
    .optional(),
  timezone: z.string().default('Asia/Kolkata'),
  currency: z.string().default('INR'),
  fiscalYearStart: z.string().default('04-01'),
  dateFormat: z.string().default('DD/MM/YYYY'),
  bankDetails: z
    .object({
      bankName: z.string().optional(),
      accountNumber: z.string().optional(),
      ifscCode: z.string().optional(),
      branch: z.string().optional(),
    })
    .optional(),
  invoiceFooter: z.string().max(2000).optional(),
  termsAndConditions: z.string().max(5000).optional(),
  version: z.number().int().min(0).optional(),
});

export async function organizationRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase
): Promise<void> {
  // ── GET /organization ─────────────────────────────────────────────────────
  fastify.get('/organization', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId } = request.auth;

    const [org] = await db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.tenantId, tenantId));

    if (!org) throw new NotFoundError('Organization settings');
    return reply.code(200).send({ data: org });
  });

  // ── PUT /organization ─────────────────────────────────────────────────────
  fastify.put('/organization', { preHandler: [authenticate, requirePermission(PERMISSIONS.ORG_SETTINGS_EDIT)] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;

    const body = UpdateOrgSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    }

    const [existing] = await db
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.tenantId, tenantId));

    if (!existing) {
      const [created] = await db
        .insert(organizationSettings)
        .values({
          tenantId,
          createdBy: userId,
          ...body.data,
        } as unknown as typeof organizationSettings.$inferInsert)
        .returning();
      return reply.code(200).send({ data: created });
    }

    if (body.data.version !== undefined && existing.version !== body.data.version) {
      const { OptimisticLockError } = await import('@erp/types');
      throw new OptimisticLockError('Organization settings');
    }

    const [updated] = await db
      .update(organizationSettings)
      .set({
        ...body.data,
        updatedAt: new Date(),
        version: existing.version + 1,
      } as unknown as Partial<typeof organizationSettings.$inferInsert>)
      .where(eq(organizationSettings.tenantId, tenantId))
      .returning();

    return reply.code(200).send({ data: updated });
  });

  // ── POST /organization/logo/upload ────────────────────────────────────────
  fastify.post('/organization/logo/upload', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId } = request.auth;
    const body = request.body as { fileName?: string; contentType?: string };
    const fileName = body.fileName ?? 'logo.png';
    const contentType = body.contentType ?? 'image/png';
    const s3Key = `tenants/${tenantId}/logo/${Date.now()}-${fileName}`;

    return reply.code(200).send({
      data: {
        uploadUrl: `${process.env['MINIO_ENDPOINT'] ?? 'http://localhost:9000'}/erp-storage/${s3Key}`,
        s3Key,
        contentType,
        expiresIn: 900,
      },
    });
  });
}
