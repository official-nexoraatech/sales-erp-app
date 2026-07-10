import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory, SagaOrchestrator, SagaStepFactory, GstComplianceContext } from '@erp/sdk';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ValidationError } from '@erp/types';
import type { ErpDatabase } from '@erp/db';
import { createGstComplianceRealDeps, runGstComplianceSaga } from '../domain/GstComplianceSaga.js';

// Same x-internal-key + timingSafeEqual convention as every other internal.routes.ts
// in this codebase (e.g. apps/sales-service/src/api/internal.routes.ts).
function requireInternalKey(
  req: { headers: Record<string, string | string[] | undefined> },
  reply: { code: (n: number) => { send: (b: unknown) => void } }
): boolean {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches = !!expected && keyBuffer.length === expectedBuffer.length && timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

const ComplianceActionSchema = z.object({
  tenantId: z.number().int().positive(),
  userId: z.number().int().nonnegative(),
  correlationId: z.string().min(1),
});

export async function internalRoutes(
  fastify: FastifyInstance,
  _ctxFactory: PlatformContextFactory,
  sagaHandle: { orchestrator: SagaOrchestrator; factory: SagaStepFactory<GstComplianceContext> },
  rawDb: ErpDatabase
): Promise<void> {
  const deps = createGstComplianceRealDeps(rawDb);

  // Starts the GST_COMPLIANCE_GENERATION saga for an invoice — used by operators (via
  // the admin console) or, going forward, optionally by sales-service as a
  // non-blocking fire-and-forget call after invoice confirmation.
  fastify.post<{ Params: { invoiceId: string } }>('/internal/invoices/:invoiceId/gst-compliance', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;

      const body = ComplianceActionSchema.safeParse(req.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const invoiceId = parseInt(req.params.invoiceId, 10);
      const result = await runGstComplianceSaga(
        sagaHandle.orchestrator,
        sagaHandle.factory,
        body.data.tenantId,
        body.data.userId,
        body.data.correlationId,
        invoiceId
      );

      return reply.code(202).send({ data: { sagaId: result.sagaId, status: 'STARTED' } });
    },
  });

  // The following three routes exist solely so event-service's registered factory
  // (apps/event-service/src/sagas/gstComplianceProxy.ts) has something real to call
  // during retry()/compensate() — event-service holds no NIC credentials itself.
  fastify.post<{ Params: { invoiceId: string } }>('/internal/gst-compliance/:invoiceId/actions/generate-irn', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const body = ComplianceActionSchema.safeParse(req.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await deps.generateIrn({
        tenantId: body.data.tenantId,
        userId: body.data.userId,
        correlationId: body.data.correlationId,
        invoiceId: parseInt(req.params.invoiceId, 10),
      });
      return reply.code(200).send({ data: { ok: true } });
    },
  });

  fastify.post<{ Params: { invoiceId: string } }>('/internal/gst-compliance/:invoiceId/actions/cancel-irn', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const body = ComplianceActionSchema.safeParse(req.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await deps.cancelIrn({
        tenantId: body.data.tenantId,
        userId: body.data.userId,
        correlationId: body.data.correlationId,
        invoiceId: parseInt(req.params.invoiceId, 10),
      });
      return reply.code(200).send({ data: { ok: true } });
    },
  });

  fastify.post<{ Params: { invoiceId: string } }>('/internal/gst-compliance/:invoiceId/actions/generate-eway-bill', {
    handler: async (req, reply) => {
      if (!requireInternalKey(req as never, reply as never)) return;
      const body = ComplianceActionSchema.safeParse(req.body);
      if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      await deps.generateEwayBill({
        tenantId: body.data.tenantId,
        userId: body.data.userId,
        correlationId: body.data.correlationId,
        invoiceId: parseInt(req.params.invoiceId, 10),
      });
      return reply.code(200).send({ data: { ok: true } });
    },
  });
}
