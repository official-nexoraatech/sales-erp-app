import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { jobHistory } from '@erp/db';
import { eq, and, desc } from 'drizzle-orm';
import { NotFoundError, BusinessError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import type { JobRegistry } from '../JobRegistry.js';

type AuthedRequest = { auth: { tenantId: number; userId?: number; permissions: string[] } };

function hasPermission(request: unknown, perm: string): boolean {
  return ((request as AuthedRequest).auth?.permissions ?? []).includes(perm);
}

export async function schedulerRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  registry: JobRegistry
): Promise<void> {
  // ── GET /jobs — List all registered jobs with status ─────────────────────
  fastify.get('/jobs', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.JOB_VIEW)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: JOB_VIEW' } });
    }

    const { tenantId } = (request as unknown as AuthedRequest).auth;

    const allJobs = registry.listAll();
    const statusPromises = allJobs.map(async ({ name, config }) => {
      try {
        const status = await registry.getStatus(name);
        // Get last run from DB
        const [lastRun] = await db
          .select()
          .from(jobHistory)
          .where(and(eq(jobHistory.jobName, name), eq(jobHistory.tenantId, tenantId)))
          .orderBy(desc(jobHistory.startedAt))
          .limit(1);

        return {
          name,
          cron: config.cron,
          description: config.description,
          tenantScoped: config.tenantScoped,
          isPaused: status.isPaused,
          waiting: status.waiting,
          active: status.active,
          lastRun: lastRun
            ? {
                status: lastRun.status,
                startedAt: lastRun.startedAt,
                durationMs: lastRun.durationMs,
                triggeredBy: lastRun.triggeredBy,
              }
            : null,
        };
      } catch {
        return { name, cron: config.cron, description: config.description, isPaused: false, lastRun: null };
      }
    });

    const jobStatuses = await Promise.all(statusPromises);
    return reply.code(200).send({
      data: { content: jobStatuses, totalElements: jobStatuses.length },
    });
  });

  // ── POST /jobs/:name/trigger — Manually trigger a job ────────────────────
  fastify.post<{ Params: { name: string } }>('/jobs/:name/trigger', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.JOB_TRIGGER)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: JOB_TRIGGER' } });
    }

    const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;
    const jobName = request.params.name;

    const allJobs = registry.listAll();
    const jobDef = allJobs.find((j) => j.name === jobName);
    if (!jobDef) throw new NotFoundError('Job', jobName);

    const jobId = await registry.triggerManual(jobName, tenantId);

    // Record in job history
    await db.insert(jobHistory).values({
      tenantId,
      jobName,
      cronExpression: jobDef.config.cron,
      status: 'RUNNING',
      triggeredBy: 'MANUAL',
      triggeredByUserId: userId,
      startedAt: new Date(),
      createdBy: userId,
    });

    return reply.code(200).send({ data: { message: 'Job triggered', jobName, jobId } });
  });

  // ── PATCH /jobs/:name/pause ───────────────────────────────────────────────
  fastify.patch<{ Params: { name: string } }>('/jobs/:name/pause', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.JOB_PAUSE)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: JOB_PAUSE' } });
    }

    const jobName = request.params.name;
    const allJobs = registry.listAll();
    if (!allJobs.find((j) => j.name === jobName)) throw new NotFoundError('Job', jobName);

    await registry.pause(jobName);
    return reply.code(200).send({ data: { message: 'Job paused', jobName } });
  });

  // ── PATCH /jobs/:name/resume ──────────────────────────────────────────────
  fastify.patch<{ Params: { name: string } }>('/jobs/:name/resume', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.JOB_PAUSE)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: JOB_PAUSE' } });
    }

    const jobName = request.params.name;
    const allJobs = registry.listAll();
    if (!allJobs.find((j) => j.name === jobName)) throw new NotFoundError('Job', jobName);

    await registry.resume(jobName);
    return reply.code(200).send({ data: { message: 'Job resumed', jobName } });
  });

  // ── GET /jobs/:name/history — Last 30 runs ───────────────────────────────
  fastify.get<{ Params: { name: string } }>('/jobs/:name/history', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.JOB_VIEW)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: JOB_VIEW' } });
    }

    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const jobName = request.params.name;

    const history = await db
      .select()
      .from(jobHistory)
      .where(and(eq(jobHistory.jobName, jobName), eq(jobHistory.tenantId, tenantId)))
      .orderBy(desc(jobHistory.startedAt))
      .limit(30);

    return reply.code(200).send({ data: { content: history, jobName } });
  });
}
