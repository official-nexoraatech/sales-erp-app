import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Redis from 'ioredis';
import {
  HELMET_OPTIONS,
  CORS_METHODS,
  PERMISSIONS_POLICY,
  registerHealthRoute,
  tenantOrIpKeyGenerator,
  checkDatabase,
  initializeTelemetry,
  initTenantStatusEnforcement,
  subscribeToTenantStatusInvalidations,
  PlatformContextFactory,
  registerErrorHandler,
} from '@erp/sdk';
import { createDatabaseClient } from '@erp/db';
import {
  createLogger,
  createMetricsHandler,
  createHttpMetricsHook,
  createCorrelationIdHook,
} from '@erp/logger';
import { loadAuthConfig } from './config.js';
import { initializeJwt } from './jwt.js';
import { loginRoute } from './routes/login.js';
import { refreshRoute } from './routes/refresh.js';
import { logoutRoute } from './routes/logout.js';
import { forgotPasswordRoute } from './routes/forgot-password.js';
import { lookupTenantsRoute } from './routes/lookup-tenants.js';
import { resetPasswordRoute } from './routes/reset-password.js';
import { rolesRoutes } from './routes/roles.js';
import { userRolesRoutes } from './routes/user-roles.js';
import { rulesRoutes } from './routes/rules.js';
import { userRoutes } from './routes/users.js';
import { mfaVerifyRoute, mfaManagementRoutes } from './routes/mfa.routes.js';
import { impersonateRoutes } from './routes/impersonate.routes.js';
import { adminUsersRoutes } from './routes/admin-users.routes.js';
import { sessionsRoutes } from './routes/sessions.routes.js';
import { securityAuditLogRoutes } from './routes/security-audit-log.routes.js';
import { auditLogRoutes } from './routes/audit-log.routes.js';
import { featureFlagsRoutes } from './routes/feature-flags.routes.js';
import { searchSyncInternalRoutes } from './routes/search-sync.internal.routes.js';
import { authenticate } from './middleware/authenticate.js';

initializeTelemetry({ serviceName: 'auth-service' });

