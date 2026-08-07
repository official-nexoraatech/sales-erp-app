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
    // Automation engine (automation-service) extension — defaults preserve the exact
    // behavior of the 20 pre-existing seeded approval-chain definitions (all EVENT-triggered,
    // matched on triggerEvent as before). CRON/WEBHOOK/API are new trigger types automation-
    // service's TriggerRegistry adds on top, not a replacement for the EVENT path WorkflowEngine
    // already implements.
    triggerType: varchar('trigger_type', { length: 10 })
      .notNull()
      .default('EVENT')
      .$type<'EVENT' | 'CRON' | 'WEBHOOK' | 'API'>(),
    // CRON: { cron: string }. WEBHOOK: { webhookSecret: string }. EVENT/API: unused (null).
    triggerConfig: jsonb('trigger_config').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('idx_wf_def_tenant_event').on(t.tenantId, t.triggerEvent, t.isActive),
    index('idx_wf_def_tenant').on(t.tenantId),
    index('idx_wf_def_tenant_trigger_type').on(t.tenantId, t.triggerType, t.isActive),
  ]
);

// ─── Workflow Execution History (one row per automation-service run) ───────
// Distinct from workflowApprovals (which is specifically approval-node-shaped: one row per
// approver decision) — this is a node-type-agnostic per-run log for the automation engine's
// CONDITION/ACTION/NOTIFICATION/DELAY nodes, mirroring scheduler-service's job_history shape.
export const workflowExecutionHistory = pgTable(
  'workflow_execution_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    definitionId: integer('definition_id').notNull(),
    triggeredBy: varchar('triggered_by', { length: 10 })
      .notNull()
      .$type<'EVENT' | 'CRON' | 'WEBHOOK' | 'API' | 'MANUAL'>(),
    status: varchar('status', { length: 20 })
      .notNull()
      .default('RUNNING')
      .$type<'RUNNING' | 'COMPLETED' | 'FAILED'>(),
    // Per-node outcome — [{nodeId, type, status, startedAt, completedAt, error?}]
    nodeResults: jsonb('node_results')
      .notNull()
      .$type<
        Array<{
          nodeId: string;
          type: string;
          status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
          error?: string;
        }>
      >()
      .default([]),
    triggerPayload: jsonb('trigger_payload').notNull().default({}),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_wf_exec_history_tenant_def').on(t.tenantId, t.definitionId),
    index('idx_wf_exec_history_tenant_started').on(t.tenantId, t.startedAt),
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
  // CONDITION/DELAY added by automation-service — the original APPROVAL/PARALLEL_APPROVAL
  // types and their approverType/approverRef fields are untouched, still consumed exactly as
  // before by WorkflowEngine (packages/platform-sdk/src/workflow.ts), which only ever
  // executes APPROVAL-shaped nodes. automation-service's WorkflowExecutionEngine handles the
  // rest, delegating to WorkflowEngine.trigger() specifically for APPROVAL nodes it encounters.
  type: 'APPROVAL' | 'PARALLEL_APPROVAL' | 'NOTIFICATION' | 'ACTION' | 'CONDITION' | 'DELAY';
  approverType?: 'ROLE' | 'USER' | 'MANAGER';
  approverRef?: string;
  nextNodeId?: string;
  rejectedNodeId?: string;
  requireAllApprovers?: boolean;
  // CONDITION node: gates whether execution proceeds to nextNodeId. Uses the same
  // RuleCondition shape/evaluator as the Business Rules Engine (evaluateConditions,
  // exported from @erp/sdk) — no second condition DSL.
  conditions?: Array<{
    field: string;
    operator: string;
    value: unknown;
    value2?: unknown;
  }>;
  conditionOperator?: 'AND' | 'OR';
  // NOTIFICATION node: notifies a role (every active user holding it) or a specific user via
  // the existing notification-service IN_APP channel — same resolution pattern as
  // WorkflowEngine.resolveApprovers / the scheduler's workflow.approval-reminder job.
  message?: string;
  // ACTION node: intentionally limited to publishing a new outbox event in v1 — an action
  // node must never write directly to a ledger/stock/GST table (would become a 5th place
  // domain logic could drift); expanding the allowlisted action-type set is a deliberate,
  // reviewed follow-up, not a generic "run arbitrary code" escape hatch.
  actionEventType?: string;
  // DELAY node: reschedules the remaining DAG walk this many minutes in the future via
  // automation-service's BullMQ delayed job, reusing scheduler-service's proven job engine
  // rather than a bespoke timer.
  delayMinutes?: number;
}

export type WorkflowDefinition = typeof workflowDefinitions.$inferSelect;
export type NewWorkflowDefinition = typeof workflowDefinitions.$inferInsert;
export type WorkflowInstance = typeof workflowInstances.$inferSelect;
export type NewWorkflowInstance = typeof workflowInstances.$inferInsert;
export type WorkflowApproval = typeof workflowApprovals.$inferSelect;
export type NewWorkflowApproval = typeof workflowApprovals.$inferInsert;
export type WorkflowExecutionHistoryRow = typeof workflowExecutionHistory.$inferSelect;
export type NewWorkflowExecutionHistoryRow = typeof workflowExecutionHistory.$inferInsert;
