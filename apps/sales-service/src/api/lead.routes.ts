import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { getBranchScope } from '@erp/sdk';
import { crmLeadActivities, crmLeads, crmAssignmentRules } from '@erp/db';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { BusinessError, NotFoundError, OptimisticLockError, ValidationError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { createLogger } from '@erp/logger';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { LeadService } from '../domain/LeadService.js';

const logger = createLogger({ serviceName: 'sales-service' });

// One retry after a short delay for a transient failure — a 4xx means the request itself is
// wrong and retrying won't help, so only a thrown error (network) or 5xx is retried.
async function sendNotificationWithRetry(
  url: string,
  internalKey: string,
  payload: Record<string, unknown>
): Promise<void> {
  const attempts = 2;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify(payload),
      });
      if (res.ok || res.status < 500) return;
    } catch {
      // network error — fall through to retry below
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('notification delivery failed after retry');
}

// Best-effort notification-service call, same fire-and-forget pattern as
// InvoiceNotificationService.ts — a notification-service outage must never block a lead
// assignment. One retry on a transient failure before giving up (see sendNotificationWithRetry).
async function notifyLeadAssigned(
  tenantId: number,
  leadId: number,
  leadLabel: string,
  assignedUserId: number
): Promise<void> {
  try {
    const notificationUrl = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3014';
    const internalKey = process.env['INTERNAL_API_KEY'] ?? '';
    await sendNotificationWithRetry(
      `${notificationUrl}/notifications/send-raw-internal`,
      internalKey,
      {
        tenantId,
        eventType: 'LEAD_ASSIGNED',
        channel: 'IN_APP',
        recipientUserId: assignedUserId,
        subject: 'New lead assigned to you',
        body: `${leadLabel} has been assigned to you.`,
        entityType: 'Lead',
        entityId: leadId,
        businessCategory: 'CRM',
        priority: 'NORMAL',
      }
    );
  } catch (err) {
    logger.warn(
      { err, leadId, assignedUserId },
      'Lead-assigned notification failed after retry (non-fatal)'
    );
  }
}

// CRM-ROADMAP Phase 1, Feature 2 — Lead Management & Capture.

const LEAD_SOURCES = [
  'WEBSITE',
  'REFERRAL',
  'WALK_IN',
  'SOCIAL_MEDIA',
  'ADVERTISEMENT',
  'PHONE_INQUIRY',
  'OTHER',
] as const;
const LEAD_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'] as const;

// 06-SECURITY-PLAN.md §2.1: this is the only unauthenticated write endpoint in the codebase —
// every field is hostile input. `hp` is a honeypot: real browsers never fill a field hidden
// from view via CSS, so a non-empty value is a strong bot signal. Rather than telling the bot
// it was caught (which teaches it to leave the field blank next time), this returns a
// fake-success response and silently does not write a row.
const CaptureSchema = z.object({
  tenantId: z.number().int().positive(),
  displayName: z.string().max(200).optional(),
  companyName: z.string().max(300).optional(),
  phone: z.string().min(10).max(20),
  email: z.string().email().max(255).optional().or(z.literal('')),
  source: z.enum(LEAD_SOURCES).optional(),
  isB2b: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
  // Deliberately not constrained to length 0 here — a bot that fills this field must still
  // pass validation so the honeypot check below (not Zod) is what silently no-ops the write.
  hp: z.string().max(200).optional(),
});

