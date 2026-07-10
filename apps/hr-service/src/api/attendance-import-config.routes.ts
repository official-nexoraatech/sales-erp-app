import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { biometricDeviceConfigs } from '@erp/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ValidationError, PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { DEFAULT_BIOMETRIC_CONFIG } from '../domain/BiometricPunchNormalizer.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const ConfigSchema = z.object({
  vendor: z.enum(['ESSL', 'ZKTECO', 'MATRIX', 'REALTIME', 'GENERIC_CSV']).default('GENERIC_CSV'),
  columnMapping: z.object({
    employeeCode: z.string().min(1),
    date: z.string().min(1),
    time: z.string().min(1),
    direction: z.string().min(1),
  }),
  dateFormat: z.string().min(1).default('YYYY-MM-DD'),
});

export async function attendanceImportConfigRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get('/attendance-import/config', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_MARK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });

    const [existing] = await ctx.db.raw.select().from(biometricDeviceConfigs).where(eq(biometricDeviceConfigs.tenantId, tenantId));
    if (!existing) {
      return reply.code(200).send({
        data: { vendor: 'GENERIC_CSV', columnMapping: DEFAULT_BIOMETRIC_CONFIG.columnMapping, dateFormat: DEFAULT_BIOMETRIC_CONFIG.dateFormat },
      });
    }
    return reply.code(200).send({ data: existing });
  });

  fastify.post('/attendance-import/config', { preHandler: [authenticate, requirePermission(PERMISSIONS.ATTENDANCE_MARK)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const body = ConfigSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw
      .select({ id: biometricDeviceConfigs.id })
      .from(biometricDeviceConfigs)
      .where(eq(biometricDeviceConfigs.tenantId, tenantId));

    const [result] = existing
      ? await ctx.db.raw
          .update(biometricDeviceConfigs)
          .set({ vendor: body.data.vendor, columnMapping: body.data.columnMapping, dateFormat: body.data.dateFormat, updatedAt: new Date() })
          .where(eq(biometricDeviceConfigs.id, existing.id))
          .returning()
      : await ctx.db.raw
          .insert(biometricDeviceConfigs)
          .values({ tenantId, createdBy: userId, ...body.data } as typeof biometricDeviceConfigs.$inferInsert)
          .returning();

    if (!result) throw new Error('Biometric device config upsert failed');
    await ctx.audit.log({ action: existing ? 'UPDATE' : 'CREATE', entityType: 'biometric_device_config', entityId: result.id });

    return reply.code(201).send({ data: { id: result.id } });
  });
}
