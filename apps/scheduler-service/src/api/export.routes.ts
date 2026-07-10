import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { exportJobs } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { PERMISSIONS } from '@erp/types';
import { NotFoundError } from '@erp/types';
import { z } from 'zod';
import type { JobRegistry } from '../JobRegistry.js';
import { EXPORT_GENERATE_JOB } from '../jobs/exportGenerateJob.js';
import { authenticate } from '../middleware/authenticate.js';

type AuthedRequest = { auth: { tenantId: number; userId: number; permissions: string[] } };

function hasPermission(request: unknown, perm: string): boolean {
  return ((request as AuthedRequest).auth?.permissions ?? []).includes(perm);
}

const ExportRequestSchema = z.object({
  entityType: z.enum(['customer', 'supplier', 'item', 'invoice', 'payment', 'ledger', 'stock', 'employee']),
  format: z.enum(['CSV', 'XLSX', 'PDF']).default('CSV'),
  filters: z.record(z.unknown()).optional(),
});

export async function exportRoutes(fastify: FastifyInstance, db: ErpDatabase, registry: JobRegistry): Promise<void> {
  // ── POST /exports/generate ────────────────────────────────────────────────
  fastify.post('/exports/generate', { preHandler: authenticate }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.EXPORT_GENERATE)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: EXPORT_GENERATE' } });
    }

    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const body = ExportRequestSchema.parse(request.body);

    if (body.format === 'PDF') {
      return reply.code(400).send({
        error: {
          code: 'FORMAT_NOT_SUPPORTED',
          message: 'PDF export is only available for individual documents (see report-service /reports/:id/pdf); use CSV or XLSX for bulk entity export',
        },
      });
    }

    const signedUrlExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [newJob] = await db.insert(exportJobs).values({
      tenantId,
      entityType: body.entityType,
      format: body.format,
      ...(body.filters !== undefined ? { filters: body.filters } : {}),
      status: 'PENDING',
      requestedBy: userId,
      createdBy: userId,
      signedUrlExpiresAt,
    } as unknown as typeof exportJobs.$inferInsert).returning({ id: exportJobs.id, entityType: exportJobs.entityType, format: exportJobs.format });

    if (!newJob) throw new Error('Export job creation failed');

    const jobId = newJob.id;
    const fileName = `${newJob.entityType}-export-${Date.now()}.${newJob.format.toLowerCase()}`;
    const downloadUrl = `/exports/${jobId}/download`;

    await db.update(exportJobs).set({ status: 'GENERATING' }).where(eq(exportJobs.id, jobId));

    await registry.triggerManual(EXPORT_GENERATE_JOB, tenantId, {
      jobId,
      entityType: newJob.entityType,
      format: newJob.format,
      ...(body.filters !== undefined ? { filters: body.filters } : {}),
    });

    return reply.code(201).send({ data: { jobId, fileName, downloadUrl, expiresAt: signedUrlExpiresAt } });
  });

  // ── GET /exports/:jobId/download ─────────────────────────────────────────
  fastify.get<{ Params: { jobId: string } }>('/exports/:jobId/download', { preHandler: authenticate }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.EXPORT_VIEW)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: EXPORT_VIEW' } });
    }

    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const [job] = await db
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.id, Number(request.params.jobId)), eq(exportJobs.tenantId, tenantId)))
      .limit(1);

    if (!job) throw new NotFoundError('ExportJob', request.params.jobId);

    if (job.status !== 'READY') {
      return reply.code(202).send({ data: { status: job.status, message: 'Export not ready yet' } });
    }

    if (job.signedUrlExpiresAt && new Date() > job.signedUrlExpiresAt) {
      return reply.code(410).send({ error: { code: 'EXPORT_EXPIRED', message: 'Export link has expired' } });
    }

    if (!job.signedUrl) throw new Error(`Export job ${job.id} is READY but has no signedUrl`);
    return reply.redirect(job.signedUrl, 302);
  });

  // ── GET /exports/:jobId/status ────────────────────────────────────────────
  fastify.get<{ Params: { jobId: string } }>('/exports/:jobId/status', { preHandler: authenticate }, async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.EXPORT_VIEW)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: EXPORT_VIEW' } });
    }

    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const [job] = await db
      .select()
      .from(exportJobs)
      .where(and(eq(exportJobs.id, Number(request.params.jobId)), eq(exportJobs.tenantId, tenantId)))
      .limit(1);

    if (!job) throw new NotFoundError('ExportJob', request.params.jobId);
    return reply.code(200).send({ data: { status: job.status, expiresAt: job.signedUrlExpiresAt } });
  });
}
