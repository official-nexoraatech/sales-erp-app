import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { businessRules } from '@erp/db';
import type { RuleCondition, RuleAction } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { NotFoundError, BusinessError } from '@erp/types';
import { PERMISSIONS } from '@erp/types';
import { RuleEngine } from '@erp/sdk';

type AuthedRequest = { auth: { tenantId: number; userId: number; permissions: string[] } };

function hasPermission(request: unknown, perm: string): boolean {
  return ((request as AuthedRequest).auth?.permissions ?? []).includes(perm);
}

const ConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'LESS_THAN', 'GREATER_THAN_EQUALS', 'LESS_THAN_EQUALS', 'BETWEEN', 'IN', 'NOT_IN', 'CONTAINS', 'STARTS_WITH']),
  value: z.unknown(),
  value2: z.unknown().optional(),
});

const ActionSchema = z.object({
  type: z.enum(['SET_FIELD', 'ADD_DISCOUNT', 'BLOCK', 'WARN', 'NOTIFY', 'TRIGGER_APPROVAL']),
  field: z.string().optional(),
  value: z.unknown().optional(),
  message: z.string().optional(),
  channel: z.string().optional(),
  role: z.string().optional(),
});

const CreateRuleSchema = z.object({
  name: z.string().min(2).max(200),
  entityType: z.string().min(1),
  eventType: z.string().min(1),
  conditionOperator: z.enum(['AND', 'OR']).default('AND'),
  conditions: z.array(ConditionSchema).min(1),
  actions: z.array(ActionSchema).min(1),
  priority: z.number().int().min(1).max(999).default(100),
  isActive: z.boolean().default(true),
});

export async function rulesRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  const engine = new RuleEngine(db);

  // ── GET /rules ────────────────────────────────────────────────────────────
  fastify.get('/rules', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.RULE_VIEW)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: RULE_VIEW' } });
    }
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const rules = await db.select().from(businessRules).where(eq(businessRules.tenantId, tenantId)).orderBy(businessRules.priority);
    return reply.code(200).send({ data: { content: rules, totalElements: rules.length } });
  });

  // ── POST /rules ───────────────────────────────────────────────────────────
  fastify.post('/rules', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.RULE_CREATE)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: RULE_CREATE' } });
    }
    const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
    const body = CreateRuleSchema.parse(request.body);

    const [created] = await db.insert(businessRules).values({
      tenantId,
      name: body.name,
      entityType: body.entityType,
      eventType: body.eventType,
      conditionOperator: body.conditionOperator,
      conditions: body.conditions as unknown as RuleCondition[],
      actions: body.actions as unknown as RuleAction[],
      priority: body.priority,
      isActive: body.isActive,
      isSystem: false,
      createdBy: userId,
    }).returning();
    if (!created) throw new Error('Rule creation failed unexpectedly');
    return reply.code(201).send({ data: created });
  });

  // ── GET /rules/:id ────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/rules/:id', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.RULE_VIEW)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: RULE_VIEW' } });
    }
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const [rule] = await db.select().from(businessRules).where(and(eq(businessRules.id, Number(request.params.id)), eq(businessRules.tenantId, tenantId))).limit(1);
    if (!rule) throw new NotFoundError('Rule', request.params.id);
    return reply.code(200).send({ data: rule });
  });

  // ── PUT /rules/:id ────────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/rules/:id', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.RULE_UPDATE)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: RULE_UPDATE' } });
    }
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const ruleIdPut = Number(request.params.id);
    const [existing] = await db.select().from(businessRules).where(and(eq(businessRules.id, ruleIdPut), eq(businessRules.tenantId, tenantId))).limit(1);
    if (!existing) throw new NotFoundError('Rule', request.params.id);

    const body = CreateRuleSchema.parse(request.body);
    await db.update(businessRules).set({
      name: body.name,
      entityType: body.entityType,
      eventType: body.eventType,
      conditionOperator: body.conditionOperator,
      conditions: body.conditions as unknown as RuleCondition[],
      actions: body.actions as unknown as RuleAction[],
      priority: body.priority,
      isActive: body.isActive,
      updatedAt: new Date(),
    }).where(eq(businessRules.id, ruleIdPut));

    const [updated] = await db.select().from(businessRules).where(eq(businessRules.id, ruleIdPut)).limit(1);
    return reply.code(200).send({ data: updated });
  });

  // ── DELETE /rules/:id ─────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/rules/:id', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.RULE_DELETE)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: RULE_DELETE' } });
    }
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const ruleId = Number(request.params.id);
    const [existing] = await db.select().from(businessRules).where(and(eq(businessRules.id, ruleId), eq(businessRules.tenantId, tenantId))).limit(1);
    if (!existing) throw new NotFoundError('Rule', request.params.id);
    if (existing.isSystem) throw new BusinessError('RULE_SYSTEM', 'Cannot delete system rules');

    await db.delete(businessRules).where(eq(businessRules.id, ruleId));
    return reply.code(200).send({ data: { message: 'Rule deleted' } });
  });

  // ── PATCH /rules/:id/toggle ───────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { isActive: boolean } }>('/rules/:id/toggle', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.RULE_UPDATE)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: RULE_UPDATE' } });
    }
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const ruleIdNum = Number(request.params.id);
    const [existing] = await db.select().from(businessRules).where(and(eq(businessRules.id, ruleIdNum), eq(businessRules.tenantId, tenantId))).limit(1);
    if (!existing) throw new NotFoundError('Rule', request.params.id);

    const isActive = Boolean(request.body.isActive);
    await db.update(businessRules).set({ isActive, updatedAt: new Date() }).where(eq(businessRules.id, ruleIdNum));
    return reply.code(200).send({ data: { message: `Rule ${isActive ? 'activated' : 'deactivated'}` } });
  });

  // ── POST /rules/simulate ──────────────────────────────────────────────────
  fastify.post<{ Body: { ruleId: string; testData: Record<string, unknown> } }>('/rules/simulate', async (request, reply) => {
    if (!hasPermission(request, PERMISSIONS.RULE_SIMULATE)) {
      return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: RULE_SIMULATE' } });
    }
    const { tenantId } = (request as unknown as AuthedRequest).auth;
    const { ruleId, testData } = request.body;

    const result = await engine.simulate(tenantId, ruleId, testData);
    return reply.code(200).send({ data: result });
  });
}
