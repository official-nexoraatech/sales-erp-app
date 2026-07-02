import type { ErpDatabase } from '@erp/db';
import { businessRules } from '@erp/db';
import { eq, and } from 'drizzle-orm';
import { createLogger } from '@erp/logger';

const logger = createLogger({ serviceName: 'platform-sdk' });

// ── Types ─────────────────────────────────────────────────────────────────────
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
  value2?: unknown; // for BETWEEN
}

export interface RuleAction {
  type: 'SET_FIELD' | 'ADD_DISCOUNT' | 'BLOCK' | 'WARN' | 'NOTIFY' | 'TRIGGER_APPROVAL';
  field?: string;
  value?: unknown;
  message?: string;
  channel?: string;
  role?: string;
}

export interface RuleDefinition {
  id: string;
  name: string;
  entityType: string;
  eventType: string;
  conditionOperator: 'AND' | 'OR';
  conditions: RuleCondition[];
  actions: RuleAction[];
  priority: number;
  isActive: boolean;
}

export interface RuleEvaluationContext {
  tenantId: number;
  userId?: number;
  entityType: string;
  eventType: string;
  data: Record<string, unknown>;
}

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  actions: RuleAction[];
  blocked: boolean;
  warnings: string[];
  fieldChanges: Record<string, unknown>;
}

export interface EvaluationSummary {
  results: RuleEvaluationResult[];
  blocked: boolean;
  warnings: string[];
  fieldChanges: Record<string, unknown>;
  appliedRuleCount: number;
}

