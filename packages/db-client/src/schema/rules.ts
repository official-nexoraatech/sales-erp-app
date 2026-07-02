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

// ─── Business Rules (configurable per tenant) ─────────────────────────────
export const businessRules = pgTable(
  'business_rules',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: integer('tenant_id').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 100 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    isSystem: boolean('is_system').notNull().default(false),
    priority: integer('priority').notNull().default(100),
    conditions: jsonb('conditions').notNull().$type<RuleCondition[]>().default([]),
    actions: jsonb('actions').notNull().$type<RuleAction[]>().default([]),
    conditionOperator: varchar('condition_operator', { length: 5 })
      .notNull()
      .default('AND')
      .$type<'AND' | 'OR'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: integer('created_by').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    unique('biz_rules_tenant_name').on(t.tenantId, t.name),
    index('idx_biz_rules_tenant_event').on(t.tenantId, t.eventType, t.isActive, t.priority),
    index('idx_biz_rules_tenant').on(t.tenantId, t.isActive),
  ]
);

export interface RuleCondition {
  field: string;
  operator:
    | 'EQUALS'
    | 'NOT_EQUALS'
    | 'GREATER_THAN'
    | 'LESS_THAN'
    | 'GREATER_THAN_EQUALS'
    | 'LESS_THAN_EQUALS'
    | 'BETWEEN'
    | 'IN'
    | 'NOT_IN'
    | 'CONTAINS'
    | 'STARTS_WITH';
  value: unknown;
  value2?: unknown;
}

export interface RuleAction {
  type: 'SET_FIELD' | 'ADD_DISCOUNT' | 'BLOCK' | 'WARN' | 'NOTIFY' | 'TRIGGER_APPROVAL';
  field?: string;
  value?: unknown;
  message?: string;
  notifyUserIds?: number[];
  workflowEvent?: string;
}

export type BusinessRule = typeof businessRules.$inferSelect;
export type NewBusinessRule = typeof businessRules.$inferInsert;
