import type { FastifyInstance } from 'fastify';
import { organizationSettings } from '@erp/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS, OptionalGSTINSchema, OptionalPANSchema } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

// ERP-PLANNING/05_ERP_THEME_SYSTEM.md §4.1 — the only tenant-brandable surface: color,
// font (from an approved list), and radius scale. Never layout/spacing/status colors (§4.2).
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_FONTS = ['Inter', 'system-ui'] as const;

const ThemeConfigSchema = z.object({
  brandPrimary: z.string().regex(HEX_COLOR, 'Must be a hex color, e.g. #4f46e5').optional(),
  brandSecondary: z.string().regex(HEX_COLOR, 'Must be a hex color, e.g. #7c3aed').optional(),
  brandAccent: z.string().regex(HEX_COLOR, 'Must be a hex color, e.g. #f59e0b').optional(),
  fontSans: z.enum(ALLOWED_FONTS).optional(),
  radiusScale: z.enum(['sharp', 'default', 'rounded']).optional(),
});

const UpdateOrgSchema = z.object({
  orgName: z.string().min(2).max(200),
  legalName: z.string().max(300).optional(),
  gstin: OptionalGSTINSchema,
  pan: OptionalPANSchema,
  tan: z.string().max(20).optional(),
  cin: z.string().max(21).optional(),
  address: z
    .object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      city: z.string().min(1),
      state: z.string().min(1),
      pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'Invalid pincode'),
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
  themeConfig: ThemeConfigSchema.optional(),
  version: z.number().int().min(0).optional(),
});

export async function organizationRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  function ctxFor(request: { auth: { tenantId: number; userId: number }; headers: Record<string, unknown> }): ReturnType<PlatformContextFactory['create']> {
    const correlationId = (request.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID();
    return ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId });
  }

  // ── GET /organization ─────────────────────────────────────────────────────
  // PG-013: this endpoint is intentionally authenticate-only (not permission-gated) —
  // every authenticated user legitimately needs it for reference data (org name, theme
  // config for branding via TenantThemeSync). GSTIN/PAN/TAN/CIN/bank account details are
  // a different sensitivity class though: any authenticated user (e.g. a cashier) could
  // previously read the tenant's full bank account number via this route. Only strip
  // those fields for callers without ORGANIZATION_VIEW, rather than gating the whole
  // route, which would break branding/reference-data reads for every non-admin user.
  fastify.get('/organization', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId, permissions } = request.auth;
    const ctx = ctxFor(request);

    const [org] = await ctx.db.raw
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.tenantId, tenantId));

    if (!org) throw new NotFoundError('Organization settings');

    if (!permissions.includes(PERMISSIONS.ORGANIZATION_VIEW)) {
      return reply.code(200).send({
        data: {
          id: org.id,
          tenantId: org.tenantId,
          orgName: org.orgName,
          legalName: org.legalName,
          logoUrl: org.logoUrl,
          address: org.address,
          timezone: org.timezone,
          currency: org.currency,
          fiscalYearStart: org.fiscalYearStart,
          dateFormat: org.dateFormat,
          country: org.country,
          language: org.language,
          invoiceFooter: org.invoiceFooter,
          termsAndConditions: org.termsAndConditions,
          themeConfig: org.themeConfig,
          createdAt: org.createdAt,
          updatedAt: org.updatedAt,
          createdBy: org.createdBy,
          updatedBy: org.updatedBy,
          version: org.version,
        },
      });
    }

    return reply.code(200).send({ data: org });
  });

  // ── PUT /organization ─────────────────────────────────────────────────────
  fastify.put('/organization', { preHandler: [authenticate, requirePermission(PERMISSIONS.ORG_SETTINGS_EDIT)] }, async (request, reply) => {
    const { tenantId, userId } = request.auth;
    const ctx = ctxFor(request);

    const body = UpdateOrgSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    }

    const [existing] = await ctx.db.raw
      .select()
      .from(organizationSettings)
      .where(eq(organizationSettings.tenantId, tenantId));

    if (!existing) {
      const [created] = await ctx.db.raw
        .insert(organizationSettings)
        .values({
          tenantId,
          createdBy: userId,
          ...body.data,
        } as unknown as typeof organizationSettings.$inferInsert)
        .returning();
      if (created) {
        await ctx.events.publish('organization', tenantId, 'ORGANIZATION_UPDATED', created as unknown as Record<string, unknown>);
      }
      return reply.code(200).send({ data: created });
    }

    if (body.data.version !== undefined && existing.version !== body.data.version) {
      const { OptimisticLockError } = await import('@erp/types');
      throw new OptimisticLockError('Organization settings');
    }

    const [updated] = await ctx.db.raw
      .update(organizationSettings)
      .set({
        ...body.data,
        updatedAt: new Date(),
        updatedBy: userId,
        version: existing.version + 1,
      } as unknown as Partial<typeof organizationSettings.$inferInsert>)
      .where(eq(organizationSettings.tenantId, tenantId))
      .returning();

    if (updated) {
      await ctx.events.publish('organization', tenantId, 'ORGANIZATION_UPDATED', updated as unknown as Record<string, unknown>);
    }

    return reply.code(200).send({ data: updated });
  });

  // ── POST /organization/logo/upload ────────────────────────────────────────
  fastify.post('/organization/logo/upload', { preHandler: [authenticate, requirePermission(PERMISSIONS.ORG_SETTINGS_EDIT)] }, async (request, reply) => {
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
