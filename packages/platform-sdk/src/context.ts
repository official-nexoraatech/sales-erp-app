import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { type ErpDatabase, createDatabaseClient } from '@erp/db';
import { createLogger, type StructuredLogger } from '@erp/logger';
import { SecurityError } from '@erp/types';
import { TenantScopedDatabase } from './database.js';
import { TenantScopedCache } from './cache.js';
import { DistributedLockManager } from './locks.js';
import { PlatformAuditLogger } from './audit.js';
import { PlatformEventBus } from './events.js';
import { PlatformFeatureFlags } from './feature-flags.js';
import { WorkflowEngine } from './workflow.js';
import { RuleEngine } from './rule-engine.js';
import { trace, type SpanOptions } from './telemetry.js';

export interface TenantContext {
  tenantId: number;
  userId: number;
  correlationId: string;
  branchId?: number;
}

export interface PlatformContextConfig {
  databaseUrl: string;
  databaseReplicaUrl?: string;
  redisUrl: string;
  kafkaBrokers: string[];
  kafkaClientId: string;
  serviceName: string;
  logLevel?: string;
}

export interface PlatformContext {
  readonly tenant: TenantContext;
  readonly db: TenantScopedDatabase;
  readonly cache: TenantScopedCache;
  readonly events: PlatformEventBus;
  readonly locks: DistributedLockManager;
  readonly audit: PlatformAuditLogger;
  readonly features: PlatformFeatureFlags;
  readonly workflow: WorkflowEngine;
  readonly rules: RuleEngine;
  readonly logger: StructuredLogger;
  trace<T>(spanName: string, fn: () => Promise<T>, options?: SpanOptions): Promise<T>;
}

class PlatformContextImpl implements PlatformContext {
  readonly db: TenantScopedDatabase;
  readonly cache: TenantScopedCache;
  readonly events: PlatformEventBus;
  readonly audit: PlatformAuditLogger;
  readonly features: PlatformFeatureFlags;
  readonly workflow: WorkflowEngine;
  readonly rules: RuleEngine;
  readonly logger: StructuredLogger;

  constructor(
    public readonly tenant: TenantContext,
    drizzleDb: ErpDatabase,
    public readonly locks: DistributedLockManager,
    redis: Redis
  ) {
    if (!tenant.tenantId || tenant.tenantId <= 0) {
      throw new SecurityError('Invalid tenant context — tenantId must be a positive integer');
    }

    this.db = new TenantScopedDatabase(tenant.tenantId, drizzleDb);
    this.cache = new TenantScopedCache(redis, tenant.tenantId);
    this.events = new PlatformEventBus(this.db, tenant.tenantId, tenant.userId, tenant.correlationId);
    this.audit = new PlatformAuditLogger(this.db, tenant.userId);
    this.features = new PlatformFeatureFlags(this.db, this.cache, tenant.tenantId);
    this.workflow = new WorkflowEngine(drizzleDb, tenant.tenantId, tenant.userId, tenant.correlationId);
    this.rules = new RuleEngine(drizzleDb);
    this.logger = createLogger({
      serviceName: 'erp-service',
      tenantId: tenant.tenantId,
      correlationId: tenant.correlationId,
    });
  }

  trace<T>(spanName: string, fn: () => Promise<T>, options?: SpanOptions): Promise<T> {
    return trace(spanName, fn, {
      ...options,
      attributes: {
        'tenant.id': this.tenant.tenantId,
        'user.id': this.tenant.userId,
        'correlation.id': this.tenant.correlationId,
        ...options?.attributes,
      },
    });
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────
export class PlatformContextFactory {
  private readonly drizzleDb: ErpDatabase;
  private readonly redis: Redis;
  private readonly locks: DistributedLockManager;

  constructor(private readonly config: PlatformContextConfig) {
    this.drizzleDb = createDatabaseClient({
      url: config.databaseUrl,
      maxConnections: 10,
    });
    this.redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    this.locks = new DistributedLockManager(this.redis);
  }

  create(tenant: TenantContext): PlatformContext {
    return new PlatformContextImpl(tenant, this.drizzleDb, this.locks, this.redis);
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  // Create a mock context for testing — injects test doubles
  static createMock(
    tenantId: number,
    overrides?: Partial<Pick<PlatformContext, 'db' | 'cache' | 'locks' | 'audit' | 'features'>>
  ): PlatformContext {
    const tenant: TenantContext = {
      tenantId,
      userId: 1,
      correlationId: 'test-correlation-id',
    };

    const mockLogger = createLogger({ serviceName: 'test', level: 'silent' });

    return {
      tenant,
      logger: mockLogger,
      trace: <T>(_name: string, fn: () => Promise<T>) => fn(),
      ...(overrides as Partial<PlatformContext>),
    } as PlatformContext;
  }
}
