/* global crypto */
import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { workflowDefinitions, workflowExecutionHistory } from '@erp/db';
import type { ErpDatabase } from '@erp/db';
import { withTenantConnection } from '@erp/sdk';
import { PERMISSIONS, ValidationError } from '@erp/types';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { WorkflowDefinitionService } from '../domain/WorkflowDefinitionService.js';
import type { TriggerRegistry } from '../domain/TriggerRegistry.js';

const NodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['APPROVAL', 'PARALLEL_APPROVAL', 'NOTIFICATION', 'ACTION', 'CONDITION', 'DELAY']),
  approverType: z.enum(['ROLE', 'USER', 'MANAGER']).optional(),
  approverRef: z.string().optional(),
  nextNodeId: z.string().optional(),
  rejectedNodeId: z.string().optional(),
  requireAllApprovers: z.boolean().optional(),
  conditions: z
    .array(
      z.object({
        field: z.string().min(1),
        operator: z.string().min(1),
        value: z.unknown(),
        value2: z.unknown().optional(),
      })
    )
    .optional(),
  conditionOperator: z.enum(['AND', 'OR']).optional(),
  message: z.string().optional(),
  actionEventType: z.string().optional(),
  delayMinutes: z.number().int().positive().optional(),
});

const DefinitionSchema = z.object({
  name: z.string().min(2).max(200),
  triggerEvent: z.string().min(1),
  entityType: z.string().min(1),
  triggerType: z.enum(['EVENT', 'CRON', 'WEBHOOK', 'API']),
  triggerConfig: z.record(z.unknown()).optional(),
  nodes: z.array(NodeSchema).min(1),
  timeoutHours: z.number().int().positive().optional(),
  isActive: z.boolean().default(true),
});

