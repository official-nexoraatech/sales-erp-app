/* global process, fetch */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { tenants } from '@erp/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ValidationError, BusinessError, PERMISSIONS } from '@erp/types';
import { timingSafeEqual } from 'node:crypto';
import { PdfEngine } from '../domain/PdfEngine.js';
import { NumberSeriesEngine } from '../domain/NumberSeriesEngine.js';
import type { SeriesType } from '../domain/NumberSeriesEngine.js';
import { ReportEngine } from '../domain/ReportEngine.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const GeneratePdfSchema = z.object({
  documentType: z.enum([
    'TAX_INVOICE', 'QUOTATION', 'DELIVERY_CHALLAN',
    'PURCHASE_ORDER', 'PAYMENT_RECEIPT', 'SALARY_SLIP', 'PROFIT_LOSS',
  ]),
  data: z.record(z.unknown()),
  orientation: z.enum(['portrait', 'landscape']).optional().default('portrait'),
});

type AuthedRequest = { auth: { tenantId: number; userId?: number } };

// /reports/pdf is called server-to-server by sales-service/hr-service/accounting-service,
// never directly by browsers — gated by a shared internal key, same pattern as
// apps/purchase-service/src/api/internal.routes.ts.
async function checkInternalKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches =
    !!expected &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    await reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid internal API key' } });
  }
}

export async function reportRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  pdfEngine: PdfEngine
): Promise<void> {
  const numberEngine = new NumberSeriesEngine(db);
  const reportEngine = new ReportEngine(db);

  // ── POST /internal/reports/outstanding-summary?tenantId=... — PG-026 ──────
  // Reuses the same tested ar-aging/ap-aging queries the report console uses,
  // then emails a tenant-wide outstanding-receivables/payables summary.
  fastify.post('/internal/reports/outstanding-summary', { preHandler: checkInternalKey }, async (request, reply) => {
    const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
    if (!tenantId) return reply.code(400).send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

    const [ar, ap] = await Promise.all([
      reportEngine.generate('ar-aging', tenantId, {}),
      reportEngine.generate('ap-aging', tenantId, {}),
    ]);

    const arTotal = ar.rows.reduce((sum, r) => sum + Number(r['totalOutstanding'] ?? 0), 0);
    const apTotal = ap.rows.reduce((sum, r) => sum + Number(r['totalOutstanding'] ?? 0), 0);

    const [tenant] = await db.select({ contactEmail: tenants.contactEmail }).from(tenants).where(eq(tenants.id, tenantId));
    if (tenant?.contactEmail && (arTotal > 0 || apTotal > 0)) {
      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          body: JSON.stringify({
            tenantId,
            eventType: 'OUTSTANDING_REPORT_SUMMARY',
            channel: 'EMAIL',
            recipientEmail: tenant.contactEmail,
            subject: 'Daily outstanding receivables/payables summary',
            body: `Outstanding receivables: ${arTotal.toFixed(2)} across ${ar.rows.length} customer(s). Outstanding payables: ${apTotal.toFixed(2)} across ${ap.rows.length} supplier(s).`,
          }),
        });
      } catch {
        // best-effort — the response below still reports the real totals either way
      }
    }

    return reply.code(200).send({
      data: { arTotal, apTotal, customersWithOutstanding: ar.rows.length, suppliersWithOutstanding: ap.rows.length },
    });
  });

  // ── POST /reports/pdf — Generate PDF from template (internal, service-to-service) ──
  fastify.post('/reports/pdf', { preHandler: checkInternalKey }, async (request, reply) => {
    const body = GeneratePdfSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const pdf = await pdfEngine.generate({
      documentType: body.data.documentType,
      data: body.data.data,
      orientation: body.data.orientation,
    });

    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${body.data.documentType.toLowerCase()}.pdf"`)
      .send(pdf);
  });

  // ── POST /config/number-series/:type — Configure number series ────────────
  fastify.post<{ Params: { type: string } }>('/config/number-series/:type', { preHandler: [authenticate, requirePermission(PERMISSIONS.NUMBER_SERIES_CONFIG)] }, async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const type = request.params.type.toUpperCase() as SeriesType;
    const body = request.body as { formatTemplate: string; branchId?: number };

    if (!body.formatTemplate) throw new ValidationError('formatTemplate is required');

    await numberEngine.configure(tenantId, type, body.formatTemplate, body.branchId);
    return reply.code(200).send({ data: { message: 'Number series configured', type, formatTemplate: body.formatTemplate } });
  });

  // ── POST /config/number-series/:type/preview — Preview next number ────────
  fastify.post<{ Params: { type: string } }>('/config/number-series/:type/preview', { preHandler: [authenticate, requirePermission(PERMISSIONS.NUMBER_SERIES_CONFIG)] }, async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const type = request.params.type.toUpperCase() as SeriesType;

    const next = await numberEngine.preview(tenantId, type);
    return reply.code(200).send({ data: { nextNumber: next, type } });
  });

  // ── Internal: POST /internal/number-series/:type/next — Thread-safe next ──
  // Called by other services (sales, purchase, etc.) to get the next serial number
  fastify.post<{ Params: { type: string } }>('/internal/number-series/:type/next', { preHandler: authenticate }, async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const type = request.params.type.toUpperCase() as SeriesType;
    const body = request.body as { branchId?: number };

    const next = await numberEngine.next(tenantId, type, body.branchId);
    return reply.code(200).send({ data: { number: next } });
  });
}
