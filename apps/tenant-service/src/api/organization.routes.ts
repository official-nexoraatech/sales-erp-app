import type { FastifyInstance } from 'fastify';
import { organizationSettings } from '@erp/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS, OptionalGSTINSchema, OptionalPANSchema } from '@erp/types';
import type { PlatformContextFactory } from '@erp/sdk';
import { StorageClient } from '@erp/sdk';
import type { TenantServiceConfig } from '../config.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2MB — matches the multipart plugin's registered limit

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
  // Purchase module enhancement 2026-07-21: tiered PO approval threshold — see
  // PurchaseOrderService.approve() and PERMISSIONS.PO_APPROVE_HIGH_VALUE. Omitted/undefined
  // means no threshold configured (single-tier approval, unchanged from before).
  purchaseApprovalThreshold: z.coerce.number().min(0).optional(),
  version: z.number().int().min(0).optional(),
});

export async function organizationRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory,
  config: TenantServiceConfig
): Promise<void> {
  // F14: real server-side upload (mirrors TenantProvisioner's own StorageClient construction).
  const storageClient = new StorageClient({
    endpoint: config.minioEndpoint,
    accessKeyId: config.minioAccessKey,
    secretAccessKey: config.minioSecretKey,
    useSSL: config.minioUseSSL,
    bucket: config.minioBucket,
  });

  function ctxFor(request: {
    auth: { tenantId: number; userId: number };
    headers: Record<string, unknown>;
  }): ReturnType<PlatformContextFactory['create']> {
    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID();
    return ctxFactory.create({
      tenantId: request.auth.tenantId,
      userId: request.auth.userId,
      correlationId,
    });
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
          logoObjectKey: org.logoObjectKey,
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
  fastify.put(
    '/organization',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ORG_SETTINGS_EDIT)] },
    async (request, reply) => {
      const { tenantId, userId } = request.auth;
      const ctx = ctxFor(request);

      const body = UpdateOrgSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }
      // Decimal column — drizzle-orm/postgres-js expects a string, not a JS number, same
      // convention used for every other decimal field in this codebase (e.g. openingBalance).
      const data = {
        ...body.data,
        ...(body.data.purchaseApprovalThreshold !== undefined
          ? { purchaseApprovalThreshold: String(body.data.purchaseApprovalThreshold) }
          : {}),
      };

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
            ...data,
          } as unknown as typeof organizationSettings.$inferInsert)
          .returning();
        if (created) {
          await ctx.events.publish(
            'organization',
            tenantId,
            'ORGANIZATION_UPDATED',
            created as unknown as Record<string, unknown>
          );
          await ctx.audit.log({
            action: 'CREATE',
            entityType: 'organization_settings',
            entityId: created.id,
            after: created as unknown as Record<string, unknown>,
            actorEmail: request.auth.email,
            ipAddress: request.ip,
          });
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
          ...data,
          updatedAt: new Date(),
          updatedBy: userId,
          version: existing.version + 1,
        } as unknown as Partial<typeof organizationSettings.$inferInsert>)
        .where(eq(organizationSettings.tenantId, tenantId))
        .returning();

      if (updated) {
        await ctx.events.publish(
          'organization',
          tenantId,
          'ORGANIZATION_UPDATED',
          updated as unknown as Record<string, unknown>
        );
        await ctx.audit.log({
          action: 'UPDATE',
          entityType: 'organization_settings',
          entityId: updated.id,
          before: existing as unknown as Record<string, unknown>,
          after: updated as unknown as Record<string, unknown>,
          actorEmail: request.auth.email,
          ipAddress: request.ip,
        });
      }

      return reply.code(200).send({ data: updated });
    }
  );

  // ── POST /organization/logo/upload ────────────────────────────────────────
  // F14 (2026-07-23 tenant-service audit): this used to only construct a fake "presigned"
  // URL string (no signature/token — MinIO would reject a client PUT to it) and had no way
  // to ever persist the result back onto organizationSettings (UpdateOrgSchema never had a
  // logo field). Rewritten as a real, direct, server-side upload — mirrors
  // hr-service's employee photo upload (PG-042), the same already-proven pattern.
  fastify.post(
    '/organization/logo/upload',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.ORG_SETTINGS_EDIT)] },
    async (request, reply) => {
      const { tenantId, userId } = request.auth;
      const ctx = ctxFor(request);

      const [existing] = await ctx.db.raw
        .select()
        .from(organizationSettings)
        .where(eq(organizationSettings.tenantId, tenantId));
      if (!existing) throw new NotFoundError('Organization settings');

      const file = await request.file();
      if (!file) throw new ValidationError('No file uploaded');
      if (!LOGO_MIME_TYPES.has(file.mimetype)) {
        throw new ValidationError(`Unsupported file type: ${file.mimetype}`);
      }
      const buffer = await file.toBuffer();
      if (buffer.length > MAX_LOGO_SIZE) {
        throw new ValidationError('Logo exceeds the 2MB size limit');
      }

      // Best-effort cleanup of the previous logo object — a failure here shouldn't block
      // the new upload from succeeding, it just leaves one orphaned object in storage.
      if (existing.logoObjectKey) {
        await storageClient.deleteFile(existing.logoObjectKey).catch(() => undefined);
      }

      const objectKey = await storageClient.uploadFile(
        tenantId,
        'logo',
        file.filename,
        buffer,
        file.mimetype
      );

      const [updated] = await ctx.db.raw
        .update(organizationSettings)
        .set({
          logoObjectKey: objectKey,
          updatedAt: new Date(),
          updatedBy: userId,
          version: existing.version + 1,
        })
        .where(eq(organizationSettings.tenantId, tenantId))
        .returning();

      await ctx.events.publish(
        'organization',
        tenantId,
        'ORGANIZATION_UPDATED',
        updated as unknown as Record<string, unknown>
      );
      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'organization_settings',
        entityId: existing.id,
        metadata: { action: 'LOGO_UPLOAD', fileName: file.filename },
        actorEmail: request.auth.email,
        ipAddress: request.ip,
      });

      return reply.code(200).send({ data: { logoObjectKey: objectKey } });
    }
  );

  // ── GET /organization/logo — redirect to a freshly-signed, short-lived download URL ────
  // authenticate-only (matching GET /organization's own reference-data policy) — every
  // authenticated user in the tenant legitimately needs to render branding.
  fastify.get('/organization/logo', { preHandler: [authenticate] }, async (request, reply) => {
    const { tenantId } = request.auth;
    const ctx = ctxFor(request);

    const [org] = await ctx.db.raw
      .select({ logoObjectKey: organizationSettings.logoObjectKey })
      .from(organizationSettings)
      .where(eq(organizationSettings.tenantId, tenantId));

    if (!org?.logoObjectKey) throw new NotFoundError('Organization logo');

    const url = await storageClient.getSignedUrl(org.logoObjectKey);
    return reply.code(302).redirect(url);
  });
}
