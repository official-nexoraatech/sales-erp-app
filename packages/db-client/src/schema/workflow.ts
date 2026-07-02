import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Workflow Definitions (templates seeded per tenant) ───────────────────
export const workflowDefinitions = pgTable(
  'workflow_definitions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    triggerEvent: varchar('trigger_event', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 100 }).notNull(),
    conditionExpr: jsonb('condition_expr')
      .$type<{
        field: string;
        operator: 'GT' | 'LT' | 'GTE' | 'LTE' | 'EQ' | 'ALWAYS';
        value?: number | string;
      }>()
      .default({ field: '', operator: 'ALWAYS' }),
    nodes: jsonb('nodes').notNull().$type<WorkflowNode[]>().default([]),
    isActive: boolean('is_active').notNull().default(true),
    isSystem: boolean('is_system').notNull().default(false),
    timeoutHours: integer('timeout_hours').notNull().default(48),
    escalationUserId: integer('escalation_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_wf_def_tenant_event').on(t.tenantId, t.triggerEvent, t.isActive),
    index('idx_wf_def_tenant').on(t.tenantId),
  ]
);

// ─── Workflow Instances (one per triggered approval) ───────────────────────
export const workflowInstances = pgTable(
  'workflow_instances',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    definitionId: integer('definition_id').notNull(),
    entityType: varchar('entity_type', { length: 100 }).notNull(),
    entityId: integer('entity_id').notNull(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('PENDING')
      .$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'ESCALATED' | 'EXPIRED' | 'CANCELLED'>(),
    currentNodeId: varchar('current_node_id', { length: 50 }),
    correlationId: varchar('correlation_id', { length: 36 }).notNull(),
    triggeredByUserId: integer('triggered_by_user_id').notNull(),
    triggerPayload: jsonb('trigger_payload').notNull().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_wf_instance_tenant_status').on(t.tenantId, t.status),
    index('idx_wf_instance_entity').on(t.entityType, t.entityId, t.tenantId),
    index('idx_wf_instance_expires').on(t.expiresAt, t.status),
    index('idx_wf_instance_correlation').on(t.correlationId),
  ]
);

// ─── Workflow Approvals (one per node action) ──────────────────────────────
export const workflowApprovals = pgTable(
  'workflow_approvals',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    instanceId: integer('instance_id').notNull(),
    nodeId: varchar('node_id', { length: 50 }).notNull(),
    nodeName: varchar('node_name', { length: 200 }).notNull(),
    approverId: integer('approver_id').notNull(),
    approverRoleId: integer('approver_role_id'),
    action: varchar('action', { length: 20 })
      .$type<'PENDING' | 'APPROVED' | 'REJECTED' | 'ESCALATED'>()
      .default('PENDING')
      .notNull(),
    comment: text('comment'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    reminderCount: integer('reminder_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('wf_approvals_unique').on(t.instanceId, t.nodeId, t.approverId),
    index('idx_wf_approvals_instance').on(t.instanceId),
    index('idx_wf_approvals_approver').on(t.approverId, t.action, t.tenantId),
    index('idx_wf_approvals_tenant_pending').on(t.tenantId, t.action),
  ]
);

export interface WorkflowNode {
  id: string;
  name: string;
  type: 'APPROVAL' | 'PARALLEL_APPROVAL' | 'NOTIFICATION' | 'ACTION';
  approverType: 'ROLE' | 'USER' | 'MANAGER';
  approverRef: string;
  nextNodeId?: string;
  rejectedNodeId?: string;
  requireAllApprovers?: boolean;
}

export type WorkflowDefinition = typeof workflowDefinitions.$inferSelect;
export type NewWorkflowDefinition = typeof workflowDefinitions.$inferInsert;
export type WorkflowInstance = typeof workflowInstances.$inferSelect;
export type NewWorkflowInstance = typeof workflowInstances.$inferInsert;
export type WorkflowApproval = typeof workflowApprovals.$inferSelect;
export type NewWorkflowApproval = typeof workflowApprovals.$inferInsert;