const LeadCreateSchema = z.object({
  displayName: z.string().max(200).optional(),
  companyName: z.string().max(300).optional(),
  phone: z.string().min(10).max(20),
  email: z.string().email().max(255).optional().or(z.literal('')),
  source: z.enum(LEAD_SOURCES).default('OTHER'),
  isB2b: z.boolean().default(false),
  branchId: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

const LeadUpdateSchema = z.object({
  version: z.number().int().min(0),
  displayName: z.string().max(200).optional(),
  companyName: z.string().max(300).optional(),
  email: z.string().email().max(255).optional().or(z.literal('')),
  stage: z.enum(LEAD_STAGES).optional(),
  branchId: z.number().int().positive().optional(),
  lostReason: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
});

const AssignSchema = z.object({
  userId: z.number().int().positive().optional(),
});

const ConvertSchema = z.object({
  branchId: z.number().int().positive(),
});

const ActivitySchema = z.object({
  activityType: z.enum(['NOTE', 'CALL', 'EMAIL']),
  description: z.string().min(1).max(2000),
});

const AssignmentRuleSchema = z.object({
  name: z.string().min(2).max(200),
  strategy: z.enum(['ROUND_ROBIN', 'LOAD_BALANCED']).default('ROUND_ROBIN'),
  assigneeUserIds: z.array(z.number().int().positive()).min(1),
  branchId: z.number().int().positive().optional(),
  isActive: z.boolean().default(true),
});

type AuthedRequest = {
  auth: { tenantId: number; userId: number; permissions: string[]; branchIds: number[] };
};

function branchInScope(
  auth: { permissions: string[]; branchIds: number[] },
  branchId: number
): boolean {
  const scope = getBranchScope(auth);
  return scope === 'all' || scope.includes(branchId);
}

export async function leadRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  // ── POST /leads/capture — public, unauthenticated, rate-limited ────────────
  fastify.post(
    '/leads/capture',
    {
      config: {
        rateLimit: {
          max: parseInt(process.env['LEAD_CAPTURE_RATE_LIMIT_MAX'] ?? '5', 10),
          timeWindow: parseInt(process.env['LEAD_CAPTURE_RATE_LIMIT_WINDOW_MS'] ?? '600000', 10),
        },
      },
    },
    async (request, reply) => {
      const body = CaptureSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      // Honeypot tripped — return a fake success without ever touching the database, and
      // without logging the payload (no PII from this path at info/debug level).
      if (body.data.hp) {
        return reply.code(201).send({ data: { id: 0 } });
      }

      const ctx = ctxFactory.create({
        tenantId: body.data.tenantId,
        userId: 0,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });

      const { lead, duplicate } = await LeadService.capture(ctx.db.raw, body.data.tenantId, {
        displayName: body.data.displayName,
        companyName: body.data.companyName,
        phone: body.data.phone,
        email: body.data.email || undefined,
        source: body.data.source,
        isB2b: body.data.isB2b,
        notes: body.data.notes,
      });

      if (!duplicate) {
        await ctx.events.publish(
          'crm_lead',
          lead.id,
          'LEAD_CAPTURED',
          lead as unknown as Record<string, unknown>
        );
      }

      return reply.code(201).send({ data: { id: lead.id }, duplicate });
    }
  );

  // ── GET /leads — Kanban board query ─────────────────────────────────────────
  fastify.get(
    '/leads',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAD_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId, permissions, branchIds } = (request as unknown as AuthedRequest)
        .auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const query = request.query as { stage?: string; assignedTo?: string; mine?: string };

      let whereClause = eq(crmLeads.tenantId, tenantId);
      if (query.stage) {
        whereClause = and(
          whereClause,
          eq(crmLeads.stage, query.stage as (typeof LEAD_STAGES)[number])
        )!;
      }
      if (query.mine === 'true') {
        whereClause = and(whereClause, eq(crmLeads.assignedTo, userId))!;
      } else if (query.assignedTo) {
        whereClause = and(whereClause, eq(crmLeads.assignedTo, parseInt(query.assignedTo, 10)))!;
      }

      const branchScope = getBranchScope({ permissions, branchIds });
      if (branchScope !== 'all') {
        whereClause = and(
          whereClause,
          or(isNull(crmLeads.branchId), inArray(crmLeads.branchId, branchScope))
        )!;
      }

      const rows = await ctx.db.raw
        .select()
        .from(crmLeads)
        .where(whereClause)
        .orderBy(desc(crmLeads.createdAt));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  // ── GET /leads/:id ───────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/leads/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAD_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const [lead] = await ctx.db.raw
        .select()
        .from(crmLeads)
        .where(and(eq(crmLeads.id, id), eq(crmLeads.tenantId, tenantId)));
      if (!lead) throw new NotFoundError('CrmLead', id);
      return reply.code(200).send({ data: lead });
    }
  );

  // ── POST /leads — authenticated manual creation ─────────────────────────────
  fastify.post(
    '/leads',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAD_CREATE)] },
    async (request, reply) => {
      const { tenantId, userId, permissions, branchIds } = (request as unknown as AuthedRequest)
        .auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const body = LeadCreateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      if (body.data.branchId && !branchInScope({ permissions, branchIds }, body.data.branchId)) {
        throw new BusinessError('BRANCH_OUT_OF_SCOPE', 'Cannot create a lead for that branch');
      }

      const [existingOpen] = await ctx.db.raw
        .select()
        .from(crmLeads)
        .where(
          and(
            eq(crmLeads.tenantId, tenantId),
            eq(crmLeads.phone, body.data.phone),
            inArray(crmLeads.stage, ['NEW', 'CONTACTED', 'QUALIFIED'])
          )
        );
      const warnings: string[] = [];
      if (existingOpen) {
        warnings.push(
          `An open lead with phone ${body.data.phone} already exists (id: ${existingOpen.id})`
        );
      }

      const [created] = await ctx.db.raw
        .insert(crmLeads)
        .values({
          tenantId,
          createdBy: userId,
          displayName: body.data.displayName,
          companyName: body.data.companyName,
          phone: body.data.phone,
          email: body.data.email || undefined,
          source: body.data.source,
          isB2b: body.data.isB2b,
          branchId: body.data.branchId,
          notes: body.data.notes,
        } as unknown as typeof crmLeads.$inferInsert)
        .returning();
      if (!created) throw new Error('Lead creation failed unexpectedly');

      await ctx.audit.log({
        action: 'CREATE',
        entityType: 'crm_lead',
        entityId: created.id,
        after: created as unknown as Record<string, unknown>,
      });
      await ctx.events.publish(
        'crm_lead',
        created.id,
        'LEAD_CAPTURED',
        created as unknown as Record<string, unknown>
      );

      return reply.code(201).send({ data: created, warnings });
    }
  );

  // ── PUT /leads/:id — field/stage update ──────────────────────────────────────
  fastify.put<{ Params: { id: string } }>(
    '/leads/:id',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAD_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = LeadUpdateSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(crmLeads)
        .where(and(eq(crmLeads.id, id), eq(crmLeads.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('CrmLead', id);
      if (existing.stage === 'CONVERTED') {
        throw new BusinessError('LEAD_CONVERTED', 'A converted lead cannot be edited');
      }

      const stageChanged = body.data.stage && body.data.stage !== existing.stage;

      const [updated] = await ctx.db.transaction(async (trx) => {
        const [row] = await trx.raw
          .update(crmLeads)
          .set({
            displayName: body.data.displayName,
            companyName: body.data.companyName,
            email: body.data.email || undefined,
            stage: body.data.stage,
            branchId: body.data.branchId,
            lostReason: body.data.lostReason,
            notes: body.data.notes,
            updatedAt: new Date(),
            version: existing.version + 1,
          } as unknown as Partial<typeof crmLeads.$inferInsert>)
          .where(
            and(
              eq(crmLeads.id, id),
              eq(crmLeads.tenantId, tenantId),
              eq(crmLeads.version, body.data.version)
            )
          )
          .returning();
        if (stageChanged && row) {
          await trx.raw.insert(crmLeadActivities).values({
            tenantId,
            leadId: id,
            activityType: 'STAGE_CHANGE',
            fromStage: existing.stage,
            toStage: body.data.stage,
            actorId: userId,
          });
        }
        return [row];
      });
      if (!updated) throw new OptimisticLockError('CrmLead');

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_lead',
        entityId: id,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });

      return reply.code(200).send({ data: updated });
    }
  );

  // ── POST /leads/:id/assign ────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/leads/:id/assign',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAD_ASSIGN)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = AssignSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select()
        .from(crmLeads)
        .where(and(eq(crmLeads.id, id), eq(crmLeads.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('CrmLead', id);

      let assignedUserId: number | null;
      if (body.data.userId) {
        assignedUserId = body.data.userId;
        await ctx.db.raw
          .update(crmLeads)
          .set({ assignedTo: assignedUserId, updatedAt: new Date() })
          .where(eq(crmLeads.id, id));
        await ctx.db.raw.insert(crmLeadActivities).values({
          tenantId,
          leadId: id,
          activityType: 'ASSIGNMENT',
          actorId: userId,
          description: `Manually assigned to user #${assignedUserId}`,
        });
      } else {
        assignedUserId = await LeadService.autoAssign(ctx.db.raw, tenantId, id, existing.branchId);
        if (assignedUserId === null) {
          throw new BusinessError(
            'NO_ASSIGNMENT_RULE',
            'No active assignment rule with an eligible user was found'
          );
        }
      }

      await ctx.events.publish('crm_lead', id, 'LEAD_ASSIGNED', {
        leadId: id,
        assignedTo: assignedUserId,
      });

      void notifyLeadAssigned(
        tenantId,
        id,
        existing.displayName ?? existing.companyName ?? existing.phone,
        assignedUserId
      );

      return reply.code(200).send({ data: { leadId: id, assignedTo: assignedUserId } });
    }
  );

  // ── POST /leads/:id/convert ───────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/leads/:id/convert',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAD_CONVERT)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = ConvertSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const result = await LeadService.convertToCustomer(
        ctx.db.raw,
        tenantId,
        userId,
        id,
        body.data.branchId
      );

      await ctx.audit.log({
        action: 'UPDATE',
        entityType: 'crm_lead',
        entityId: id,
        metadata: {
          convertedCustomerId: result.customer.id,
          convertedAccountId: result.account?.id,
          attachedToExisting: result.attachedToExisting,
        },
      });
      await ctx.events.publish('crm_lead', id, 'LEAD_CONVERTED', {
        leadId: id,
        customerId: result.customer.id,
        accountId: result.account?.id,
        attachedToExisting: result.attachedToExisting,
      });

      return reply.code(200).send({ data: result });
    }
  );

  // ── Lead Activities ───────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/leads/:id/activities',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAD_VIEW)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const rows = await ctx.db.raw
        .select()
        .from(crmLeadActivities)
        .where(and(eq(crmLeadActivities.leadId, id), eq(crmLeadActivities.tenantId, tenantId)))
        .orderBy(desc(crmLeadActivities.createdAt));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/leads/:id/activities',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAD_UPDATE)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const id = parseInt(request.params.id, 10);
      const body = ActivitySchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [existing] = await ctx.db.raw
        .select({ id: crmLeads.id })
        .from(crmLeads)
        .where(and(eq(crmLeads.id, id), eq(crmLeads.tenantId, tenantId)));
      if (!existing) throw new NotFoundError('CrmLead', id);

      const [created] = await ctx.db.raw
        .insert(crmLeadActivities)
        .values({
          tenantId,
          leadId: id,
          activityType: body.data.activityType,
          description: body.data.description,
          actorId: userId,
        })
        .returning();

      return reply.code(201).send({ data: created });
    }
  );

  // ── Assignment Rules ──────────────────────────────────────────────────────────
  fastify.get(
    '/lead-assignment-rules',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAD_ASSIGN)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const rows = await ctx.db.raw
        .select()
        .from(crmAssignmentRules)
        .where(eq(crmAssignmentRules.tenantId, tenantId));
      return reply.code(200).send({ data: { content: rows, totalElements: rows.length } });
    }
  );

  fastify.post(
    '/lead-assignment-rules',
    { preHandler: [authenticate, requirePermission(PERMISSIONS.LEAD_ASSIGN)] },
    async (request, reply) => {
      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const ctx = ctxFactory.create({
        tenantId,
        userId,
        correlationId: (request.headers['x-correlation-id'] as string) ?? crypto.randomUUID(),
      });
      const body = AssignmentRuleSchema.safeParse(request.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));

      const [created] = await ctx.db.raw
        .insert(crmAssignmentRules)
        .values({
          tenantId,
          createdBy: userId,
          name: body.data.name,
          strategy: body.data.strategy,
          assigneeUserIds: body.data.assigneeUserIds,
          branchId: body.data.branchId,
          isActive: body.data.isActive,
        } as unknown as typeof crmAssignmentRules.$inferInsert)
        .returning();

      return reply.code(201).send({ data: created });
    }
  );
}
