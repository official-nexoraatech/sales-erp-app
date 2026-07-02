// Platform SDK — the single mandatory layer between services and infrastructure
// ERP_MASTER_SPEC §4.1: "All infrastructure access MUST go through the SDK"

export type { TenantContext, PlatformContext, PlatformContextConfig } from './context.js';
export { PlatformContextFactory } from './context.js';

export { TenantScopedDatabase } from './database.js';

export { TenantScopedCache } from './cache.js';

export { DistributedLockManager } from './locks.js';
export type { LockOptions, AcquiredLock } from './locks.js';

export { PlatformAuditLogger } from './audit.js';
export type { AuditLogEntry } from './audit.js';

export {
  PlatformEventBus,
  PlatformEventConsumer,
  OutboxPublisher,
} from './events.js';
export type { EventHandler } from './events.js';

export { PlatformFeatureFlags } from './feature-flags.js';
export type { FeatureFlagValue } from './feature-flags.js';

export { WorkflowEngine, SYSTEM_WORKFLOW_DEFINITIONS } from './workflow.js';
export type {
  WorkflowTriggerInput,
  ApprovalDecisionInput,
  WorkflowStatus,
  PendingApprovalItem,
} from './workflow.js';

export { RuleEngine, SYSTEM_RULE_TEMPLATES } from './rule-engine.js';
export type {
  RuleCondition,
  RuleAction,
  RuleDefinition,
  RuleEvaluationContext,
  RuleEvaluationResult,
  EvaluationSummary,
} from './rule-engine.js';

export {
  initializeTelemetry,
  shutdownTelemetry,
  trace,
  setCorrelationId,
} from './telemetry.js';
export type { TelemetryOptions, SpanOptions } from './telemetry.js';

export { EventStoreService } from './event-store.js';
export type { DomainEvent, EventStoreQuery, AggregateState } from './event-store.js';

export { SchemaRegistry, SchemaCompatibilityError, getUpcaster, upcastEvent } from './schema-registry.js';
export type { JsonSchema, SchemaEntry, CompatibilityCheckResult, Upcaster } from './schema-registry.js';

export { HELMET_OPTIONS, PERMISSIONS_POLICY } from './http-security.js';
