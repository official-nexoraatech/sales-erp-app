// Platform SDK — the single mandatory layer between services and infrastructure
// ERP_MASTER_SPEC §4.1: "All infrastructure access MUST go through the SDK"

export type { TenantContext, PlatformContext, PlatformContextConfig } from './context.js';
export { PlatformContextFactory } from './context.js';

export { verifyAccessToken, checkPermission, getBranchScope, AuthTokenError } from './auth.js';
export type { AuthPayload, PermissionCheckResult, BranchScope } from './auth.js';

export { TenantScopedDatabase } from './database.js';

export { TenantScopedCache } from './cache.js';

export { DistributedLockManager } from './locks.js';
export type { LockOptions, AcquiredLock } from './locks.js';

export { PlatformAuditLogger } from './audit.js';
export type { AuditLogEntry } from './audit.js';

export { StorageClient } from './storage.js';
export type { StorageClientConfig } from './storage.js';

export { PlatformAttachments } from './attachments.js';
export type { UploadAttachmentInput } from './attachments.js';

export { PlatformEventBus, PlatformEventConsumer } from './events.js';
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

export { initializeTelemetry, shutdownTelemetry, trace, setCorrelationId } from './telemetry.js';
export type { TelemetryOptions, SpanOptions } from './telemetry.js';

export { EventStoreService } from './event-store.js';
export type { DomainEvent, EventStoreQuery, AggregateState } from './event-store.js';

export {
  SchemaRegistry,
  SchemaCompatibilityError,
  getUpcaster,
  upcastEvent,
} from './schema-registry.js';
export type {
  JsonSchema,
  SchemaEntry,
  CompatibilityCheckResult,
  Upcaster,
} from './schema-registry.js';

export { HELMET_OPTIONS, PERMISSIONS_POLICY, CORS_METHODS } from './http-security.js';

export { registerErrorHandler } from './error-handler.js';
export type { ErrorHandlerApp, ErrorHandlerLogger } from './error-handler.js';

export { createCircuitBreaker } from './circuitBreaker.js';
export type { CircuitBreakerOptions } from './circuitBreaker.js';

export { buildHealthResponse, registerHealthRoute, checkKafka, checkDatabase } from './health.js';
export type { HealthCheckFn, HealthRouteApp, HealthCheckResponse } from './health.js';

export { tenantOrIpKeyGenerator, RATE_LIMIT_DEFAULTS } from './rate-limit.js';
export type { RateLimitRequest } from './rate-limit.js';

export { SagaOrchestrator, SagaExecutionError } from './saga.js';
export type {
  SagaStepDefinition,
  SagaStepType,
  SagaStepRecord,
  SagaStatus,
  SagaResult,
  SagaStepFactory,
} from './saga.js';

export {
  GST_COMPLIANCE_SAGA_TYPE,
  EWB_VALUE_THRESHOLD,
  createGstComplianceStepFactory,
} from './sagas/gst-compliance.js';
export type { GstComplianceContext, GstComplianceActionDeps } from './sagas/gst-compliance.js';

export {
  initTenantStatusEnforcement,
  assertTenantActive,
  invalidateTenantStatusCache,
  publishTenantStatusInvalidation,
  subscribeToTenantStatusInvalidations,
} from './tenantStatus.js';

export { assertUnderUserLimit, assertUnderBranchLimit } from './entitlements.js';

export {
  DuplicateOperationError,
  isUniqueConstraintViolation,
  withIdempotentInsert,
  deriveTimeBucketedDedupKey,
} from './idempotency.js';
