/* global process, crypto, fetch */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { timingSafeEqual } from 'node:crypto';
import { items, tenants, stockValuationSnapshots } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { InventoryLedgerService } from '../domain/InventoryLedgerService.js';

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

interface LedgerRequestBody {
  type: 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT';
  itemId: number;
  variantId?: number;
  warehouseId: number;
  quantity: number;
  unitCost?: number;
  referenceType?: string;
  referenceId?: number;
  tenantId: number;
  createdBy: number;
}

// POST /internal/ledger — record a stock movement from another service.
// NOT protected by JWT authenticate — internal-only, guarded by x-internal-key
// (see network policy / INTERNAL_API_KEY). Kept for callers that cannot share a
// Drizzle transaction with inventory-service (see ES-03 completion report for
// which call sites use this route vs. a same-transaction direct write).
export async function internalRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.post('/internal/ledger', {
    preHandler: checkInternalKey,
    handler: async (req, reply) => {
      const body = req.body as LedgerRequestBody;
      const ctx = ctxFactory.create({ tenantId: body.tenantId, userId: body.createdBy, correlationId: crypto.randomUUID() });
      const svc = new InventoryLedgerService(ctx.db.raw);

      const params = {
        tenantId: body.tenantId,
        itemId: body.itemId,
        ...(body.variantId !== undefined && { variantId: body.variantId }),
        warehouseId: body.warehouseId,
        quantity: body.quantity,
        ...(body.referenceType !== undefined && { referenceType: body.referenceType }),
        ...(body.referenceId !== undefined && { referenceId: body.referenceId }),
        ...(body.unitCost !== undefined && { unitCost: body.unitCost }),
        createdBy: body.createdBy,
      };

      if (body.type === 'STOCK_IN') {
        await svc.addStock(params);
      } else if (body.type === 'STOCK_OUT') {
        await svc.deductStock(params);
      } else {
        await svc.adjustStock({ ...params, direction: 'IN' });
      }

      return reply.code(200).send({ data: { recorded: true } });
    },
  });

  // ── POST /internal/inventory/valuation-snapshot?tenantId=... — PG-026 ────
  // Same live-valuation query as valuation.routes.ts's GET /inventory/valuation
  // (tenant-wide, not per-warehouse), persisted as a daily snapshot row.
  fastify.post('/internal/inventory/valuation-snapshot', { preHandler: checkInternalKey }, async (request, reply) => {
    const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
    if (!tenantId) return reply.code(400).send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

    const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: 'system' });
    const rows = await ctx.db.raw
      .select({ currentStockValue: items.currentStockValue })
      .from(items)
      .where(and(eq(items.tenantId, tenantId), eq(items.trackInventory, true)));

    const totalStockValue = rows.reduce((sum, r) => sum + parseFloat(String(r.currentStockValue ?? 0)), 0);
    const asOfDate = new Date().toISOString().slice(0, 10);

    await ctx.db.raw
      .insert(stockValuationSnapshots)
      .values({ tenantId, asOfDate, totalStockValue: totalStockValue.toFixed(2), itemCount: rows.length })
      .onConflictDoUpdate({
        target: [stockValuationSnapshots.tenantId, stockValuationSnapshots.asOfDate],
        set: { totalStockValue: totalStockValue.toFixed(2), itemCount: rows.length },
      });

    return reply.code(200).send({ data: { asOfDate, totalStockValue, itemCount: rows.length } });
  });

  // ── POST /internal/inventory/physical-verification-reminder?tenantId=... ─
  // No verification-cycle/"next due" concept exists anywhere in this schema yet
  // (physical_verifications only tracks manual DRAFT→APPROVED runs) — this is an
  // unconditional monthly reminder, matching platform.dr-drill-reminder's shape.
  fastify.post('/internal/inventory/physical-verification-reminder', { preHandler: checkInternalKey }, async (request, reply) => {
    const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
    if (!tenantId) return reply.code(400).send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });

    const ctx = ctxFactory.create({ tenantId, userId: 0, correlationId: 'system' });
    const [tenant] = await ctx.db.raw.select({ contactEmail: tenants.contactEmail }).from(tenants).where(eq(tenants.id, tenantId));

    let sent = false;
    if (tenant?.contactEmail) {
      const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
      const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
      try {
        await fetch(`${notificationUrl}/notifications/send-raw-internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
          body: JSON.stringify({
            tenantId,
            eventType: 'PHYSICAL_VERIFICATION_REMINDER',
            channel: 'EMAIL',
            recipientEmail: tenant.contactEmail,
            subject: 'Monthly physical stock verification reminder',
            body: 'It is time for the monthly physical stock verification cycle. Start a new verification run from Inventory > Physical Verification.',
          }),
        });
        sent = true;
      } catch {
        // best-effort
      }
    }

    return reply.code(200).send({ data: { sent } });
  });
}
