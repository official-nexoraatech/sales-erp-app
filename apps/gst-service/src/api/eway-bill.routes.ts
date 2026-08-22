import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { tenantScopedHandler, withTenantConnection } from '@erp/sdk';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { tenants } from '@erp/db';
import { eq } from 'drizzle-orm';
import { ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { EwayBillService } from '../domain/EwayBillService.js';
import type { EwayBillPayload } from '../domain/EwayBillService.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

// Same x-internal-key + timingSafeEqual convention as gstr3b.routes.ts's requireInternalKey.
function requireInternalKey(
  req: { headers: Record<string, string | string[] | undefined> },
  reply: { code: (n: number) => { send: (b: unknown) => void } }
): boolean {
  const key = req.headers['x-internal-key'];
  const expected = process.env['INTERNAL_API_KEY'];
  const keyBuffer = Buffer.from(typeof key === 'string' ? key : '');
  const expectedBuffer = Buffer.from(expected ?? '');
  const matches =
    !!expected &&
    keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);
  if (!matches) {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    return false;
  }
  return true;
}

const ItemSchema = z.object({
  productName: z.string().min(1),
  hsnCode: z.string().regex(/^\d{4,8}$/),
  quantity: z.number().min(0),
  qtyUnit: z.string(),
  cgstRate: z.number().min(0),
  sgstRate: z.number().min(0),
  igstRate: z.number().min(0),
  cessRate: z.number().optional(),
  taxableAmount: z.number().min(0),
  productDesc: z.string().optional(),
});

const GenerateEwbSchema = z.object({
  invoiceId: z.number().int().positive(),
  payload: z.object({
    supplyType: z.enum(['O', 'I']),
    subSupplyType: z.string(),
    docType: z.enum(['INV', 'BIL', 'BOE', 'CNT', 'CHL', 'OTH']),
    docNo: z.string().max(16),
    docDate: z.string(),
    fromGstin: z.string().length(15),
    fromTrdName: z.string(),
    fromAddr1: z.string(),
    fromAddr2: z.string().optional(),
    fromPlace: z.string(),
    fromPincode: z.number().int(),
    fromStateCode: z.number().int(),
    toGstin: z.string().length(15),
    toTrdName: z.string(),
    toAddr1: z.string(),
    toAddr2: z.string().optional(),
    toPlace: z.string(),
    toPincode: z.number().int(),
    toStateCode: z.number().int(),
    totalValue: z.number().min(0),
    cgstValue: z.number().min(0),
    sgstValue: z.number().min(0),
    igstValue: z.number().min(0),
    cessValue: z.number().min(0),
    transMode: z.enum(['1', '2', '3', '4']),
    vehicleNo: z.string().optional(),
    vehicleType: z.enum(['R', 'O']).optional(),
    transporterGstin: z.string().optional(),
    transporterName: z.string().optional(),
    transDocNo: z.string().optional(),
    itemList: z.array(ItemSchema).min(1),
  }),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21 for the two pure-DB-read routes.
// POST /gst/eway-bill/generate not migrated to tenantScopedHandler — EwayBillService.generate()
// makes a real NIC e-Way Bill API call interleaved with DB work (caveat 4). RLS-readiness
// follow-up (2026-08-22): fixed one level down in EwayBillService instead (every DB call there
// now goes through db.transaction(), which sets the GUC itself regardless of how ctx.db's
// underlying connection was built — see EInvoiceService's identical fix for the full reasoning),
// so ctx = ctxFactory.create({...}) without a dbOverride here is safe as-is.
export async function ewayBillRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // POST /gst/eway-bill/generate
  fastify.post(
    '/gst/eway-bill/generate',
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.EWAY_BILL_GENERATE)],
    },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const body = GenerateEwbSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const result = await EwayBillService.generate(
        ctx.db,
        tenantId,
        userId,
        body.data.invoiceId,
        body.data.payload as EwayBillPayload,
        ctx.tenant.correlationId
      );

      // ES-28 [M16-b]: EWAY_BILL_GENERATED is now published inside the same
      // transaction as the state-transition write (see EwayBillService.generate).
      await ctx.audit.log({
        action: 'EWAY_BILL_GENERATED',
        entityType: 'INVOICE',
        entityId: body.data.invoiceId,
        after: result as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: result });
    }
  );

  // GET /gst/eway-bill/expiring-soon
  fastify.get(
    '/gst/eway-bill/expiring-soon',
    {
      preHandler: [authenticate, requirePermission(PERMISSIONS.GST_VIEW)],
    },
    tenantScopedHandler(ctxFactory, async (request, reply, ctx) => {
      const { tenantId } = ctx.tenant;
      const expiring = await EwayBillService.getExpiringSoon(ctx.db, tenantId);
      return reply.code(200).send({ data: { content: expiring, totalElements: expiring.length } });
    })
  );

  // POST /gst/eway-bill/expiry-alert — scheduler-triggered (x-internal-key), notification-service
  // audit 2026-07-23, bug #5: scheduler-service's gst.eway-bill-expiry-alert job called the
  // JWT-only GET route above with only an x-internal-key header, so it 401'd on every run — the
  // job's try/catch swallowed that into a non-fatal warn log. Even with auth fixed, the handler
  // never notified anyone (log-only). This is a dedicated internal route, same shape as
  // gstr3b.routes.ts's /gst/gstr3b/reminder, that both authenticates correctly and actually
  // dispatches a notification when e-Way Bills are expiring soon.
  fastify.post('/gst/eway-bill/expiry-alert', {
    handler: async (request, reply) => {
      if (!requireInternalKey(request as never, reply as never)) return;
      const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
      if (!tenantId) {
        return reply
          .code(400)
          .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });
      }

      const { expiring, contactEmail } = await withTenantConnection(
        ctxFactory.rawDb,
        tenantId,
        async (db) => {
          const ctx = ctxFactory.create(
            { tenantId, userId: 0, correlationId: crypto.randomUUID() },
            db
          );
          const expiring = await EwayBillService.getExpiringSoon(ctx.db, tenantId);
          let contactEmail: string | null = null;
          if (expiring.length > 0) {
            const [tenant] = await ctx.db.raw
              .select({ contactEmail: tenants.contactEmail })
              .from(tenants)
              .where(eq(tenants.id, tenantId));
            contactEmail = tenant?.contactEmail ?? null;
          }
          return { expiring, contactEmail };
        }
      );

      let sent = false;
      if (expiring.length > 0) {
        if (contactEmail) {
          const notificationUrl =
            process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
          const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
          try {
            await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
              body: JSON.stringify({
                tenantId,
                eventType: 'EWAY_BILL_EXPIRY_ALERT',
                channel: 'EMAIL',
                recipientEmail: contactEmail,
                subject: `${expiring.length} e-Way Bill(s) expiring within 24 hours`,
                body: `The following e-Way Bill(s) expire within 24 hours: ${expiring
                  .map((e) => `${e.ewbNumber} (invoice ${e.invoiceNumber})`)
                  .join(', ')}`,
              }),
            });
            sent = true;
          } catch {
            // best-effort
          }
        }
      }

      return reply.code(200).send({ data: { totalElements: expiring.length, sent } });
    },
  });
}
