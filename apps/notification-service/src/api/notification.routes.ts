import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { notificationLog, notificationPreferences, notificationTemplates } from '@erp/db';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { ValidationError, PERMISSIONS } from '@erp/types';
import { timingSafeEqual } from 'node:crypto';
import { NotificationEngine } from '../domain/NotificationEngine.js';
import type { NotificationServiceConfig } from '../config.js';
import { authenticate, authenticateStream } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const SendSchema = z.object({
  eventType: z.string().min(1),
  recipientUserId: z.number().int().positive().optional(),
  recipientPhone: z.string().optional(),
  recipientEmail: z.string().email().optional(),
  templateData: z.record(z.unknown()).default({}),
  channels: z.array(z.enum(['SMS', 'EMAIL', 'WHATSAPP', 'IN_APP'])).optional(),
  // ES-26 (M8): callers with a natural dedup key (e.g. invoiceId+reminderDate) should pass this
  // instead of relying on the derived tenant+event+recipient+data+time-bucket hash.
  idempotencyKey: z.string().min(1).max(200).optional(),
});

const InternalSendSchema = SendSchema.extend({
  tenantId: z.number().int().positive(),
});

const SendRawInternalSchema = z.object({
  tenantId: z.number().int().positive(),
  eventType: z.string().min(1).default('CRM_CAMPAIGN'),
  channel: z.enum(['SMS', 'EMAIL', 'WHATSAPP', 'IN_APP']),
  recipientPhone: z.string().optional(),
  recipientEmail: z.string().email().optional(),
  subject: z.string().optional(),
  body: z.string().min(1),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

function requireInternalKey(req: { headers: Record<string, string | string[] | undefined> }, reply: { code: (n: number) => { send: (b: unknown) => void } }): boolean {
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

const PreferencesSchema = z.object({
  eventType: z.string().min(1),
  smsEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  whatsappEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  quietHoursEnabled: z.boolean().optional(),
});

type AuthedRequest = { auth: { tenantId: number; userId?: number } };

export async function notificationRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  config: NotificationServiceConfig
): Promise<void> {
  const engine = new NotificationEngine(db, config);

  // ── POST /notifications/send — Send a notification ──────────────────────
  fastify.post('/notifications/send', { preHandler: [authenticate, requirePermission(PERMISSIONS.NOTIFICATION_SEND)] }, async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const body = SendSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const { recipientUserId, recipientPhone, recipientEmail, channels, idempotencyKey, ...rest } = body.data;
    const results = await engine.send({
      tenantId,
      ...rest,
      ...(recipientUserId !== undefined ? { recipientUserId } : {}),
      ...(recipientPhone !== undefined ? { recipientPhone } : {}),
      ...(recipientEmail !== undefined ? { recipientEmail } : {}),
      ...(channels !== undefined ? { channels } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
    return reply.code(200).send({ data: { results } });
  });

  // ── POST /notifications/send-internal — Service-to-service send (no JWT) ─
  fastify.post('/notifications/send-internal', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const body = InternalSendSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const { recipientUserId, recipientPhone, recipientEmail, channels, idempotencyKey, ...rest } = body.data;
    const results = await engine.send({
      ...rest,
      ...(recipientUserId !== undefined ? { recipientUserId } : {}),
      ...(recipientPhone !== undefined ? { recipientPhone } : {}),
      ...(recipientEmail !== undefined ? { recipientEmail } : {}),
      ...(channels !== undefined ? { channels } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
    return reply.code(200).send({ data: { results } });
  });

  // ── POST /notifications/send-raw-internal — Send pre-rendered body (CRM campaigns) ─
  fastify.post('/notifications/send-raw-internal', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const body = SendRawInternalSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const { recipientPhone, recipientEmail, subject, idempotencyKey, ...rest } = body.data;
    const result = await engine.sendRaw({
      ...rest,
      ...(recipientPhone !== undefined ? { recipientPhone } : {}),
      ...(recipientEmail !== undefined ? { recipientEmail } : {}),
      ...(subject !== undefined ? { subject } : {}),
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
    return reply.code(200).send({ data: result });
  });

  // ── POST /notifications/templates/seed-crm — Seed CRM domain templates ───
  fastify.post('/notifications/templates/seed-crm', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const body = z.object({ tenantId: z.number().int().positive(), createdBy: z.number().int().positive().default(0) }).safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const templates = [
      { name: 'Birthday Greeting (WhatsApp)', eventType: 'BIRTHDAY_GREETING', channel: 'WHATSAPP' as const, bodyTemplate: 'Happy Birthday {{customerName}}! 🎉 {{shopName}} wishes you a wonderful year ahead. Visit us for a special birthday surprise!' },
      { name: 'Birthday Greeting (SMS fallback)', eventType: 'BIRTHDAY_GREETING', channel: 'SMS' as const, bodyTemplate: 'Happy Birthday {{customerName}}! {{shopName}} wishes you a great year. Visit us for a special offer.' },
    ];

    let count = 0;
    for (const t of templates) {
      const [inserted] = await db
        .insert(notificationTemplates)
        .values({ tenantId: body.data.tenantId, createdBy: body.data.createdBy, isSystem: true, ...t })
        .onConflictDoNothing()
        .returning();
      if (inserted) count++;
    }

    return reply.code(200).send({ data: { message: 'CRM templates seeded', count } });
  });

  // ── POST /notifications/templates/seed-hr — Seed HR domain templates ─────
  fastify.post('/notifications/templates/seed-hr', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const body = z.object({ tenantId: z.number().int().positive(), createdBy: z.number().int().positive().default(0) }).safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const templates = [
      { name: 'Alteration Ready', eventType: 'ALTERATION_READY', channel: 'WHATSAPP' as const, bodyTemplate: 'Hi {{customerName}}, your alteration is ready. Ref: {{orderNumber}}', isSystem: true },
      { name: 'Alteration Assigned', eventType: 'ALTERATION_ASSIGNED', channel: 'IN_APP' as const, bodyTemplate: 'You have been assigned alteration order {{orderNumber}}', isSystem: true },
    ];

    let count = 0;
    for (const t of templates) {
      const [inserted] = await db
        .insert(notificationTemplates)
        .values({ tenantId: body.data.tenantId, createdBy: body.data.createdBy, ...t })
        .onConflictDoNothing()
        .returning();
      if (inserted) count++;
    }

    return reply.code(200).send({ data: { message: 'HR templates seeded', count } });
  });

  // ── POST /notifications/templates/seed-auth — Seed Auth domain templates ─
  fastify.post('/notifications/templates/seed-auth', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const body = z.object({ tenantId: z.number().int().positive(), createdBy: z.number().int().positive().default(0) }).safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const templates = [
      {
        name: 'Password Reset',
        eventType: 'PASSWORD_RESET_REQUESTED',
        channel: 'EMAIL' as const,
        subject: 'Reset your password',
        bodyTemplate: '<p>We received a request to reset your password.</p><p><a href="{{resetLink}}">Click here to reset your password</a></p><p>If you did not request this, you can safely ignore this email.</p>',
        isSystem: true,
      },
    ];

    let count = 0;
    for (const t of templates) {
      const [inserted] = await db
        .insert(notificationTemplates)
        .values({ tenantId: body.data.tenantId, createdBy: body.data.createdBy, ...t })
        .onConflictDoNothing()
        .returning();
      if (inserted) count++;
    }

    return reply.code(200).send({ data: { message: 'Auth templates seeded', count } });
  });

  // ── POST /notifications/templates/seed-tenant — Seed tenant-provisioning templates ─
  // PG-026: WELCOME_EMAIL was never seeded anywhere — TenantProvisioner's welcome-email
  // step called a nonexistent endpoint with a mismatched body shape, so even fixing the
  // call itself would still have silently no-op'd without a template row to look up.
  fastify.post('/notifications/templates/seed-tenant', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const body = z.object({ tenantId: z.number().int().positive(), createdBy: z.number().int().positive().default(0) }).safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const templates = [
      {
        name: 'Welcome Email',
        eventType: 'WELCOME_EMAIL',
        channel: 'EMAIL' as const,
        subject: 'Welcome to {{tenantName}}',
        bodyTemplate: '<p>Hi {{firstName}},</p><p>Welcome to {{tenantName}}! Your account has been created and is ready to use.</p>',
        isSystem: true,
      },
    ];

    let count = 0;
    for (const t of templates) {
      const [inserted] = await db
        .insert(notificationTemplates)
        .values({ tenantId: body.data.tenantId, createdBy: body.data.createdBy, ...t })
        .onConflictDoNothing()
        .returning();
      if (inserted) count++;
    }

    return reply.code(200).send({ data: { message: 'Tenant-provisioning templates seeded', count } });
  });

  // ── GET /notifications — List in-app notifications for current user ──────
  fastify.get('/notifications', { preHandler: authenticate }, async (request, reply) => {
    const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;
    const query = (request.query as { page?: string; size?: string });
    const page = parseInt(query.page ?? '0', 10);
    const size = Math.min(parseInt(query.size ?? '20', 10), 100);

    const items = await db
      .select()
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.tenantId, tenantId),
          eq(notificationLog.recipientUserId, userId),
          eq(notificationLog.channel, 'IN_APP')
        )
      )
      .orderBy(desc(notificationLog.createdAt))
      .limit(size)
      .offset(page * size);

    const unreadCount = await engine.getUnreadCount(tenantId, userId);

    return reply.code(200).send({
      data: { content: items, unreadCount, page, size },
    });
  });

  // ── POST /notifications/:id/read — Mark in-app notification as read ──────
  fastify.post<{ Params: { id: string } }>('/notifications/:id/read', { preHandler: authenticate }, async (request, reply) => {
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const id = parseInt(request.params.id, 10);

    await db
      .update(notificationLog)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notificationLog.id, id), eq(notificationLog.tenantId, tenantId)));

    return reply.code(200).send({ data: { message: 'Marked as read' } });
  });

  // ── POST /notifications/preferences — Update per-user channel prefs ──────
  fastify.post('/notifications/preferences', { preHandler: authenticate }, async (request, reply) => {
    const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;
    const body = PreferencesSchema.safeParse(request.body);
    if (!body.success) throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    await db
      .insert(notificationPreferences)
      .values({
        tenantId,
        userId,
        eventType: body.data.eventType,
        smsEnabled: body.data.smsEnabled ?? true,
        emailEnabled: body.data.emailEnabled ?? true,
        whatsappEnabled: body.data.whatsappEnabled ?? false,
        inAppEnabled: body.data.inAppEnabled ?? true,
        quietHoursEnabled: body.data.quietHoursEnabled ?? true,
        createdBy: userId,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.userId,
          notificationPreferences.eventType,
          notificationPreferences.tenantId,
        ],
        set: {
          smsEnabled: body.data.smsEnabled ?? true,
          emailEnabled: body.data.emailEnabled ?? true,
          whatsappEnabled: body.data.whatsappEnabled ?? false,
          inAppEnabled: body.data.inAppEnabled ?? true,
          quietHoursEnabled: body.data.quietHoursEnabled ?? true,
          updatedAt: new Date(),
        },
      });

    return reply.code(200).send({ data: { message: 'Preferences saved' } });
  });

  // ── GET /notifications/unread-count — Fast unread bell count ─────────────
  fastify.get('/notifications/unread-count', { preHandler: authenticate }, async (request, reply) => {
    const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;
    const count = await engine.getUnreadCount(tenantId, userId);
    return reply.code(200).send({ data: { count } });
  });

  // ── SSE: GET /notifications/stream — Real-time in-app push ───────────────
  fastify.get('/notifications/stream', { preHandler: authenticateStream }, async (request, reply) => {
    const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial heartbeat
    reply.raw.write('data: {"type":"connected"}\n\n');

    // Poll every 5 seconds for new notifications
    const interval = setInterval(async () => {
      try {
        const count = await engine.getUnreadCount(tenantId, userId);
        reply.raw.write(`data: ${JSON.stringify({ type: 'unread_count', count })}\n\n`);
      } catch {
        clearInterval(interval);
      }
    }, 5000);

    request.raw.on('close', () => {
      clearInterval(interval);
    });

    await new Promise<void>((resolve) => request.raw.on('close', resolve));
  });
}
