import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { SupplierPaymentService } from '../domain/SupplierPaymentService.js';

async function checkInternalKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = req.headers['x-internal-key'];
  if (!key || key !== process.env['INTERNAL_API_KEY']) {
    await reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Invalid internal API key' } });
  }
}

export async function internalRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.post('/purchase/pdc-alerts', {
    preHandler: checkInternalKey,
    handler: async (req, reply) => {
      const q = req.query as { tenantId?: string };
      if (!q.tenantId) {
        return reply.code(400).send({ error: { code: 'MISSING_TENANT', message: 'tenantId required' } });
      }
      const tenantId = parseInt(q.tenantId, 10);
      const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: crypto.randomUUID() });
      const svc = new SupplierPaymentService(ctx.db.raw);

      const due = await svc.getPdcDueInDays(tenantId, 3);
      for (const pdc of due) {
        await svc.markPdcAlertSent(pdc.id);
      }

      return reply.send({ data: { processed: due.length } });
    },
  });
}