// ── Condition evaluator ───────────────────────────────────────────────────────
function getNestedValue(obj: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce((current, key) => {
    if (current !== null && current !== undefined && typeof current === 'object') {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj as unknown);
}

function evaluateCondition(condition: RuleCondition, data: Record<string, unknown>): boolean {
  const actual = getNestedValue(data, condition.field);
  const expected = condition.value;

  switch (condition.operator) {
    case 'EQUALS':
      return actual == expected; // intentional loose equality for type coercion
    case 'NOT_EQUALS':
      return actual != expected;
    case 'GREATER_THAN':
      return Number(actual) > Number(expected);
    case 'LESS_THAN':
      return Number(actual) < Number(expected);
    case 'GREATER_THAN_EQUALS':
      return Number(actual) >= Number(expected);
    case 'LESS_THAN_EQUALS':
      return Number(actual) <= Number(expected);
    case 'BETWEEN':
      return Number(actual) >= Number(expected) && Number(actual) <= Number(condition.value2);
    case 'IN':
      return Array.isArray(expected) && expected.includes(actual);
    case 'NOT_IN':
      return Array.isArray(expected) && !expected.includes(actual);
    case 'CONTAINS':
      return typeof actual === 'string' && actual.toLowerCase().includes(String(expected).toLowerCase());
    case 'STARTS_WITH':
      return typeof actual === 'string' && actual.toLowerCase().startsWith(String(expected).toLowerCase());
    default:
      return false;
  }
}

function evaluateConditions(
  conditions: RuleCondition[],
  operator: 'AND' | 'OR',
  data: Record<string, unknown>
): boolean {
  if (conditions.length === 0) return true;
  if (operator === 'AND') return conditions.every((c) => evaluateCondition(c, data));
  return conditions.some((c) => evaluateCondition(c, data));
}

// ── Pre-built rule templates ──────────────────────────────────────────────────
export const SYSTEM_RULE_TEMPLATES: Omit<RuleDefinition, 'id' | 'tenantId'>[] = [
  {
    name: 'Block sale above credit limit',
    entityType: 'SALE',
    eventType: 'SALE_CREATE',
    conditionOperator: 'AND',
    conditions: [
      { field: 'customer.creditLimitEnabled', operator: 'EQUALS', value: true },
      { field: 'customer.outstandingAmount', operator: 'GREATER_THAN_EQUALS', value: 'customer.creditLimit' },
    ],
    actions: [
      { type: 'BLOCK', message: 'Customer has exceeded credit limit. Sale blocked.' },
      { type: 'NOTIFY', message: 'Credit limit exceeded for customer', channel: 'IN_APP', role: 'SALES_MANAGER' },
    ],
    priority: 1,
    isActive: true,
  },
  {
    name: 'Auto-approve discount up to 5%',
    entityType: 'SALE',
    eventType: 'SALE_DISCOUNT',
    conditionOperator: 'AND',
    conditions: [
      { field: 'discountPercent', operator: 'LESS_THAN_EQUALS', value: 5 },
    ],
    actions: [
      { type: 'SET_FIELD', field: 'discountApprovalRequired', value: false },
    ],
    priority: 2,
    isActive: true,
  },
  {
    name: 'Trigger approval for discount above 10%',
    entityType: 'SALE',
    eventType: 'SALE_DISCOUNT',
    conditionOperator: 'AND',
    conditions: [
      { field: 'discountPercent', operator: 'GREATER_THAN', value: 10 },
    ],
    actions: [
      { type: 'TRIGGER_APPROVAL', role: 'SALES_MANAGER', message: 'Discount above 10% requires manager approval' },
    ],
    priority: 3,
    isActive: true,
  },
  {
    name: 'Warn on negative stock',
    entityType: 'STOCK',
    eventType: 'STOCK_REDUCE',
    conditionOperator: 'AND',
    conditions: [
      { field: 'resultingQuantity', operator: 'LESS_THAN', value: 0 },
    ],
    actions: [
      { type: 'WARN', message: 'This transaction will result in negative stock' },
    ],
    priority: 4,
    isActive: true,
  },
  {
    name: 'Reorder alert at reorder level',
    entityType: 'STOCK',
    eventType: 'STOCK_REDUCE',
    conditionOperator: 'AND',
    conditions: [
      { field: 'resultingQuantity', operator: 'LESS_THAN_EQUALS', value: 'item.reorderLevel' },
    ],
    actions: [
      { type: 'NOTIFY', message: 'Item is at or below reorder level', channel: 'IN_APP', role: 'INVENTORY_MANAGER' },
    ],
    priority: 5,
    isActive: true,
  },
  {
    name: 'Block GRN without matching PO',
    entityType: 'GRN',
    eventType: 'GRN_CREATE',
    conditionOperator: 'AND',
    conditions: [
      { field: 'purchaseOrderId', operator: 'EQUALS', value: null },
      { field: 'settings.requirePoForGrn', operator: 'EQUALS', value: true },
    ],
    actions: [
      { type: 'BLOCK', message: 'GRN creation requires a linked Purchase Order (configured in settings)' },
    ],
    priority: 6,
    isActive: true,
  },
];

// ── RuleEngine class ───────────────────────────────────────────────────────────
export class RuleEngine {
  constructor(private readonly db: ErpDatabase) {}

  async evaluate(ctx: RuleEvaluationContext): Promise<EvaluationSummary> {
    const rules = await this.db
      .select()
      .from(businessRules)
      .where(
        and(
          eq(businessRules.tenantId, ctx.tenantId),
          eq(businessRules.entityType, ctx.entityType),
          eq(businessRules.eventType, ctx.eventType),
          eq(businessRules.isActive, true)
        )
      )
      .orderBy(businessRules.priority);

    const results: RuleEvaluationResult[] = [];
    let blocked = false;
    const warnings: string[] = [];
    const fieldChanges: Record<string, unknown> = {};

    for (const rule of rules) {
      const conditions = rule.conditions as unknown as RuleCondition[];
      const actions = rule.actions as unknown as RuleAction[];
      const conditionOperator = (rule.conditionOperator ?? 'AND') as 'AND' | 'OR';

      const matched = evaluateConditions(conditions, conditionOperator, ctx.data);

      if (!matched) {
        results.push({ ruleId: String(rule.id), ruleName: rule.name, matched: false, actions: [], blocked: false, warnings: [], fieldChanges: {} });
        continue;
      }

      const ruleBlocked = actions.some((a) => a.type === 'BLOCK');
      const ruleWarnings = actions.filter((a) => a.type === 'WARN').map((a) => a.message ?? 'Warning');
      const ruleFieldChanges: Record<string, unknown> = {};

      for (const action of actions) {
        if (action.type === 'SET_FIELD' && action.field) {
          ruleFieldChanges[action.field] = action.value;
          fieldChanges[action.field] = action.value;
        }
      }

      if (ruleBlocked) blocked = true;
      warnings.push(...ruleWarnings);

      results.push({
        ruleId: String(rule.id),
        ruleName: rule.name,
        matched: true,
        actions,
        blocked: ruleBlocked,
        warnings: ruleWarnings,
        fieldChanges: ruleFieldChanges,
      });

      logger.info({ tenantId: ctx.tenantId, ruleId: rule.id, ruleName: rule.name, blocked: ruleBlocked }, 'Rule matched');

      // If blocked, stop evaluating lower-priority rules
      if (ruleBlocked) break;
    }

    return {
      results,
      blocked,
      warnings,
      fieldChanges,
      appliedRuleCount: results.filter((r) => r.matched).length,
    };
  }

  async simulate(
    tenantId: number,
    ruleId: string,
    testData: Record<string, unknown>
  ): Promise<{ matched: boolean; actions: RuleAction[]; conditionResults: Array<{ condition: RuleCondition; passed: boolean }> }> {
    const [rule] = await this.db
      .select()
      .from(businessRules)
      .where(and(eq(businessRules.id, Number(ruleId)), eq(businessRules.tenantId, tenantId)))
      .limit(1);

    if (!rule) throw new Error(`Rule not found: ${ruleId}`);

    const conditions = rule.conditions as unknown as RuleCondition[];
    const actions = rule.actions as unknown as RuleAction[];
    const conditionOperator = (rule.conditionOperator ?? 'AND') as 'AND' | 'OR';

    const conditionResults = conditions.map((c) => ({
      condition: c,
      passed: evaluateCondition(c, testData),
    }));

    const matched = evaluateConditions(conditions, conditionOperator, testData);
    return { matched, actions: matched ? actions : [], conditionResults };
  }

  async seedTemplates(tenantId: number, createdBy: number): Promise<void> {
    for (const template of SYSTEM_RULE_TEMPLATES) {
      await this.db
        .insert(businessRules)
        .values({
          tenantId,
          name: template.name,
          entityType: template.entityType,
          eventType: template.eventType,
          conditionOperator: template.conditionOperator,
          conditions: template.conditions,
          actions: template.actions,
          priority: template.priority,
          isActive: template.isActive,
          isSystem: true,
          createdBy,
        })
        .onConflictDoNothing();
    }
    logger.info({ tenantId, count: SYSTEM_RULE_TEMPLATES.length }, 'Rule templates seeded');
  }
}