async function bootstrap(): Promise<void> {
  const config = await loadAuthConfig();
  const lokiUrl = process.env['LOKI_URL'];
  const logger = createLogger({
    serviceName: 'auth-service',
    level: 'info',
    ...(lokiUrl ? { lokiUrl } : {}),
  });

  if (!config.jwtPrivateKey || !config.jwtPublicKey) {
    logger.error({}, 'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY environment variables are required');
    process.exit(1);
  }

  if (!config.fieldEncryptionKey) {
    logger.error(
      {},
      'FIELD_ENCRYPTION_KEY environment variable is required for TOTP secret encryption'
    );
    process.exit(1);
  }

  await initializeJwt({
    privateKeyPem: config.jwtPrivateKey.replace(/\\n/g, '\n'),
    publicKeyPem: config.jwtPublicKey.replace(/\\n/g, '\n'),
    issuer: config.jwtIssuer,
    accessTokenTtlSeconds: config.jwtAccessTokenTtl,
  });

  const db = createDatabaseClient({ url: config.databaseUrl });
  initTenantStatusEnforcement(db);
  const metricsHandler = await createMetricsHandler('auth-service');

  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  redis.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'Redis connection error in auth-service');
  });
  subscribeToTenantStatusInvalidations(redis);

  // Search-service sync (Phase 2): user/role routes need outbox event publishing, which
  // only PlatformContextFactory provides. Every other route in this file still gets the
  // plain `db`/`redis` above — this factory is scoped to userRoutes/rolesRoutes only, not
  // a service-wide migration, so it runs its own separate DB pool and Redis connection.
  const ctxFactory = new PlatformContextFactory({
    databaseUrl: config.databaseUrl,
    redisUrl: config.redisUrl,
    kafkaBrokers: config.kafkaBrokers,
    kafkaClientId: 'auth-service',
    serviceName: 'auth-service',
  });
  await ctxFactory.connect();

  const fastify = Fastify({
    logger: false, // using structured logger instead
    trustProxy: true,
  });

  // Must be registered before any routes/plugins — Fastify's setErrorHandler only propagates
  // to encapsulated child contexts (every fastify.register() call, including the /api/v2
  // prefix wrapper and the protected-routes sub-scope below) that exist AT THE TIME it's set.
  // This was previously called at the end of bootstrap, after every route was already
  // registered, so it silently never applied to any of them — every ERPError/ValidationError/
  // BusinessError thrown anywhere in this service fell through to Fastify's own generic
  // default error formatting (flat {statusCode, error: <HTTP reason phrase>, message}) instead
  // of this handler's {error: {code, message, details}} shape, discarding the real, specific,
  // actionable error message on every single validation/business-rule failure.
  registerErrorHandler(fastify, 'auth-service', logger);

  fastify.addHook('onRequest', createCorrelationIdHook());

  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });

  await fastify.register(cors, {
    methods: CORS_METHODS,
    origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });

  // ES-16: global default (200/min) for every route; the login route below keeps its
  // own stricter per-route override (config.rateLimit, set from LOGIN_RATE_LIMIT_MAX/
  // WINDOW_MS in loginRoute()) — a route-level config always wins over this default,
  // so flipping `global` on here does not change login's 10/15min behavior.
  await fastify.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    redis: undefined, // no Redis connection in this service; in-memory store for now
    keyGenerator: tenantOrIpKeyGenerator,
  });
  fastify.addHook('onResponse', createHttpMetricsHook('auth-service'));

  // Health check — Kubernetes liveness/readiness probe
  registerHealthRoute(fastify, 'auth-service', {
    db: () => checkDatabase(db),
  });

  fastify.get('/metrics', async (_request, reply) => {
    const body = await metricsHandler.handler();
    return reply.code(200).header('Content-Type', metricsHandler.contentType).send(body);
  });

  // PG-010: routes are dual-registered — once unprefixed (legacy, deprecation window)
  // and once under /api/v2 (baseline convention) — via this shared plugin.
  const registerAuthRoutes = async (sub: FastifyInstance): Promise<void> => {
    // Public routes — no JWT required
    await loginRoute(sub, db, config, redis);
    await lookupTenantsRoute(sub, db, config);
    await refreshRoute(sub, db, config);
    await logoutRoute(sub, db);
    await forgotPasswordRoute(sub, db, config);
    await resetPasswordRoute(sub, db);
    await mfaVerifyRoute(sub, db, config, redis);
    // Internal-only, guarded by x-internal-key rather than JWT — must stay outside the
    // `authenticate` scope below (scheduler-service has no user JWT to present).
    await searchSyncInternalRoutes(sub, db);

    // Protected routes — JWT required via scoped preHandler hook
    await sub.register(async (scope) => {
      scope.addHook('preHandler', authenticate);
      await rolesRoutes(scope, ctxFactory);
      await userRolesRoutes(scope, db);
      await rulesRoutes(scope, db);
      await userRoutes(scope, ctxFactory);
      await mfaManagementRoutes(scope, db, config);
      await impersonateRoutes(scope, db);
      await adminUsersRoutes(scope, db);
      await sessionsRoutes(scope, db);
      await securityAuditLogRoutes(scope, db);
      await auditLogRoutes(scope, db);
      await featureFlagsRoutes(scope, db, redis);
    });
  };

  await registerAuthRoutes(fastify);
  await fastify.register(registerAuthRoutes, { prefix: '/api/v2' });

  const address = await fastify.listen({ port: config.port, host: '0.0.0.0' });
  logger.info({ address }, 'Auth service started');
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal startup error: ${msg}\n`);
  process.exit(1);
});

// Export for middleware use by other services
export { authenticate } from './middleware/authenticate.js';
export { requirePermission } from './middleware/authorize.js';
export type { AccessTokenPayload } from './jwt.js';
