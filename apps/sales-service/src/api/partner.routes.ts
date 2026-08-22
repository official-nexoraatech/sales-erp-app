import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';
import { customers, branches, items, quotations, quotationLines } from '@erp/db';
import { z } from 'zod';
import { withTenantConnection } from '@erp/sdk';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { requirePartnerAuth } from '../middleware/partner-auth.js';
import { QuotationService, type QuotationLineInput } from '../domain/QuotationService.js';

// CRM-ROADMAP Phase 4, Feature 6 (Partner/Channel Portal).
//
// Same rules as portal.routes.ts throughout: raw ErpDatabase handle via withTenantConnection,
// never PlatformContextFactory (no partner-actor concept in the audit/event actor model —
// these routes skip ctx.audit.log/ctx.events.publish entirely, same reasoning as the customer
// portal). customerId resolved ONLY from request.partnerAuth.customerId, never a URL/body
// field. An ownership mismatch on a customer-scoped row always returns 404 (NotFoundError),
// never 403 — a 403 would confirm the row exists for a different partner.
//
// POST /partner/orders is the one genuinely new capability beyond the customer portal's own
// view-only surface — a partner places an order by creating a Quotation (not directly an
// Invoice), which staff review/convert through the existing QUOTATION_CONVERT flow rather than
// partners creating GL-impacting invoices unsupervised. Field resolution mirrors
// WhatsAppCommerceService.ts/WhatsAppOrderConsumer.ts's own "fully self-service, no staff
// involved" order-creation precedent (head-office branch/GSTIN resolution, QT-<source>- number
// prefix, validUntil = now+7 days, createdBy: 0 sentinel).
//
// Security-critical: PricingResolutionService only overrides a caller-submitted unitPrice when
// a matching price-list tier exists — if no tier matches, the caller-submitted price is used
// as-is. Safe for trusted staff input, not for an unsupervised partner route. The order-line
// schema below accepts ONLY itemId + quantity — no unitPrice/gstRate/hsnCode/discount fields
// from the client; gstRate/hsnCode are resolved server-side from the items table before calling
// QuotationService.create(), and no client-supplied price is ever passed through.

const OrderLineSchema = z.object({
  itemId: z.number().int().positive(),
  quantity: z.number().positive(),
});

const CreateOrderSchema = z.object({
  lines: z.array(OrderLineSchema).min(1),
  notes: z.string().max(2000).optional(),
});

export async function partnerRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  // ── GET /partner/me ───────────────────────────────────────────────────────
  fastify.get('/partner/me', { preHandler: [requirePartnerAuth] }, async (request, reply) => {
    const { tenantId, customerId } = request.partnerAuth;
    const customer = await withTenantConnection(db, tenantId, async (scopedDb) => {
      const [row] = await scopedDb
        .select({
          id: customers.id,
          displayName: customers.displayName,
          phone: customers.phone,
          email: customers.email,
          customerType: customers.customerType,
        })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
      return row;
    });
    if (!customer) throw new NotFoundError('Customer', customerId);
    return reply.code(200).send({ data: customer });
  });

  // ── GET /partner/orders ───────────────────────────────────────────────────
  fastify.get('/partner/orders', { preHandler: [requirePartnerAuth] }, async (request, reply) => {
    const { tenantId, customerId } = request.partnerAuth;
    const rows = await withTenantConnection(db, tenantId, (scopedDb) =>
      scopedDb
        .select({
          id: quotations.id,
          quotationNumber: quotations.quotationNumber,
          status: quotations.status,
          validUntil: quotations.validUntil,
          grandTotal: quotations.grandTotal,
        })
        .from(quotations)
        .where(and(eq(quotations.customerId, customerId), eq(quotations.tenantId, tenantId)))
        .orderBy(desc(quotations.createdAt))
        .limit(100)
    );
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  // ── GET /partner/orders/:id ───────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/partner/orders/:id',
    { preHandler: [requirePartnerAuth] },
    async (request, reply) => {
      const { tenantId, customerId } = request.partnerAuth;
      const id = parseInt(request.params.id, 10);

      const result = await withTenantConnection(db, tenantId, async (scopedDb) => {
        const [quotation] = await scopedDb
          .select()
          .from(quotations)
          .where(
            and(
              eq(quotations.id, id),
              eq(quotations.tenantId, tenantId),
              eq(quotations.customerId, customerId)
            )
          );
        if (!quotation) return null;

        const lines = await scopedDb
          .select()
          .from(quotationLines)
          .where(eq(quotationLines.quotationId, id));
        return { ...quotation, lines };
      });
      if (!result) throw new NotFoundError('Order', id);

      return reply.code(200).send({ data: result });
    }
  );

  // ── POST /partner/orders ──────────────────────────────────────────────────
  fastify.post('/partner/orders', { preHandler: [requirePartnerAuth] }, async (request, reply) => {
    const { tenantId, customerId } = request.partnerAuth;
    const body = CreateOrderSchema.safeParse(request.body);
    if (!body.success)
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const quotationId = await withTenantConnection(db, tenantId, async (scopedDb) => {
      const [headOffice] = await scopedDb
        .select()
        .from(branches)
        .where(
          and(
            eq(branches.tenantId, tenantId),
            eq(branches.isHeadOffice, true),
            eq(branches.isActive, true)
          )
        );
      if (!headOffice) {
        throw new BusinessError(
          'NO_HEAD_OFFICE',
          'No active head-office branch configured for this tenant'
        );
      }
      if (!headOffice.gstin || headOffice.gstin.length < 2) {
        throw new BusinessError(
          'MISSING_GSTIN',
          'Head-office branch has no GSTIN configured — cannot determine the seller state for GST'
        );
      }
      const sellerStateCode = headOffice.gstin.slice(0, 2);

      const [customer] = await scopedDb
        .select({ billingAddress: customers.billingAddress })
        .from(customers)
        .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)));
      const placeOfSupply = customer?.billingAddress?.stateCode ?? sellerStateCode;

      const itemIds = [...new Set(body.data.lines.map((l) => l.itemId))];
      const itemRows = await scopedDb
        .select({ id: items.id, gstRate: items.gstRate, hsnCode: items.hsnCode })
        .from(items)
        .where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)));
      const itemById = new Map(itemRows.map((r) => [r.id, r]));

      const missingItemId = itemIds.find((id) => !itemById.has(id));
      if (missingItemId !== undefined) throw new NotFoundError('Item', missingItemId);

      // Only itemId/quantity ever come from the client — gstRate/hsnCode resolved server-side,
      // unitPrice deliberately omitted so QuotationService/PricingResolutionService is the sole
      // source of truth for price (see this file's header comment).
      const lines: QuotationLineInput[] = body.data.lines.map((l) => {
        const item = itemById.get(l.itemId)!;
        return {
          itemId: l.itemId,
          quantity: l.quantity,
          gstRate: parseFloat(item.gstRate),
          hsnCode: item.hsnCode ?? undefined,
        };
      });

      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + 7);

      const svc = new QuotationService(scopedDb);
      return svc.create({
        tenantId,
        branchId: headOffice.id,
        customerId,
        quotationNumber: `QT-PTR-${tenantId}-${Date.now()}`,
        placeOfSupply,
        sellerStateCode,
        validUntil,
        lines,
        notes: body.data.notes ?? 'Placed via the Partner Portal',
        createdBy: 0,
      });
    });

    return reply.code(201).send({ data: { id: quotationId } });
  });
}
