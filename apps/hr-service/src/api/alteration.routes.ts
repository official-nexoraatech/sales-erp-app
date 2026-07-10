import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { alterationOrders, employees } from '@erp/db';
import { and, eq, isNull, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

type AuthedRequest = { auth: { tenantId: number; userId: number } };

const ALTERATION_STATUSES = ['RECEIVED', 'ASSIGNED', 'IN_PROGRESS', 'QUALITY_CHECK', 'READY', 'DELIVERED', 'CANCELLED'] as const;

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  RECEIVED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['QUALITY_CHECK', 'CANCELLED'],
  QUALITY_CHECK: ['READY', 'IN_PROGRESS', 'CANCELLED'],
  READY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

const CreateAlterationSchema = z.object({
  branchId: z.number().int().positive().optional(),
  customerId: z.number().int().positive().optional(),
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().min(10).max(20),
  receivedDate: z.string().max(10),
  promisedDate: z.string().max(10),
  items: z.array(z.object({
    description: z.string().min(1).max(500),
    quantity: z.number().positive(),
    rate: z.number().min(0),
    amount: z.number().min(0),
  })).min(1),
  advanceAmount: z.number().min(0).default(0),
  notes: z.string().max(2000).optional(),
});

const UpdateAlterationSchema = CreateAlterationSchema.extend({
  version: z.number().int().min(0),
});

const AssignAlterationSchema = z.object({
  tailorId: z.number().int().positive(),
});

const UpdateStatusSchema = z.object({
  status: z.enum(ALTERATION_STATUSES),
});

const DeliverAlterationSchema = z.object({
  paymentAmount: z.number().min(0),
});

function generateOrderNumber(id: number): string {
  return `ALT-${String(id).padStart(4, '0')}`;
}

async function sendNotification(input: {
  tenantId: number;
  eventType: string;
  recipientUserId?: number;
  recipientPhone?: string;
  templateData: Record<string, unknown>;
  channels: Array<'SMS' | 'EMAIL' | 'WHATSAPP' | 'IN_APP'>;
}): Promise<void> {
  const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
  const apiKey = process.env['INTERNAL_API_KEY'] ?? '';
  try {
    await fetch(`${notificationUrl}/notifications/send-internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': apiKey },
      body: JSON.stringify(input),
    });
  } catch {
    // Non-fatal: notification delivery failure must not block the alteration workflow
  }
}

export async function alterationRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.get('/alterations', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const q = request.query as { status?: string; assignedToId?: string };
    const conditions = [eq(alterationOrders.tenantId, tenantId)];
    if (q.status) conditions.push(eq(alterationOrders.status, q.status as typeof alterationOrders.$inferSelect['status']));
    if (q.assignedToId) conditions.push(eq(alterationOrders.assignedToId, parseInt(q.assignedToId, 10)));
    const rows = await ctx.db.raw.select().from(alterationOrders).where(and(...conditions));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.get<{ Params: { id: string } }>('/alterations/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const [order] = await ctx.db.raw.select().from(alterationOrders).where(and(eq(alterationOrders.id, id), eq(alterationOrders.tenantId, tenantId)));
    if (!order) throw new NotFoundError('AlterationOrder', id);
    return reply.code(200).send({ data: order });
  });

  fastify.post('/alterations', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_CREATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const body = CreateAlterationSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const totalAmount = body.data.items.reduce((sum, i) => sum + i.amount, 0);
    const balanceDue = Math.max(0, totalAmount - body.data.advanceAmount);

    const [created] = await ctx.db.raw
      .insert(alterationOrders)
      .values({
        tenantId,
        createdBy: userId,
        orderNumber: 'ALT-TEMP',
        branchId: body.data.branchId,
        customerId: body.data.customerId,
        customerName: body.data.customerName,
        customerPhone: body.data.customerPhone,
        receivedDate: body.data.receivedDate,
        promisedDate: body.data.promisedDate,
        items: body.data.items,
        totalAmount: String(totalAmount),
        advanceAmount: String(body.data.advanceAmount),
        balanceDue: String(balanceDue),
        notes: body.data.notes,
        status: 'RECEIVED',
      } as typeof alterationOrders.$inferInsert)
      .returning();

    if (!created) throw new Error('Alteration order insert failed');

    const orderNumber = generateOrderNumber(created.id);
    const [final] = await ctx.db.raw.update(alterationOrders).set({ orderNumber }).where(eq(alterationOrders.id, created.id)).returning();

    await ctx.events.publish('alteration_order', created.id, 'ALTERATION_RECEIVED', { alterationOrderId: created.id, tenantId, orderNumber });
    await ctx.audit.log({ action: 'CREATE', entityType: 'alteration_order', entityId: created.id });

    return reply.code(201).send({ data: final });
  });

  fastify.put<{ Params: { id: string } }>('/alterations/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const body = UpdateAlterationSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw.select().from(alterationOrders).where(and(eq(alterationOrders.id, id), eq(alterationOrders.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('AlterationOrder', id);
    if (existing.status === 'DELIVERED' || existing.status === 'CANCELLED') {
      throw new BusinessError('ALTERATION_LOCKED', `Cannot update a ${existing.status} alteration order`);
    }

    const totalAmount = body.data.items.reduce((sum, i) => sum + i.amount, 0);
    const balanceDue = Math.max(0, totalAmount - body.data.advanceAmount);

    const result = await ctx.db.raw
      .update(alterationOrders)
      .set({
        ...body.data,
        totalAmount: String(totalAmount),
        advanceAmount: String(body.data.advanceAmount),
        balanceDue: String(balanceDue),
        updatedAt: new Date(),
        version: existing.version + 1,
      } as unknown as Partial<typeof alterationOrders.$inferInsert>)
      .where(and(eq(alterationOrders.id, id), eq(alterationOrders.version, body.data.version)))
      .returning();

    if (!result[0]) throw new BusinessError('OPTIMISTIC_LOCK_CONFLICT', 'Alteration order was modified concurrently');
    await ctx.audit.log({ action: 'UPDATE', entityType: 'alteration_order', entityId: id });
    return reply.code(200).send({ data: result[0] });
  });

  fastify.post<{ Params: { id: string } }>('/alterations/:id/assign', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const body = AssignAlterationSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw.select().from(alterationOrders).where(and(eq(alterationOrders.id, id), eq(alterationOrders.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('AlterationOrder', id);

    const [tailor] = await ctx.db.raw.select({ id: employees.id }).from(employees).where(and(eq(employees.id, body.data.tailorId), eq(employees.tenantId, tenantId), isNull(employees.deletedAt)));
    if (!tailor) throw new NotFoundError('Employee', body.data.tailorId);

    if (!ALLOWED_TRANSITIONS[existing.status]?.includes('ASSIGNED') && existing.status !== 'RECEIVED') {
      throw new BusinessError('INVALID_STATUS_TRANSITION', `Cannot assign a ${existing.status} alteration order`);
    }

    await ctx.db.raw.update(alterationOrders).set({ assignedToId: body.data.tailorId, status: 'ASSIGNED', updatedAt: new Date() }).where(eq(alterationOrders.id, id));

    await ctx.events.publish('alteration_order', id, 'ALTERATION_ASSIGNED', { alterationOrderId: id, tailorId: body.data.tailorId, tenantId });
    await ctx.audit.log({ action: 'UPDATE', entityType: 'alteration_order', entityId: id, metadata: { action: 'ASSIGN', tailorId: body.data.tailorId } });

    await sendNotification({
      tenantId,
      eventType: 'ALTERATION_ASSIGNED',
      channels: ['IN_APP'],
      templateData: { orderNumber: existing.orderNumber, alterationOrderId: id },
    });

    return reply.code(200).send({ data: { message: 'Assigned', id, tailorId: body.data.tailorId } });
  });

  fastify.post<{ Params: { id: string } }>('/alterations/:id/status', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const body = UpdateStatusSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw.select().from(alterationOrders).where(and(eq(alterationOrders.id, id), eq(alterationOrders.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('AlterationOrder', id);

    const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(body.data.status)) {
      throw new BusinessError('INVALID_STATUS_TRANSITION', `Cannot transition from ${existing.status} to ${body.data.status}`);
    }

    const updates: Partial<typeof alterationOrders.$inferInsert> = { status: body.data.status, updatedAt: new Date() };
    if (body.data.status === 'READY') updates.readyNotifiedAt = new Date();

    await ctx.db.raw.update(alterationOrders).set(updates).where(eq(alterationOrders.id, id));

    if (body.data.status === 'READY') {
      await ctx.events.publish('alteration_order', id, 'ALTERATION_READY', { alterationOrderId: id, tenantId, orderNumber: existing.orderNumber, customerPhone: existing.customerPhone, customerName: existing.customerName });
      await sendNotification({
        tenantId,
        eventType: 'ALTERATION_READY',
        recipientPhone: existing.customerPhone,
        channels: ['WHATSAPP'],
        templateData: {
          customerName: existing.customerName,
          orderNumber: existing.orderNumber,
          message: `Your alteration is ready. Ref: ${existing.orderNumber}`,
        },
      });
    } else {
      await ctx.events.publish('alteration_order', id, 'ALTERATION_STATUS_CHANGED', { alterationOrderId: id, tenantId, status: body.data.status });
    }
    await ctx.audit.log({ action: 'UPDATE', entityType: 'alteration_order', entityId: id, metadata: { action: 'STATUS_CHANGE', from: existing.status, to: body.data.status } });

    return reply.code(200).send({ data: { message: 'Status updated', id, status: body.data.status } });
  });

  fastify.post<{ Params: { id: string } }>('/alterations/:id/deliver', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_UPDATE)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const id = parseInt(request.params.id, 10);
    const body = DeliverAlterationSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const [existing] = await ctx.db.raw.select().from(alterationOrders).where(and(eq(alterationOrders.id, id), eq(alterationOrders.tenantId, tenantId)));
    if (!existing) throw new NotFoundError('AlterationOrder', id);
    if (existing.status !== 'READY') throw new BusinessError('ALTERATION_NOT_READY', 'Alteration order must be READY before delivery');

    const balanceDue = parseFloat(existing.balanceDue);
    if (body.data.paymentAmount < balanceDue) {
      throw new BusinessError('INSUFFICIENT_PAYMENT', `Payment ${body.data.paymentAmount} is less than balance due ${balanceDue}`);
    }

    await ctx.db.raw.update(alterationOrders).set({
      status: 'DELIVERED',
      deliveredAt: new Date(),
      deliveryPaymentReceived: String(body.data.paymentAmount),
      balanceDue: '0',
      updatedAt: new Date(),
    }).where(eq(alterationOrders.id, id));

    await ctx.events.publish('alteration_order', id, 'ALTERATION_DELIVERED', { alterationOrderId: id, tenantId, paymentAmount: body.data.paymentAmount });
    await ctx.audit.log({ action: 'UPDATE', entityType: 'alteration_order', entityId: id, metadata: { action: 'DELIVER', paymentAmount: body.data.paymentAmount } });

    return reply.code(200).send({ data: { message: 'Delivered', id } });
  });

  fastify.get<{ Params: { id: string } }>('/alterations/tailor/:id', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const tailorId = parseInt(request.params.id, 10);
    const rows = await ctx.db.raw
      .select()
      .from(alterationOrders)
      .where(and(eq(alterationOrders.tenantId, tenantId), eq(alterationOrders.assignedToId, tailorId), ne(alterationOrders.status, 'DELIVERED'), ne(alterationOrders.status, 'CANCELLED')));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });

  fastify.get('/alterations/overdue', { preHandler: [authenticate, requirePermission(PERMISSIONS.ALTERATION_VIEW)] }, async (request, reply) => {
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const ctx = ctxFactory.create({ tenantId, userId, correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID() });
    const today = new Date().toISOString().slice(0, 10);
    const rows = await ctx.db.raw
      .select()
      .from(alterationOrders)
      .where(and(
        eq(alterationOrders.tenantId, tenantId),
        lt(alterationOrders.promisedDate, today),
        ne(alterationOrders.status, 'DELIVERED'),
        ne(alterationOrders.status, 'CANCELLED'),
      ));
    return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
  });
}
