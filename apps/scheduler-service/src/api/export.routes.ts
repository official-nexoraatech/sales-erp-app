import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { exportJobs } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { PERMISSIONS } from '@erp/types';
import { NotFoundError } from '@erp/types';
import { z } from 'zod';

type AuthedRequest = { auth: { tenantId: number; userId: number; permissions: string[] } };

function hasPermission(request: unknown, perm: string): boolean {
  return ((request as AuthedRequest).auth?.permissions ?? []).includes(perm);
}

const ExportRequestSchema = z.object({
  entityType: z.enum(['customer', 'supplier', 'item', 'invoice', 'payment', 'ledger', 'stock', 'employee']),
  format: z.enum(['CSV', 'XLSX', 'PDF']).default('CSV'),
  filters: z.record(z.unknown()).optional(),
});

export async function exportRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  // ── POST /exports/generate ────────────────────────────────────────────────
  fastify.post('/exports/generate', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.EXPORT_GENERATE)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: EXPORT_GENERATE' } });
    }

    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const body = ExportRequestSchema.parse(request.body);

    const signedUrlExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [newJob] = await db.insert(exportJobs).values({
      tenantId,
      entityType: body.entityType,
      format: body.format,
      ...(body.filters !== undefined ? { filters: body.filters } : {}),
      status: 'PENDING',
      requestedBy: userId,
      createdBy: userId,
    } as unknown as typeof exportJobs.$inferInsert).returning({ id: exportJobs.id, entityType: exportJobs.entityType, format: exportJobs.format });

    if (!newJob) throw new Error('Export job creation failed');

    const jobId = newJob.id;
    const fileName = `${newJob.entityType}-export-${Date.now()}.${newJob.format.toLowerCase()}`;
    const signedUrl = `/exports/${jobId}/download?token=placeholder`;

    await db
      .update(exportJobs)
      .set({
        status: 'READY',
        signedUrl,
        signedUrlExpiresAt,
        completedAt: new Date(),
      })
      .where(eq(exportJobs.id, jobId));

    return reply.code(201).send({ data: { jobId, fileName, downloadUrl: signedUrl, expiresAt: signedUrlExpiresAt } });
  });

  // ── GET /exports/:jobId/download ─────────────────────────────────────────
  fastify.get<{ Params: { jobId: string } }>('/exports/:jobId/download', async (request, reply) => {
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

    if (job.signedUrl && !job.signedUrl.includes('placeholder')) {
      return reply.redirect(302, job.signedUrl);
    }

    const exportFileName = `${job.entityType}-export.${job.format.toLowerCase()}`;
    reply.raw.setHeader('Content-Type', 'text/csv');
    reply.raw.setHeader('Content-Disposition', `attachment; filename="${exportFileName}"`);
    return reply.code(200).send(`# Export for ${job.entityType}\n# Generated: ${new Date().toISOString()}\n`);
  });

  // ── GET /exports/:jobId/status ────────────────────────────────────────────
  fastify.get<{ Params: { jobId: string } }>('/exports/:jobId/status', async (request, reply) => {
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
