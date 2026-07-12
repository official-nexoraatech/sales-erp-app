import type { FastifyInstance } from 'fastify';
import { ssoConfigs } from '@erp/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { encryptField } from '@erp/utils/server';
import { requireEnv } from '@erp/config';
import type { PlatformContextFactory } from '@erp/sdk';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const PROVIDERS = ['OKTA', 'AZURE_AD', 'GOOGLE_WORKSPACE', 'GENERIC_OIDC'] as const;

const UpsertSsoConfigSchema = z.object({
  provider: z.enum(PROVIDERS),
  issuerUrl: z
    .string()
    .url('Must be a valid URL')
    .refine((v) => v.startsWith('https://'), 'Issuer URL must use https'),
  clientId: z.string().min(1).max(255),
  // Omit to keep the existing secret unchanged (e.g. when only toggling `enabled`).
  clientSecret: z.string().min(1).optional(),
  enabled: z.boolean(),
  bypassLocalMfa: z.boolean(),
  version: z.number().int().min(0).optional(),
});

// Never send the encrypted or decrypted client secret to the frontend — only whether one
// is configured.
function toResponse(row: typeof ssoConfigs.$inferSelect): Record<string, unknown> {
  const { clientSecretEncrypted, ...rest } = row;
  return { ...rest, hasClientSecret: Boolean(clientSecretEncrypted) };
}

export async function ssoConfigRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
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

  // ── GET /sso-config ───────────────────────────────────────────────────────
  // Admin-only config surface (unlike GET /organization) — no other role needs to read IdP
  // issuer/client-id details, so the whole route is permission-gated rather than field-
  // stripped.
  fastify.get(
    '/sso-config',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SSO_CONFIG_MANAGE)] },
    async (request, reply) => {
      const { tenantId } = request.auth;
      const ctx = ctxFor(request);

      const [config] = await ctx.db.raw
        .select()
        .from(ssoConfigs)
        .where(eq(ssoConfigs.tenantId, tenantId));

      if (!config) throw new NotFoundError('SSO configuration');

      return reply.code(200).send({ data: toResponse(config) });
    }
  );

  // ── PUT /sso-config ───────────────────────────────────────────────────────
  fastify.put(
    '/sso-config',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SSO_CONFIG_MANAGE)] },
    async (request, reply) => {
      const { tenantId, userId } = request.auth;
      const ctx = ctxFor(request);

      const body = UpsertSsoConfigSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }
      const { clientSecret, version, ...fields } = body.data;

      const [existing] = await ctx.db.raw
        .select()
        .from(ssoConfigs)
        .where(eq(ssoConfigs.tenantId, tenantId));

      if (!existing) {
        if (!clientSecret) {
          throw new ValidationError(
            'clientSecret is required when configuring SSO for the first time'
          );
        }
        const [created] = await ctx.db.raw
          .insert(ssoConfigs)
          .values({
            tenantId,
            createdBy: userId,
            ...fields,
            clientSecretEncrypted: encryptField(clientSecret, requireEnv('FIELD_ENCRYPTION_KEY')),
          } as unknown as typeof ssoConfigs.$inferInsert)
          .returning();
        if (created) {
          await ctx.events.publish('sso-config', tenantId, 'SSO_CONFIG_UPDATED', {
            tenantId,
            provider: created.provider,
            enabled: created.enabled,
          });
        }
        return reply.code(200).send({ data: toResponse(created!) });
      }

      if (version !== undefined && existing.version !== version) {
        const { OptimisticLockError } = await import('@erp/types');
        throw new OptimisticLockError('SSO configuration');
      }

      const [updated] = await ctx.db.raw
        .update(ssoConfigs)
        .set({
          ...fields,
          ...(clientSecret
            ? {
                clientSecretEncrypted: encryptField(
                  clientSecret,
                  requireEnv('FIELD_ENCRYPTION_KEY')
                ),
              }
            : {}),
          updatedAt: new Date(),
          updatedBy: userId,
          version: existing.version + 1,
        } as unknown as Partial<typeof ssoConfigs.$inferInsert>)
        .where(eq(ssoConfigs.tenantId, tenantId))
        .returning();

      if (updated) {
        await ctx.events.publish('sso-config', tenantId, 'SSO_CONFIG_UPDATED', {
          tenantId,
          provider: updated.provider,
          enabled: updated.enabled,
        });
      }

      return reply.code(200).send({ data: toResponse(updated!) });
    }
  );

  // ── DELETE /sso-config ────────────────────────────────────────────────────
  // Fully revokes SSO for the tenant (not just `enabled = false`) — an explicit admin
  // action, not something a misconfiguration should trigger accidentally.
  fastify.delete(
    '/sso-config',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.SSO_CONFIG_MANAGE)] },
    async (request, reply) => {
      const { tenantId } = request.auth;
      const ctx = ctxFor(request);

      const [deleted] = await ctx.db.raw
        .delete(ssoConfigs)
        .where(eq(ssoConfigs.tenantId, tenantId))
        .returning();
      if (!deleted) throw new NotFoundError('SSO configuration');

      await ctx.events.publish('sso-config', tenantId, 'SSO_CONFIG_DELETED', { tenantId });

      return reply.code(204).send();
    }
  );
}
