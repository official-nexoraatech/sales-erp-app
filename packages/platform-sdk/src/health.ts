/* global process */
import type { Kafka } from 'kafkajs';
import { sql } from 'drizzle-orm';
import type { ErpDatabase } from '@erp/db';

export type HealthCheckFn = () => Promise<boolean>;

// For services that hold a raw ErpDatabase directly (no PlatformContextFactory) —
// e.g. tenant-service, notification-service, report-service.
export async function checkDatabase(db: ErpDatabase): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

// Verifies brokers are reachable without holding a long-lived connection open —
// connects a throwaway admin client and disconnects immediately.
export async function checkKafka(kafka: Kafka): Promise<boolean> {
  const admin = kafka.admin();
  try {
    await admin.connect();
    return true;
  } catch {
    return false;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

// Structural — avoids adding a hard dependency on fastify's types to this framework-agnostic SDK.
export interface HealthRouteApp {
  get(path: string, handler: (request: unknown, reply: { code: (n: number) => { send: (body: unknown) => unknown } }) => unknown): unknown;
}

export interface HealthCheckResponse {
  statusCode: number;
  body: {
    status: 'healthy' | 'degraded';
    checks: Record<string, boolean>;
    service: string;
    version: string;
    uptime: number;
  };
}

export async function buildHealthResponse(
  serviceName: string,
  checks: Record<string, HealthCheckFn>
): Promise<HealthCheckResponse> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => [name, await check()] as const)
  );
  const results = Object.fromEntries(entries);
  const healthy = entries.every(([, ok]) => ok);

  return {
    statusCode: healthy ? 200 : 503,
    body: {
      status: healthy ? 'healthy' : 'degraded',
      checks: results,
      service: serviceName,
      version: process.env['SERVICE_VERSION'] ?? 'unknown',
      uptime: process.uptime(),
    },
  };
}

// Registers GET /health — verifies each dependency check and returns 200 (all healthy) or 503 (degraded).
export function registerHealthRoute(
  fastify: HealthRouteApp,
  serviceName: string,
  checks: Record<string, HealthCheckFn>
): void {
  fastify.get('/health', async (_request, reply) => {
    const { statusCode, body } = await buildHealthResponse(serviceName, checks);
    return reply.code(statusCode).send(body);
  });
}
