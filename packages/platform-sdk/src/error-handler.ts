import { ZodError } from 'zod';
import { ERPError } from '@erp/types';

export interface ErrorHandlerLogger {
  error(obj: Record<string, unknown>, msg: string): void;
}

// Structural — avoids adding a hard dependency on fastify's types to this framework-agnostic SDK
// (same convention as health.ts's HealthRouteApp). The real Fastify request/reply objects have
// far more properties than this; structural typing only requires the ones this handler reads.
export interface ErrorHandlerApp {
  setErrorHandler(
    handler: (
      error: unknown,
      request: { url: string; correlationId?: string },
      reply: { code(statusCode: number): { send(body: unknown): unknown } }
    ) => unknown
  ): unknown;
}

function formatZodMessage(error: ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message
    )
    .join('; ');
}

// The single shared error handler for every service. Before this, 13 of 15 services each
// hand-rolled a near-identical `setErrorHandler` (some diverging), and 2 (auth-service,
// api-gateway) had no `instanceof ERPError` branch at all — silently discarding every thrown
// error's code/message/details behind a flat 500. None of the 15 caught `ZodError`: an
// unhandled `.parse()` throw fell through to the generic 500 branch with a raw, unformatted
// Zod issues dump as the message (see PG-059 for the incident this traces back to).
export function registerErrorHandler(
  fastify: ErrorHandlerApp,
  serviceName: string,
  logger: ErrorHandlerLogger
): void {
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ERPError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: formatZodMessage(error),
          details: { issues: error.issues },
        },
      });
    }

    // Fastify's own AJV route-schema validation (routes registered with a `schema:` option)
    // sets `.validation` rather than throwing a ZodError — a couple of services already
    // special-cased this before this shared handler existed; kept generic since it applies
    // to any service using Fastify's built-in schema validation, not just those two.
    if (
      error &&
      typeof error === 'object' &&
      'validation' in error &&
      Array.isArray((error as { validation?: unknown }).validation)
    ) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: (error as { validation: unknown }).validation,
        },
      });
    }

    // Any other thrown error that already carries an intentional non-5xx HTTP status —
    // e.g. @fastify/rate-limit throws a plain Error with `.statusCode = 429` (not an
    // ERPError) when a caller is rate-limited — must keep that status. Every one of the
    // 13 hand-rolled handlers this replaces lacked this branch, so exceeding a rate limit
    // (including auth-service's login rate limit) silently returned 500 instead of 429.
    const rawStatusCode =
      error && typeof error === 'object'
        ? (error as { statusCode?: unknown }).statusCode
        : undefined;
    if (typeof rawStatusCode === 'number' && rawStatusCode >= 400 && rawStatusCode < 500) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(rawStatusCode).send({ error: { code: 'REQUEST_ERROR', message } });
    }

    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      { err: err.message, url: request.url, correlationId: request.correlationId },
      `Unhandled error in ${serviceName}`
    );
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
}
