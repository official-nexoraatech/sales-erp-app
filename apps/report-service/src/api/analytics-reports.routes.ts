import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ErpDatabase } from '@erp/db';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { REPORT_REGISTRY, getReportDefinition } from '../domain/ReportRegistry.js';
import { ReportEngine } from '../domain/ReportEngine.js';
import { ReportFormatter } from '../domain/ReportFormatter.js';
import { reportSchedules, reportRunHistory } from '@erp/db';
import { eq, and, desc } from 'drizzle-orm';
import { randomBytes } from 'crypto';

const RunReportSchema = z.object({
  params: z.record(z.union([z.string(), z.number()])).optional().default({}),
  format: z.enum(['JSON', 'CSV', 'EXCEL']).optional().default('JSON'),
  async: z.boolean().optional().default(false),
});

const ScheduleCreateSchema = z.object({
  reportSlug: z.string(),
  params: z.record(z.union([z.string(), z.number()])).optional().default({}),
  format: z.enum(['PDF', 'EXCEL', 'CSV']).optional().default('PDF'),
  cronExpression: z.string(),
  recipients: z.array(z.string().email()),
});

type DbClient = ErpDatabase;

export async function analyticsReportsRoutes(fastify: FastifyInstance, db: DbClient): Promise<void> {
  const engine = new ReportEngine(db);
  const formatter = new ReportFormatter();

  // GET /api/v2/reports — list all report definitions
  fastify.get('/api/v2/reports', {
    preHandler: [authenticate, requirePermission('INVOICE_VIEW')],
  }, async (_req, reply) => {
    const grouped = REPORT_REGISTRY.reduce<Record<string, typeof REPORT_REGISTRY>>((acc, r) => {
      if (!acc[r.category]) acc[r.category] = [];
      acc[r.category]!.push(r);
      return acc;
    }, {});
    return reply.code(200).send({ data: { grouped, total: REPORT_REGISTRY.length } });
  });

  // GET /api/v2/reports/:slug — get report definition
  fastify.get<{ Params: { slug: string } }>('/api/v2/reports/:slug', {
    preHandler: [authenticate, requirePermission('INVOICE_VIEW')],
  }, async (req, reply) => {
    const definition = getReportDefinition(req.params.slug);
    if (!definition) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Report not found' } });
    }
    return reply.code(200).send({ data: definition });
  });

  // POST /api/v2/reports/:slug/run — run a report
  fastify.post<{ Params: { slug: string } }>('/api/v2/reports/:slug/run', {
    preHandler: [authenticate],
  }, async (req, reply) => {
    const definition = getReportDefinition(req.params.slug);
    if (!definition) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Report not found' } });
    }

    if (!req.auth.permissions.includes(definition.permission)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: `Missing permission: ${definition.permission}` } });
    }

    const parsed = RunReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid parameters', details: parsed.error.flatten() } });
    }

    const { params, format, async: runAsync } = parsed.data;
    const tenantId = req.auth.tenantId;

    // For async: create a run_history record and return immediately
    if (runAsync || definition.supportsAsync) {
      const [run] = await db.insert(reportRunHistory).values({
        tenantId,
        reportSlug: req.params.slug,
        params,
        format: format as 'PDF' | 'EXCEL' | 'CSV',
        status: 'PENDING',
        triggeredBy: 'MANUAL',
        startedAt: new Date(),
      }).returning();

      // Fire and forget
      setImmediate(async () => {
        const startTime = Date.now();
        try {
          await db.update(reportRunHistory)
            .set({ status: 'RUNNING' })
            .where(eq(reportRunHistory.id, run!.id));

          const result = await engine.generate(req.params.slug, tenantId, params);

          await db.update(reportRunHistory)
            .set({
              status: 'COMPLETED',
              completedAt: new Date(),
              rowCount: result.totalRows,
              durationMs: Date.now() - startTime,
            })
            .where(eq(reportRunHistory.id, run!.id));
        } catch (err) {
          await db.update(reportRunHistory)
            .set({
              status: 'FAILED',
              completedAt: new Date(),
              errorMessage: err instanceof Error ? err.message : String(err),
              durationMs: Date.now() - startTime,
            })
            .where(eq(reportRunHistory.id, run!.id));
        }
      });

      return reply.code(202).send({ data: { runId: run!.id, status: 'PENDING', message: 'Report queued' } });
    }

    // Synchronous run
    const startTime = Date.now();
    const result = await engine.generate(req.params.slug, tenantId, params);
    const durationMs = Date.now() - startTime;

    if (format === 'CSV') {
      const csv = formatter.toCSV(definition, result);
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', `attachment; filename="${formatter.getFileName(req.params.slug, 'CSV')}"`)
        .send(csv);
    }

    if (format === 'EXCEL') {
      const buf = formatter.toExcel(definition, result);
      return reply
        .header('Content-Type', formatter.getContentType('EXCEL'))
        .header('Content-Disposition', `attachment; filename="${formatter.getFileName(req.params.slug, 'EXCEL')}"`)
        .send(buf);
    }

    return reply.code(200).send({
      data: {
        definition,
        ...result,
        totals: formatter.summarize(result, definition),
        durationMs,
      },
    });
  });

  // GET /api/v2/reports/run-history — list run history
  fastify.get('/api/v2/reports/run-history', {
    preHandler: [authenticate, requirePermission('INVOICE_VIEW')],
  }, async (req, reply) => {
    const runs = await db
      .select()
      .from(reportRunHistory)
      .where(eq(reportRunHistory.tenantId, req.auth.tenantId))
      .orderBy(desc(reportRunHistory.createdAt))
      .limit(50);
    return reply.code(200).send({ data: runs });
  });

  // GET /api/v2/reports/run-history/:runId — get run status
  fastify.get<{ Params: { runId: string } }>('/api/v2/reports/run-history/:runId', {
    preHandler: [authenticate, requirePermission('INVOICE_VIEW')],
  }, async (req, reply) => {
    const [run] = await db
      .select()
      .from(reportRunHistory)
      .where(and(
        eq(reportRunHistory.id, parseInt(req.params.runId)),
        eq(reportRunHistory.tenantId, req.auth.tenantId)
      ));
    if (!run) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Run not found' } });
    }
    return reply.code(200).send({ data: run });
  });

  // POST /api/v2/report-schedules — create schedule
  fastify.post('/api/v2/report-schedules', {
    preHandler: [authenticate, requirePermission('REPORT_CREATE_SCHEDULE')],
  }, async (req, reply) => {
    const parsed = ScheduleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid schedule data', details: parsed.error.flatten() } });
    }

    const definition = getReportDefinition(parsed.data.reportSlug);
    if (!definition) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Report not found' } });
    }

    const unsubscribeToken = randomBytes(32).toString('hex');

    const [schedule] = await db.insert(reportSchedules).values({
      tenantId: req.auth.tenantId,
      reportSlug: parsed.data.reportSlug,
      params: parsed.data.params,
      format: parsed.data.format,
      cronExpression: parsed.data.cronExpression,
      recipients: parsed.data.recipients,
      active: 1,
      unsubscribeToken,
      createdBy: req.auth.userId,
    }).returning();

    return reply.code(201).send({ data: schedule });
  });

  // GET /api/v2/report-schedules — list schedules
  fastify.get('/api/v2/report-schedules', {
    preHandler: [authenticate, requirePermission('REPORT_VIEW')],
  }, async (req, reply) => {
    const schedules = await db
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.tenantId, req.auth.tenantId))
      .orderBy(desc(reportSchedules.createdAt));
    return reply.code(200).send({ data: schedules });
  });

  // DELETE /api/v2/report-schedules/:id — delete schedule
  fastify.delete<{ Params: { id: string } }>('/api/v2/report-schedules/:id', {
    preHandler: [authenticate, requirePermission('REPORT_DELETE_SCHEDULE')],
  }, async (req, reply) => {
    const [deleted] = await db
      .delete(reportSchedules)
      .where(and(
        eq(reportSchedules.id, parseInt(req.params.id)),
        eq(reportSchedules.tenantId, req.auth.tenantId)
      ))
      .returning();
    if (!deleted) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Schedule not found' } });
    }
    return reply.code(200).send({ data: { deleted: true } });
  });

  // GET /api/v1/reports/ar-aging — AR Aging Summary (dedicated endpoint)
  fastify.get('/api/v1/reports/ar-aging', {
    preHandler: [authenticate, requirePermission('REPORT_VIEW')],
  }, async (req, reply) => {
    const { tenantId } = req.auth;
    const q = req.query as Record<string, string>;
    const params: Record<string, string> = {
      asOfDate: q['asOf'] ?? new Date().toISOString().slice(0, 10),
    };
    if (q['branchId']) params['branchId'] = q['branchId'];
    const result = await engine.generate('ar-aging', tenantId, params);
    return reply.code(200).send({ data: result.rows, meta: { total: result.totalRows, generatedAt: result.generatedAt } });
  });

  // GET /api/v1/reports/ap-aging — AP Aging Summary (dedicated endpoint)
  fastify.get('/api/v1/reports/ap-aging', {
    preHandler: [authenticate, requirePermission('REPORT_VIEW')],
  }, async (req, reply) => {
    const { tenantId } = req.auth;
    const q = req.query as Record<string, string>;
    const params: Record<string, string> = {
      asOfDate: q['asOf'] ?? new Date().toISOString().slice(0, 10),
    };
    if (q['supplierId']) params['supplierId'] = q['supplierId'];
    const result = await engine.generate('ap-aging', tenantId, params);
    return reply.code(200).send({ data: result.rows, meta: { total: result.totalRows, generatedAt: result.generatedAt } });
  });

  // GET /api/v2/unsubscribe/:token — unsubscribe from scheduled report
  fastify.get<{ Params: { token: string } }>('/api/v2/unsubscribe/:token', async (req, reply) => {
    const [schedule] = await db
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.unsubscribeToken, req.params.token));
    if (!schedule) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Invalid unsubscribe token' } });
    }
    await db
      .update(reportSchedules)
      .set({ active: 0 })
      .where(eq(reportSchedules.id, schedule.id));
    return reply.code(200).send({ data: { message: 'Successfully unsubscribed from scheduled report' } });
  });
}
