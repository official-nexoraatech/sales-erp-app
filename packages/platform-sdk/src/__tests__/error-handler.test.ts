import { describe, it, expect, vi } from 'vitest';
import { z, type ZodError } from 'zod';
import { BusinessError, NotFoundError } from '@erp/types';
import { registerErrorHandler } from '../error-handler.js';

function makeFastify() {
  let handler: (error: unknown, request: unknown, reply: unknown) => unknown = () => undefined;
  return {
    setErrorHandler: (h: typeof handler) => {
      handler = h;
    },
    trigger: (
      error: unknown,
      request: { url: string; correlationId?: string } = { url: '/test' }
    ) => {
      const sent: { statusCode?: number; body?: unknown } = {};
      const reply = {
        code: (statusCode: number) => ({
          send: (body: unknown) => {
            sent.statusCode = statusCode;
            sent.body = body;
            return sent;
          },
        }),
      };
      handler(error, request, reply);
      return sent;
    },
  };
}

describe('registerErrorHandler', () => {
  it('formats an ERPError subclass as {code,message,details} at its own statusCode', () => {
    const app = makeFastify();
    const logger = { error: vi.fn() };
    registerErrorHandler(app, 'test-service', logger);

    const sent = app.trigger(new NotFoundError('Customer', 42));

    expect(sent.statusCode).toBe(404);
    expect(sent.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Customer not found',
        details: { entity: 'Customer', id: 42 },
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('formats a BusinessError with its own code and details', () => {
    const app = makeFastify();
    const logger = { error: vi.fn() };
    registerErrorHandler(app, 'test-service', logger);

    const sent = app.trigger(
      new BusinessError('INSUFFICIENT_POINTS', 'Only 40 points available', { available: 40 })
    );

    expect(sent.statusCode).toBe(422);
    expect(sent.body).toEqual({
      error: {
        code: 'INSUFFICIENT_POINTS',
        message: 'Only 40 points available',
        details: { available: 40 },
      },
    });
  });

  it('maps a raw ZodError to 400 VALIDATION_ERROR with a readable message', () => {
    const app = makeFastify();
    const logger = { error: vi.fn() };
    registerErrorHandler(app, 'test-service', logger);

    const schema = z.object({ gstRate: z.number() });
    let zodError: ZodError;
    try {
      schema.parse({ gstRate: '5.00' });
      throw new Error('expected parse to throw');
    } catch (e) {
      zodError = e as ZodError;
    }

    const sent = app.trigger(zodError);

    expect(sent.statusCode).toBe(400);
    const body = sent.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('gstRate');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('maps Fastify AJV schema validation errors (.validation array) to 400', () => {
    const app = makeFastify();
    const logger = { error: vi.fn() };
    registerErrorHandler(app, 'test-service', logger);

    const ajvError = Object.assign(new Error('body/name must be string'), {
      validation: [{ instancePath: '/name', message: 'must be string' }],
    });

    const sent = app.trigger(ajvError);

    expect(sent.statusCode).toBe(400);
    expect((sent.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('preserves a non-ERPError 4xx statusCode (e.g. @fastify/rate-limit) instead of flattening to 500', () => {
    const app = makeFastify();
    const logger = { error: vi.fn() };
    registerErrorHandler(app, 'test-service', logger);

    const rateLimitError = Object.assign(new Error('Rate limit exceeded, retry in 1 minute'), {
      statusCode: 429,
    });

    const sent = app.trigger(rateLimitError);

    expect(sent.statusCode).toBe(429);
    expect((sent.body as { error: { message: string } }).error.message).toContain(
      'Rate limit exceeded'
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('falls back to a generic 500 and logs for a genuinely unexpected error', () => {
    const app = makeFastify();
    const logger = { error: vi.fn() };
    registerErrorHandler(app, 'test-service', logger);

    const sent = app.trigger(new Error('unexpected boom'));

    expect(sent.statusCode).toBe(500);
    expect(sent.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'unexpected boom', url: '/test' }),
      'Unhandled error in test-service'
    );
  });

  it('does not leak the raw error message for a genuinely unexpected (5xx-shaped) error', () => {
    const app = makeFastify();
    const logger = { error: vi.fn() };
    registerErrorHandler(app, 'test-service', logger);

    const sent = app.trigger(
      Object.assign(new Error('db connection string leaked'), { statusCode: 500 })
    );

    const body = sent.body as { error: { message: string } };
    expect(body.error.message).not.toContain('db connection string');
    expect(sent.statusCode).toBe(500);
  });
});
