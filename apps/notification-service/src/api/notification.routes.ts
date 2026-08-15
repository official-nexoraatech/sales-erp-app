import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import type { ErpDatabase } from '@erp/db';
import {
  notificationLog,
  notificationPreferences,
  notificationTemplates,
  tenantCommunicationSettings,
} from '@erp/db';
import { eq, and, desc, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ValidationError, PERMISSIONS } from '@erp/types';
import { timingSafeEqual } from 'node:crypto';
import { NotificationEngine } from '../domain/NotificationEngine.js';
import type { DeliveryEnqueuer } from '../domain/DeliveryQueue.js';
import { authenticate, authenticateStream } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import {
  checkTenantNotificationRateLimit,
  DEFAULT_NOTIFICATION_RATE_LIMIT_PER_MINUTE,
} from '../domain/tenantRateLimit.js';

// Notification Center deep-link metadata, shared by every send-style schema below.
const NotificationMetaFields = {
  entityType: z.string().min(1).max(50).optional(),
  entityId: z.number().int().positive().optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).optional(),
  businessCategory: z
    .enum(['APPROVAL', 'SALES', 'CRM', 'INVENTORY', 'FINANCE', 'WORKFLOW', 'SYSTEM'])
    .optional(),
  metadata: z.record(z.unknown()).optional(),
};

const SendSchema = z.object({
  eventType: z.string().min(1),
  recipientUserId: z.number().int().positive().optional(),
  recipientPhone: z.string().optional(),
  recipientEmail: z.string().email().optional(),
  templateData: z.record(z.unknown()).default({}),
  channels: z.array(z.enum(['SMS', 'EMAIL', 'WHATSAPP', 'IN_APP', 'INSTAGRAM'])).optional(),
  // ES-26 (M8): callers with a natural dedup key (e.g. invoiceId+reminderDate) should pass this
  // instead of relying on the derived tenant+event+recipient+data+time-bucket hash.
  idempotencyKey: z.string().min(1).max(200).optional(),
  ...NotificationMetaFields,
});

const InternalSendSchema = SendSchema.extend({
  tenantId: z.number().int().positive(),
});

