import Redis from 'ioredis';
import { Kafka } from 'kafkajs';
import { sql } from 'drizzle-orm';
import { type ErpDatabase, createDatabaseClient } from '@erp/db';
import { createLogger, type StructuredLogger } from '@erp/logger';
import { SecurityError } from '@erp/types';
import { TenantScopedDatabase } from './database.js';
import { TenantScopedCache } from './cache.js';
import { DistributedLockManager } from './locks.js';
import { PlatformAuditLogger } from './audit.js';
import { PlatformEventBus } from './events.js';
import { PlatformFeatureFlags, createFeatureFlagL1Cache, type FeatureFlagL1Cache } from './feature-flags.js';
import { WorkflowEngine } from './workflow.js';
import { RuleEngine } from './rule-engine.js';
import { trace, type SpanOptions } from './telemetry.js';
import { StorageClient, type StorageClientConfig } from './storage.js';
import { PlatformAttachments } from './attachments.js';

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
  storage?: StorageClientConfig;
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
  readonly files?: PlatformAttachments;
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
  readonly files?: PlatformAttachments;

  constructor(
    public readonly tenant: TenantContext,
    drizzleDb: ErpDatabase,
    public readonly locks: DistributedLockManager,
    redis: Redis,
    storageClient?: StorageClient,
    featureFlagsL1Cache?: FeatureFlagL1Cache
  ) {
    if (!tenant.tenantId || tenant.tenantId <= 0) {
      throw new SecurityError('Invalid tenant context — tenantId must be a positive integer');
    }

    this.db = new TenantScopedDatabase(tenant.tenantId, drizzleDb);
    this.cache = new TenantScopedCache(redis, tenant.tenantId);
    this.events = new PlatformEventBus(this.db, tenant.tenantId, tenant.userId, tenant.correlationId);
    this.audit = new PlatformAuditLogger(this.db, tenant.userId);
    this.features = new PlatformFeatureFlags(this.db, this.cache, tenant.tenantId, featureFlagsL1Cache);
    this.workflow = new WorkflowEngine(drizzleDb, tenant.tenantId, tenant.userId, tenant.correlationId);
    this.rules = new RuleEngine(drizzleDb);
    this.logger = createLogger({
      serviceName: 'erp-service',
      tenantId: tenant.tenantId,
      correlationId: tenant.correlationId,
    });
    if (storageClient) {
      this.files = new PlatformAttachments(this.db, storageClient);
    }
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
  private readonly storageClient?: StorageClient;
  private readonly featureFlagsL1Cache: FeatureFlagL1Cache;

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
    if (config.storage) {
      this.storageClient = new StorageClient(config.storage);
    }
    this.featureFlagsL1Cache = createFeatureFlagL1Cache();
  }

  get rawDb(): ErpDatabase {
    return this.drizzleDb;
  }

  create(tenant: TenantContext): PlatformContext {
    return new PlatformContextImpl(
      tenant,
      this.drizzleDb,
      this.locks,
      this.redis,
      this.storageClient,
      this.featureFlagsL1Cache
    );
  }

  // Wires the Redis pub/sub hot-reload path so feature-flag invalidations from any
  // service instance drop the L1 entry here too. Call once at service bootstrap.
  subscribeFeatureFlagInvalidations(): void {
    PlatformFeatureFlags.subscribeToInvalidations(this.redis, this.featureFlagsL1Cache);
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  // Exposes the shared ioredis connection — used as the store for @fastify/rate-limit
  // so rate-limit counters are shared across all instances of a service, not per-process.
  getRedis(): Redis {
    return this.redis;
  }

  // Health check probes — reuse the factory's own pooled connections, no new sockets opened.
  async checkDb(): Promise<boolean> {
    try {
      await this.drizzleDb.execute(sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }

  async checkRedis(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
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
