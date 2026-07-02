import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { HELMET_OPTIONS, PERMISSIONS_POLICY } from '@erp/sdk';
import { createDatabaseClient } from '@erp/db';
import { createLogger } from '@erp/logger';
import { loadAuthConfig } from './config.js';
import { initializeJwt } from './jwt.js';
import { loginRoute } from './routes/login.js';
import { refreshRoute } from './routes/refresh.js';
import { logoutRoute } from './routes/logout.js';
import { forgotPasswordRoute } from './routes/forgot-password.js';
import { resetPasswordRoute } from './routes/reset-password.js';
import { rolesRoutes } from './routes/roles.js';
import { userRolesRoutes } from './routes/user-roles.js';
import { rulesRoutes } from './routes/rules.js';
import { userRoutes } from './routes/users.js';
import { authenticate } from './middleware/authenticate.js';

async function bootstrap(): Promise<void> {
  const config = loadAuthConfig();
  const logger = createLogger({ serviceName: 'auth-service', level: 'info' });

  if (!config.jwtPrivateKey || !config.jwtPublicKey) {
    logger.error({}, 'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY environment variables are required');
    process.exit(1);
  }

  await initializeJwt({
    privateKeyPem: config.jwtPrivateKey.replace(/\\n/g, '\n'),
    publicKeyPem: config.jwtPublicKey.replace(/\\n/g, '\n'),
    issuer: config.jwtIssuer,
    accessTokenTtlSeconds: config.jwtAccessTokenTtl,
  });

  const db = createDatabaseClient({ url: config.databaseUrl });

  const fastify = Fastify({
    logger: false, // using structured logger instead
    trustProxy: true,
  });

  await fastify.register(helmet, HELMET_OPTIONS);
  fastify.addHook('onSend', async (_request, reply) => {
    void reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });

  await fastify.register(cors, {
    origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });

  await fastify.register(rateLimit, {
    global: false, // per-route rate limiting
    redis: undefined, // use in-memory store for now; swap with Redis in staging
    keyGenerator: (request) => request.ip,
  });

  // Health check — Kubernetes liveness/readiness probe
  fastify.get('/health', async (_request, reply) => {
    return reply.code(200).send({ status: 'ok', service: 'auth-service' });
  });

  // Public routes — no JWT required
  await loginRoute(fastify, db, config);
  await refreshRoute(fastify, db, config);
  await logoutRoute(fastify, db);
  await forgotPasswordRoute(fastify, db, config);
  await resetPasswordRoute(fastify, db);

  // Protected routes — JWT required via scoped preHandler hook
  await fastify.register(async (scope) => {
    scope.addHook('preHandler', authenticate);
    await rolesRoutes(scope, db);
    await userRolesRoutes(scope, db);
    await rulesRoutes(scope, db);
    await userRoutes(scope, db);
  });

  // Error handler — sanitize errors before sending to client
  fastify.setErrorHandler((error, _request, reply) => {
    logger.error({ err: error.message ?? String(error) }, 'Unhandled route error');
    if (error.statusCode) {
      void reply.code(error.statusCode).send({ error: error.message });
    } else {
      void reply.code(500).send({ error: 'Internal server error' });
    }
  });

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
