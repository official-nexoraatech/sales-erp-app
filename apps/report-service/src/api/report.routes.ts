import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { z } from 'zod';
import { ValidationError, BusinessError } from '@erp/types';
import { PdfEngine } from '../domain/PdfEngine.js';
import { NumberSeriesEngine } from '../domain/NumberSeriesEngine.js';
import type { SeriesType } from '../domain/NumberSeriesEngine.js';

const GeneratePdfSchema = z.object({
  documentType: z.enum([
    'TAX_INVOICE', 'QUOTATION', 'DELIVERY_CHALLAN',
    'PURCHASE_ORDER', 'PAYMENT_RECEIPT', 'SALARY_SLIP',
  ]),
  data: z.record(z.unknown()),
  orientation: z.enum(['portrait', 'landscape']).optional().default('portrait'),
});

type AuthedRequest = { auth: { tenantId: number; userId?: number } };

export async function reportRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  pdfEngine: PdfEngine
): Promise<void> {
  const numberEngine = new NumberSeriesEngine(db);

  // ── POST /reports/pdf — Generate PDF from template ───────────────────────
  fastify.post('/reports/pdf', async (request, reply) => {
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
  fastify.post<{ Params: { type: string } }>('/config/number-series/:type', async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const type = request.params.type.toUpperCase() as SeriesType;
    const body = request.body as { formatTemplate: string; branchId?: number };

    if (!body.formatTemplate) throw new ValidationError('formatTemplate is required');

    await numberEngine.configure(tenantId, type, body.formatTemplate, body.branchId);
    return reply.code(200).send({ data: { message: 'Number series configured', type, formatTemplate: body.formatTemplate } });
  });

  // ── POST /config/number-series/:type/preview — Preview next number ────────
  fastify.post<{ Params: { type: string } }>('/config/number-series/:type/preview', async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const type = request.params.type.toUpperCase() as SeriesType;

    const next = await numberEngine.preview(tenantId, type);
    return reply.code(200).send({ data: { nextNumber: next, type } });
  });

  // ── Internal: POST /internal/number-series/:type/next — Thread-safe next ──
  // Called by other services (sales, purchase, etc.) to get the next serial number
  fastify.post<{ Params: { type: string } }>('/internal/number-series/:type/next', async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const type = request.params.type.toUpperCase() as SeriesType;
    const body = request.body as { branchId?: number };

    const next = await numberEngine.next(tenantId, type, body.branchId);
    return reply.code(200).send({ data: { number: next } });
  });
}