const SendRawInternalSchema = z.object({
  tenantId: z.number().int().positive(),
  eventType: z.string().min(1).default('CRM_CAMPAIGN'),
  channel: z.enum(['SMS', 'EMAIL', 'WHATSAPP', 'IN_APP', 'INSTAGRAM']),
  recipientPhone: z.string().optional(),
  recipientEmail: z.string().email().optional(),
  // Required for IN_APP sends to be scoped to a recipient — GET /notifications and
  // /unread-count both filter by recipientUserId, which sendRaw previously never set.
  recipientUserId: z.number().int().positive().optional(),
  subject: z.string().optional(),
  body: z.string().min(1),
  idempotencyKey: z.string().min(1).max(200).optional(),
  // CP-2: signed URL to a campaign's media attachment, resolved once by the caller (sales-
  // service's CampaignService) and passed through to whichever channel adapter supports media.
  mediaUrl: z.string().url().optional(),
  mediaType: z.enum(['image', 'video', 'document']).optional(),
  // CP-8: tenant_sender_identity override resolved by the caller (sales-service).
  senderOverride: z
    .object({ name: z.string().optional(), addressOrNumber: z.string().optional() })
    .optional(),
  // CRM-ROADMAP Phase 1, Feature 6 — DLT/TRAI SMS Compliance. Omitted/absent means
  // 'TRANSACTIONAL' (see NotificationEngine.SendRawInput's own comment) — only
  // sales-service's CampaignService explicitly sets 'PROMOTIONAL'.
  category: z.enum(['PROMOTIONAL', 'TRANSACTIONAL']).optional(),
  ...NotificationMetaFields,
});

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
  deliveryQueue: DeliveryEnqueuer,
  redis: Redis
): Promise<void> {
  const engine = new NotificationEngine(db, deliveryQueue);

  // ── POST /notifications/send — Send a notification ──────────────────────
  fastify.post(
    '/notifications/send',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.NOTIFICATION_SEND)] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const body = SendSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const { recipientUserId, recipientPhone, recipientEmail, channels, idempotencyKey, ...rest } =
        body.data;
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
    }
  );

  // ── POST /notifications/send-internal — Service-to-service send (no JWT) ─
  fastify.post('/notifications/send-internal', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const body = InternalSendSchema.safeParse(request.body);
    if (!body.success)
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const { recipientUserId, recipientPhone, recipientEmail, channels, idempotencyKey, ...rest } =
      body.data;
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
  // config.rateLimit: false exempts this route from the global @fastify/rate-limit plugin
  // registered in main.ts. That plugin is IP-keyed here (request.auth is never populated for an
  // x-internal-key route), so every tenant's campaign sends share ONE combined 200/min budget
  // from sales-service's host IP — leaving it enabled would silently cap all tenants combined
  // at 200/min regardless of the per-tenant check below, reintroducing the exact R14 bug.
  fastify.post(
    '/notifications/send-raw-internal',
    { config: { rateLimit: false } },
    async (request, reply) => {
      if (!requireInternalKey(request as never, reply as never)) return;
      const body = SendRawInternalSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      // CP-9 follow-up (R14): this route is called once per campaign recipient by
      // CampaignService.send() and is authenticated via x-internal-key, not a JWT — the global
      // @fastify/rate-limit plugin's tenantOrIpKeyGenerator can't key it by tenant (request.auth
      // is never populated here), so without this check every tenant's campaign sends would share
      // one IP-keyed budget. This is a genuinely per-tenant, per-tenant-configurable check instead.
      const [settings] = await db
        .select({ limit: tenantCommunicationSettings.notificationRateLimitPerMinute })
        .from(tenantCommunicationSettings)
        .where(eq(tenantCommunicationSettings.tenantId, body.data.tenantId));
      const limit = settings?.limit ?? DEFAULT_NOTIFICATION_RATE_LIMIT_PER_MINUTE;
      const rateLimitResult = await checkTenantNotificationRateLimit(
        redis,
        body.data.tenantId,
        limit
      );
      if (!rateLimitResult.allowed) {
        return reply.code(429).send({
          error: {
            code: 'TENANT_RATE_LIMIT_EXCEEDED',
            message: `Notification rate limit exceeded for this tenant (${limit}/minute). Configure a higher limit in Campaign Settings if this tenant needs more throughput.`,
          },
        });
      }

      const {
        recipientPhone,
        recipientEmail,
        recipientUserId,
        subject,
        idempotencyKey,
        mediaUrl,
        mediaType,
        senderOverride,
        ...rest
      } = body.data;
      const result = await engine.sendRaw({
        ...rest,
        ...(recipientPhone !== undefined ? { recipientPhone } : {}),
        ...(recipientEmail !== undefined ? { recipientEmail } : {}),
        ...(recipientUserId !== undefined ? { recipientUserId } : {}),
        ...(subject !== undefined ? { subject } : {}),
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        ...(mediaUrl !== undefined ? { mediaUrl } : {}),
        ...(mediaType !== undefined ? { mediaType } : {}),
        ...(senderOverride !== undefined ? { senderOverride } : {}),
      });
      return reply.code(200).send({ data: result });
    }
  );

  // ── POST /notifications/templates/seed-crm — Seed CRM domain templates ───
  fastify.post('/notifications/templates/seed-crm', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const body = z
      .object({
        tenantId: z.number().int().positive(),
        createdBy: z.number().int().positive().default(0),
      })
      .safeParse(request.body);
    if (!body.success)
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const templates = [
      {
        name: 'Birthday Greeting (WhatsApp)',
        eventType: 'BIRTHDAY_GREETING',
        channel: 'WHATSAPP' as const,
        bodyTemplate:
          'Happy Birthday {{customerName}}! 🎉 {{shopName}} wishes you a wonderful year ahead. Visit us for a special birthday surprise!',
      },
      {
        name: 'Birthday Greeting (SMS fallback)',
        eventType: 'BIRTHDAY_GREETING',
        channel: 'SMS' as const,
        bodyTemplate:
          'Happy Birthday {{customerName}}! {{shopName}} wishes you a great year. Visit us for a special offer.',
      },
    ];

    let count = 0;
    for (const t of templates) {
      const [inserted] = await db
        .insert(notificationTemplates)
        .values({
          tenantId: body.data.tenantId,
          createdBy: body.data.createdBy,
          isSystem: true,
          ...t,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) count++;
    }

    return reply.code(200).send({ data: { message: 'CRM templates seeded', count } });
  });

  // ── POST /notifications/templates/seed-hr — Seed HR domain templates ─────
  fastify.post('/notifications/templates/seed-hr', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const body = z
      .object({
        tenantId: z.number().int().positive(),
        createdBy: z.number().int().positive().default(0),
      })
      .safeParse(request.body);
    if (!body.success)
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const templates = [
      {
        name: 'Alteration Ready',
        eventType: 'ALTERATION_READY',
        channel: 'WHATSAPP' as const,
        bodyTemplate: 'Hi {{customerName}}, your alteration is ready. Ref: {{orderNumber}}',
        isSystem: true,
      },
      {
        name: 'Alteration Assigned',
        eventType: 'ALTERATION_ASSIGNED',
        channel: 'IN_APP' as const,
        bodyTemplate: 'You have been assigned alteration order {{orderNumber}}',
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

    return reply.code(200).send({ data: { message: 'HR templates seeded', count } });
  });

  // ── POST /notifications/templates/seed-auth — Seed Auth domain templates ─
  fastify.post('/notifications/templates/seed-auth', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const body = z
      .object({
        tenantId: z.number().int().positive(),
        createdBy: z.number().int().positive().default(0),
      })
      .safeParse(request.body);
    if (!body.success)
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const templates = [
      {
        name: 'Password Reset',
        eventType: 'PASSWORD_RESET_REQUESTED',
        channel: 'EMAIL' as const,
        subject: 'Reset your password',
        bodyTemplate:
          '<p>We received a request to reset your password.</p><p><a href="{{resetLink}}">Click here to reset your password</a></p><p>If you did not request this, you can safely ignore this email.</p>',
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
    const body = z
      .object({
        tenantId: z.number().int().positive(),
        createdBy: z.number().int().positive().default(0),
      })
      .safeParse(request.body);
    if (!body.success)
      throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

    const templates = [
      {
        name: 'Welcome Email',
        eventType: 'WELCOME_EMAIL',
        channel: 'EMAIL' as const,
        subject: 'Welcome to {{tenantName}}',
        bodyTemplate:
          '<p>Hi {{firstName}},</p><p>Welcome to {{tenantName}}! Your account has been created and is ready to use.</p>',
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

    return reply
      .code(200)
      .send({ data: { message: 'Tenant-provisioning templates seeded', count } });
  });

  // ── GET /notifications — List in-app notifications for current user ──────
  // page/pageSize/totalElements matches this platform's standard list-endpoint convention
  // (e.g. apps/sales-service/src/api/invoice.routes.ts) — this route previously used a
  // 0-based `page`/`size` pair with no totalElements, its own one-off shape.
  fastify.get('/notifications', { preHandler: authenticate }, async (request, reply) => {
    const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;
    const query = request.query as {
      page?: string;
      pageSize?: string;
      businessCategory?: string;
      unreadOnly?: string;
    };
    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const pageSize = Math.min(100, parseInt(query.pageSize ?? '20', 10));

    const whereClause = and(
      eq(notificationLog.tenantId, tenantId),
      eq(notificationLog.recipientUserId, userId),
      eq(notificationLog.channel, 'IN_APP'),
      ...(query.businessCategory
        ? [
            eq(
              notificationLog.businessCategory,
              query.businessCategory as
                'APPROVAL' | 'SALES' | 'CRM' | 'INVENTORY' | 'FINANCE' | 'WORKFLOW' | 'SYSTEM'
            ),
          ]
        : []),
      ...(query.unreadOnly === 'true' ? [isNull(notificationLog.readAt)] : [])
    );

    const items = await db
      .select()
      .from(notificationLog)
      .where(whereClause)
      .orderBy(desc(notificationLog.createdAt), desc(notificationLog.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notificationLog)
      .where(whereClause);
    const totalElements = totalRow?.count ?? 0;

    const unreadCount = await engine.getUnreadCount(tenantId, userId);

    return reply.code(200).send({
      data: { content: items, unreadCount, page, pageSize, totalElements },
    });
  });

  // ── POST /notifications/read-all — Mark every unread in-app notification as read ─
  fastify.post('/notifications/read-all', { preHandler: authenticate }, async (request, reply) => {
    const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;

    await db
      .update(notificationLog)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(notificationLog.tenantId, tenantId),
          eq(notificationLog.recipientUserId, userId),
          eq(notificationLog.channel, 'IN_APP'),
          isNull(notificationLog.readAt)
        )
      );

    return reply.code(200).send({ data: { message: 'All notifications marked as read' } });
  });

  // ── POST /notifications/:id/read — Mark in-app notification as read ──────
  fastify.post<{ Params: { id: string } }>(
    '/notifications/:id/read',
    { preHandler: authenticate },
    async (request, reply) => {
      const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);

      // Security audit: this WHERE clause only checked tenantId, not recipientUserId — any
      // authenticated user in the tenant could mark ANY other user's notification as read by
      // guessing/enumerating ids (IDOR). GET /notifications and /unread-count both already scope
      // by recipientUserId; this route needs the same scoping.
      await db
        .update(notificationLog)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(notificationLog.id, id),
            eq(notificationLog.tenantId, tenantId),
            eq(notificationLog.recipientUserId, userId)
          )
        );

      return reply.code(200).send({ data: { message: 'Marked as read' } });
    }
  );

  // ── POST /notifications/:id/retry — Manually retry one FAILED notification ─
  // Notification-service audit 2026-07-23: a FAILED notification was permanently terminal —
  // no automated re-drive (see retry-failed-internal below) and no way for an admin to retry
  // one on demand. Scoped by tenantId (same IDOR-prevention pattern as /:id/read) so a user in
  // one tenant can't retry — or discover the existence of — another tenant's notification.
  fastify.post<{ Params: { id: string } }>(
    '/notifications/:id/retry',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.NOTIFICATION_SEND)] },
    async (request, reply) => {
      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const id = parseInt(request.params.id, 10);

      const result = await engine.retrySingle(tenantId, id);
      if (!result) {
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'No FAILED notification with that id for this tenant',
          },
        });
      }
      return reply.code(200).send({ data: result });
    }
  );

  // ── POST /notifications/retry-failed-internal — Scheduler-triggered retry sweep ─
  fastify.post('/notifications/retry-failed-internal', async (request, reply) => {
    if (!requireInternalKey(request as never, reply as never)) return;
    const tenantId = parseInt((request.query as { tenantId?: string }).tenantId ?? '', 10);
    if (!tenantId) {
      return reply
        .code(400)
        .send({ error: { code: 'MISSING_TENANT_ID', message: 'tenantId query param required' } });
    }

    const result = await engine.retryFailed(tenantId);
    return reply.code(200).send({ data: result });
  });

  // ── GET /notifications/preferences — List current user's channel prefs ───
  // Notification-service audit 2026-07-23: POST existed to save preferences but there was no
  // way to read them back — the frontend had no way to render current state before editing.
  fastify.get(
    '/notifications/preferences',
    { preHandler: authenticate },
    async (request, reply) => {
      const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;
      const rows = await db
        .select({
          eventType: notificationPreferences.eventType,
          smsEnabled: notificationPreferences.smsEnabled,
          emailEnabled: notificationPreferences.emailEnabled,
          whatsappEnabled: notificationPreferences.whatsappEnabled,
          inAppEnabled: notificationPreferences.inAppEnabled,
          quietHoursEnabled: notificationPreferences.quietHoursEnabled,
        })
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.tenantId, tenantId),
            eq(notificationPreferences.userId, userId)
          )
        );

      return reply.code(200).send({ data: { content: rows } });
    }
  );

  // ── POST /notifications/preferences — Update per-user channel prefs ──────
  fastify.post(
    '/notifications/preferences',
    { preHandler: authenticate },
    async (request, reply) => {
      const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;
      const body = PreferencesSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

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
    }
  );

  // ── GET /notifications/unread-count — Fast unread bell count ─────────────
  fastify.get(
    '/notifications/unread-count',
    { preHandler: authenticate },
    async (request, reply) => {
      const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;
      const count = await engine.getUnreadCount(tenantId, userId);
      return reply.code(200).send({ data: { count } });
    }
  );

  // ── SSE: GET /notifications/stream — Real-time in-app push ───────────────
  fastify.get(
    '/notifications/stream',
    { preHandler: authenticateStream },
    async (request, reply) => {
      const { tenantId, userId = 0 } = (request as unknown as AuthedRequest).auth;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        // The shared HELMET_OPTIONS sets Cross-Origin-Resource-Policy: same-origin service-wide,
        // which is correct for regular JSON API responses but blocks the browser's native
        // EventSource from ever opening this cross-origin (web-frontend on a different port) —
        // confirmed live: curl succeeds (CORP is a browser-enforced check, not a server one), but
        // a real browser's EventSource fails immediately with readyState CLOSED despite valid
        // CORS (Access-Control-Allow-Origin) headers, because CORP is an independent, additional
        // check the CORS response headers don't satisfy. This route is the one legitimately
        // cross-origin-embeddable resource in the service; override just here rather than
        // weakening CORP for every other (same-origin-only-appropriate) response.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      });

      // Send initial heartbeat
      reply.raw.write('data: {"type":"connected"}\n\n');

      // Seed lastSeenId from the newest row that already exists at connect time, so the first
      // tick below doesn't replay the recipient's entire notification history as "new".
      const [newest] = await db
        .select({ id: notificationLog.id })
        .from(notificationLog)
        .where(
          and(
            eq(notificationLog.tenantId, tenantId),
            eq(notificationLog.recipientUserId, userId),
            eq(notificationLog.channel, 'IN_APP')
          )
        )
        .orderBy(desc(notificationLog.id))
        .limit(1);
      let lastSeenId = newest?.id ?? 0;

      // Poll every 5 seconds for new notifications. Still a DB poll, not a pub/sub push — kept
      // deliberately simple (no new infrastructure) but now also surfaces the new rows'
      // content, not just the unread count, so the panel/list can live-update too.
      const interval = setInterval(async () => {
        try {
          const count = await engine.getUnreadCount(tenantId, userId);
          reply.raw.write(`data: ${JSON.stringify({ type: 'unread_count', count })}\n\n`);

          const newItems = await db
            .select()
            .from(notificationLog)
            .where(
              and(
                eq(notificationLog.tenantId, tenantId),
                eq(notificationLog.recipientUserId, userId),
                eq(notificationLog.channel, 'IN_APP'),
                sql`${notificationLog.id} > ${lastSeenId}`
              )
            )
            .orderBy(desc(notificationLog.id))
            .limit(20);

          if (newItems.length > 0) {
            lastSeenId = Math.max(lastSeenId, ...newItems.map((n) => n.id));
            reply.raw.write(
              `data: ${JSON.stringify({ type: 'new_notifications', items: newItems })}\n\n`
            );
          }
        } catch {
          clearInterval(interval);
        }
      }, 5000);

      request.raw.on('close', () => {
        clearInterval(interval);
      });

      await new Promise<void>((resolve) => request.raw.on('close', resolve));
    }
  );
}