// Phase 9 GUC-per-request rollout — migrated 2026-08-21 (CRUD routes only). This service has no
// PlatformContextFactory, so withTenantConnection is used directly. The two trigger/webhook
// routes below are deliberately NOT migrated — triggerRegistry.handleManualOrApiTrigger() runs
// the WorkflowEngine, which can send real notifications and has DELAY nodes (potentially hours),
// so wrapping them would hold a transaction open indefinitely. See
// 23-guc-per-request-rollout-checklist.md's "external I/O mid-handler" caveat.
export async function automationRoutes(
  fastify: FastifyInstance,
  db: ErpDatabase,
  triggerRegistry: TriggerRegistry
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/automation/definitions', {
    preHandler: requirePermission(PERMISSIONS.AUTOMATION_VIEW),
    handler: async (req, reply) => {
      const rows = await withTenantConnection(db, req.auth.tenantId, (scopedDb) =>
        new WorkflowDefinitionService(scopedDb).list(req.auth.tenantId)
      );
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    },
  });

  fastify.get<{ Params: { id: string } }>('/automation/definitions/:id', {
    preHandler: requirePermission(PERMISSIONS.AUTOMATION_VIEW),
    handler: async (req, reply) => {
      const row = await withTenantConnection(db, req.auth.tenantId, (scopedDb) =>
        new WorkflowDefinitionService(scopedDb).get(Number(req.params.id), req.auth.tenantId)
      );
      return reply.send({ data: row });
    },
  });

  fastify.post('/automation/definitions', {
    preHandler: requirePermission(PERMISSIONS.AUTOMATION_CREATE),
    handler: async (req, reply) => {
      const body = DefinitionSchema.safeParse(req.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const row = await withTenantConnection(db, req.auth.tenantId, (scopedDb) =>
        new WorkflowDefinitionService(scopedDb).create(
          req.auth.tenantId,
          req.auth.userId,
          body.data as never
        )
      );
      return reply.code(201).send({ data: row });
    },
  });

  fastify.put<{ Params: { id: string } }>('/automation/definitions/:id', {
    preHandler: requirePermission(PERMISSIONS.AUTOMATION_EDIT),
    handler: async (req, reply) => {
      const body = DefinitionSchema.safeParse(req.body);
      if (!body.success)
        throw new ValidationError(body.error.errors.map((e) => e.message).join('; '));
      const row = await withTenantConnection(db, req.auth.tenantId, (scopedDb) =>
        new WorkflowDefinitionService(scopedDb).update(
          Number(req.params.id),
          req.auth.tenantId,
          body.data as never
        )
      );
      return reply.send({ data: row });
    },
  });

  fastify.patch<{ Params: { id: string }; Body: { isActive: boolean } }>(
    '/automation/definitions/:id/toggle',
    {
      preHandler: requirePermission(PERMISSIONS.AUTOMATION_EDIT),
      handler: async (req, reply) => {
        await withTenantConnection(db, req.auth.tenantId, (scopedDb) =>
          new WorkflowDefinitionService(scopedDb).toggle(
            Number(req.params.id),
            req.auth.tenantId,
            Boolean(req.body.isActive)
          )
        );
        return reply.send({ data: { message: 'Updated' } });
      },
    }
  );

  fastify.delete<{ Params: { id: string } }>('/automation/definitions/:id', {
    preHandler: requirePermission(PERMISSIONS.AUTOMATION_DELETE),
    handler: async (req, reply) => {
      await withTenantConnection(db, req.auth.tenantId, (scopedDb) =>
        new WorkflowDefinitionService(scopedDb).remove(Number(req.params.id), req.auth.tenantId)
      );
      return reply.send({ data: { message: 'Deleted' } });
    },
  });

  fastify.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/automation/definitions/:id/trigger',
    {
      preHandler: requirePermission(PERMISSIONS.AUTOMATION_EXECUTE),
      handler: async (req, reply) => {
        await triggerRegistry.handleManualOrApiTrigger(
          Number(req.params.id),
          req.auth.tenantId,
          req.body ?? {},
          'MANUAL'
        );
        return reply.send({ data: { message: 'Triggered' } });
      },
    }
  );

  fastify.get<{ Params: { id: string } }>('/automation/definitions/:id/history', {
    preHandler: requirePermission(PERMISSIONS.AUTOMATION_VIEW),
    handler: async (req, reply) => {
      const rows = await withTenantConnection(db, req.auth.tenantId, (scopedDb) =>
        scopedDb
          .select()
          .from(workflowExecutionHistory)
          .where(
            and(
              eq(workflowExecutionHistory.tenantId, req.auth.tenantId),
              eq(workflowExecutionHistory.definitionId, Number(req.params.id))
            )
          )
          .orderBy(desc(workflowExecutionHistory.startedAt))
          .limit(30)
      );
      return reply.send({ data: { content: rows, totalElements: rows.length } });
    },
  });

  // Signed webhook ingestion — HMAC-SHA256 over the raw body using the definition's own
  // triggerConfig.webhookSecret, matching this codebase's existing signature-verified webhook
  // pattern (not JWT-authenticated, since the caller is an external system, not a logged-in user).
  fastify.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/automation/webhook/:id',
    { config: { rateLimit: false } },
    async (req, reply) => {
      const definitionId = Number(req.params.id);
      // tenantId isn't known from a webhook caller — the definition row itself carries it.
      const [def] = await db
        .select()
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.id, definitionId));
      if (!def || def.triggerType !== 'WEBHOOK' || !def.isActive) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
      }

      const secret = (def.triggerConfig as { webhookSecret?: string } | null)?.webhookSecret;
      const signature = req.headers['x-webhook-signature'];
      if (!secret || typeof signature !== 'string') {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Missing signature' } });
      }
      const expected = await computeHmac(secret, JSON.stringify(req.body ?? {}));
      if (expected !== signature) {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid signature' } });
      }

      await triggerRegistry.handleManualOrApiTrigger(
        definitionId,
        def.tenantId,
        req.body ?? {},
        'API'
      );
      return reply.send({ data: { message: 'Received' } });
    }
  );
}

async function computeHmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
