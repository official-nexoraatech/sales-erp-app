import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { tenants } from '@erp/db';
import { eq } from 'drizzle-orm';
import { NotFoundError, ValidationError, BusinessError } from '@erp/types';
import { TenantProvisioner } from '../domain/TenantProvisioner.js';
import {
  CreateTenantSchema,
  SuspendTenantSchema,
  CloseTenantSchema,
} from './tenant.schemas.js';
import type { TenantServiceConfig } from '../config.js';
import { authenticate } from '../middleware/authenticate.js';

export async function tenantRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: TenantServiceConfig
): Promise<void> {
  const provisioner = new TenantProvisioner(db, config.elasticsearchUrl, config.minioBucket);

  // ── POST /admin/tenants — Provision new tenant ──────────────────────────
  fastify.post('/admin/tenants', async (request, reply) => {
    const body = CreateTenantSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
    }

    try {
      const result = await provisioner.provision(body.data as unknown as Parameters<typeof provisioner.provision>[0]);
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
        throw new BusinessError('DUPLICATE_TENANT', 'A tenant with this slug or email already exists');
      }
      throw err;
    }
  });

  // ── GET /admin/tenants — List all tenants ───────────────────────────────
  fastify.get('/admin/tenants', async (request, reply) => {
    const allTenants = await db.select().from(tenants);
    return reply.code(200).send({
      data: {
        content: allTenants,
        totalElements: allTenants.length,
      },
    });
  });

  // ── GET /admin/tenants/:id — Get single tenant ──────────────────────────
  fastify.get<{ Params: { id: string } }>('/admin/tenants/:id', async (request, reply) => {
    const id = parseInt(request.params.id, 10);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!tenant) throw new NotFoundError('Tenant', id);
    return reply.code(200).send({ data: tenant });
  });

  // ── PATCH /admin/tenants/:id/suspend ────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/admin/tenants/:id/suspend', { preHandler: [authenticate] }, async (request, reply) => {
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

    await provisioner.suspend(id, body.data.reason, actingUserId);
    return reply.code(200).send({ data: { message: 'Tenant suspended', tenantId: id } });
  });

  // ── PATCH /admin/tenants/:id/activate ───────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/admin/tenants/:id/activate', { preHandler: [authenticate] }, async (request, reply) => {
    const id = parseInt(request.params.id, 10);

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!tenant) throw new NotFoundError('Tenant', id);
    if (tenant.status !== 'SUSPENDED') {
      throw new BusinessError('NOT_SUSPENDED', 'Tenant must be suspended to activate');
    }

    await provisioner.activate(id);
    return reply.code(200).send({ data: { message: 'Tenant activated', tenantId: id } });
  });

  // ── PATCH /admin/tenants/:id/close ──────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>('/admin/tenants/:id/close', { preHandler: [authenticate] }, async (request, reply) => {
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

    await provisioner.close(id, body.data.reason, actingUserId);
    return reply.code(200).send({ data: { message: 'Tenant closed', tenantId: id } });
  });
}
