import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { tenants, auditLog } from '@erp/db';
import { eq } from 'drizzle-orm';
import { NotFoundError, ValidationError, BusinessError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { invalidateTenantStatusCache, StorageClient, type PlatformContextFactory } from '@erp/sdk';
import { TenantProvisioner } from '../domain/TenantProvisioner.js';
import {
  CreateTenantSchema,
  PublicSignupSchema,
  SuspendTenantSchema,
  CloseTenantSchema,
} from './tenant.schemas.js';
import type { TenantServiceConfig } from '../config.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const PLATFORM_ADMIN: [typeof authenticate, ReturnType<typeof requirePermission>] = [
  authenticate,
  requirePermission(PERMISSIONS.PLATFORM_TENANT_MANAGE),
];

export async function tenantRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: TenantServiceConfig,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  const storageClient = new StorageClient({
    endpoint: config.minioEndpoint,
    accessKeyId: config.minioAccessKey,
    secretAccessKey: config.minioSecretKey,
    useSSL: config.minioUseSSL,
    bucket: config.minioBucket,
  });
  const provisioner = new TenantProvisioner(db, config.elasticsearchUrl, storageClient);

  // PG-012: the suspend/activate/close actions themselves were never audit-logged (only
  // the tenant row's own suspendedBy/suspendedReason/closedBy/closedReason columns tracked
  // who/why) — no append-only audit_log entry existed for these lifecycle-changing platform
  // actions, unlike other sensitive mutations in this codebase. These are cross-tenant
  // PLATFORM_ADMIN actions (this route file operates on the raw ErpDatabase, not a
  // tenant-scoped PlatformContext), so the entry is written directly rather than via
  // ctx.audit/PlatformAuditLogger, which assumes a single already-scoped tenant. Logged
  // under the *affected* tenant's own audit trail (tenantId = the tenant being changed),
  // matching how every other audit_log entry in this codebase is scoped to the tenant whose
  // data changed, not the actor's tenant.
  async function logTenantLifecycleAudit(
    action: 'TENANT_SUSPENDED' | 'TENANT_ACTIVATED' | 'TENANT_CLOSED',
    tenantId: number,
    actingUserId: number,
    actorEmail: string,
    ipAddress: string,
    before: { status: string },
    after: { status: string },
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await db.insert(auditLog).values({
      tenantId,
      userId: actingUserId,
      action,
      entityType: 'tenant',
      entityId: tenantId,
      beforeData: before,
      afterData: after,
      metadata: metadata ?? null,
      actorEmail,
      ipAddress,
      changedFields: ['status'],
    });
  }

  // ── POST /public/signup — Self-serve tenant provisioning, no auth required ──
  // Reuses the same TenantProvisioner.provision() pipeline as /admin/tenants, just with a
  // forced STARTER plan (self-serve can't pick Growth/Enterprise) and its own strict,
  // IP-keyed rate limit (no tenant/auth context exists yet to key by) — same convention as
  // auth-service's login/forgot-password route-level rate-limit overrides.
  fastify.post(
    '/public/signup',
    {
      config: {
        rateLimit: {
          max: config.signupRateLimitMax,
          timeWindow: config.signupRateLimitWindowMs,
        },
      },
    },
    async (request, reply) => {
      const body = PublicSignupSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      try {
        const result = await provisioner.provision({ ...body.data, plan: 'STARTER' });
        return reply.code(201).send({
          data: {
            tenantId: result.tenantId,
            adminUserId: result.adminUserId,
            adminEmail: result.adminEmail,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('unique') || message.includes('duplicate')) {
          throw new BusinessError(
            'DUPLICATE_TENANT',
            'A workspace with this URL or email already exists'
          );
        }
        if (message.includes('S3_PROVISIONING_FAILED')) {
          throw new BusinessError(
            'S3_PROVISIONING_FAILED',
            'Workspace storage could not be provisioned — please try again shortly'
          );
        }
        throw err;
      }
    }
  );

  // ── POST /admin/tenants — Provision new tenant ──────────────────────────
  fastify.post('/admin/tenants', { preHandler: PLATFORM_ADMIN }, async (request, reply) => {
    const body = CreateTenantSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    }

    try {
      const result = await provisioner.provision(
        body.data as unknown as Parameters<typeof provisioner.provision>[0]
      );
      return reply.code(201).send({
        data: {
          tenantId: result.tenantId,
          adminUserId: result.adminUserId,
          adminEmail: result.adminEmail,
          provisioningSteps: result.provisioningSteps,
          message: 'Tenant provisioned successfully',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('unique') || message.includes('duplicate')) {
        throw new BusinessError(
          'DUPLICATE_TENANT',
          'A tenant with this slug or email already exists'
        );
      }
      if (message.includes('S3_PROVISIONING_FAILED')) {
        throw new BusinessError(
          'S3_PROVISIONING_FAILED',
          'Tenant storage could not be provisioned — check MinIO connectivity'
        );
      }
      throw err;
    }
  });

  // ── GET /admin/tenants — List all tenants ───────────────────────────────
  fastify.get('/admin/tenants', { preHandler: PLATFORM_ADMIN }, async (request, reply) => {
    const allTenants = await db.select().from(tenants);
    return reply.code(200).send({
      data: {
        content: allTenants,
        totalElements: allTenants.length,
      },
    });
  });

  // ── GET /admin/tenants/:id — Get single tenant ──────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/admin/tenants/:id',
    { preHandler: PLATFORM_ADMIN },
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
      if (!tenant) throw new NotFoundError('Tenant', id);
      return reply.code(200).send({ data: tenant });
    }
  );

  // ── PATCH /admin/tenants/:id/suspend ────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    '/admin/tenants/:id/suspend',
    { preHandler: PLATFORM_ADMIN },
    async (request, reply) => {
      const actingUserId = request.auth.userId;
      const id = parseInt(request.params.id, 10);
      const body = SuspendTenantSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
      if (!tenant) throw new NotFoundError('Tenant', id);
      if (tenant.status === 'CLOSED') {
        throw new BusinessError('TENANT_CLOSED', 'Cannot suspend a closed tenant');
      }
      if (tenant.status === 'SUSPENDED') {
        throw new BusinessError('ALREADY_SUSPENDED', 'Tenant is already suspended');
      }
      const previousStatus = tenant.status;

      await provisioner.suspend(id, body.data.reason, actingUserId);
      invalidateTenantStatusCache(id);
      await ctxFactory.publishTenantStatusInvalidation(id);
      await logTenantLifecycleAudit(
        'TENANT_SUSPENDED',
        id,
        actingUserId,
        request.auth.email,
        request.ip,
        { status: previousStatus },
        { status: 'SUSPENDED' },
        { reason: body.data.reason }
      );
      return reply.code(200).send({ data: { message: 'Tenant suspended', tenantId: id } });
    }
  );

  // ── PATCH /admin/tenants/:id/activate ───────────────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    '/admin/tenants/:id/activate',
    { preHandler: PLATFORM_ADMIN },
    async (request, reply) => {
      const actingUserId = request.auth.userId;
      const id = parseInt(request.params.id, 10);

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
      if (!tenant) throw new NotFoundError('Tenant', id);
      if (tenant.status !== 'SUSPENDED') {
        throw new BusinessError('NOT_SUSPENDED', 'Tenant must be suspended to activate');
      }
      const previousStatus = tenant.status;

      await provisioner.activate(id);
      invalidateTenantStatusCache(id);
      await ctxFactory.publishTenantStatusInvalidation(id);
      await logTenantLifecycleAudit(
        'TENANT_ACTIVATED',
        id,
        actingUserId,
        request.auth.email,
        request.ip,
        { status: previousStatus },
        { status: 'ACTIVE' }
      );
      return reply.code(200).send({ data: { message: 'Tenant activated', tenantId: id } });
    }
  );

  // ── PATCH /admin/tenants/:id/close ──────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>(
    '/admin/tenants/:id/close',
    { preHandler: PLATFORM_ADMIN },
    async (request, reply) => {
      const actingUserId = request.auth.userId;
      const id = parseInt(request.params.id, 10);
      const body = CloseTenantSchema.safeParse(request.body);
      if (!body.success) {
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      }

      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
      if (!tenant) throw new NotFoundError('Tenant', id);
      if (tenant.status === 'CLOSED') {
        throw new BusinessError('ALREADY_CLOSED', 'Tenant is already closed');
      }
      const previousStatus = tenant.status;

      await provisioner.close(id, body.data.reason, actingUserId);
      invalidateTenantStatusCache(id);
      await ctxFactory.publishTenantStatusInvalidation(id);
      await logTenantLifecycleAudit(
        'TENANT_CLOSED',
        id,
        actingUserId,
        request.auth.email,
        request.ip,
        { status: previousStatus },
        { status: 'CLOSED' },
        { reason: body.data.reason }
      );
      return reply.code(200).send({ data: { message: 'Tenant closed', tenantId: id } });
    }
  );
}
