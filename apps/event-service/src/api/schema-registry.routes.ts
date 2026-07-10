import type { FastifyInstance } from 'fastify';
import type { PlatformContextFactory } from '@erp/sdk';
import { SchemaRegistry, SchemaCompatibilityError } from '@erp/sdk';
import { z } from 'zod';
import { PERMISSIONS } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const RegisterSchemaBody = z.object({
  eventType: z.string().min(1).max(100),
  schemaVersion: z.number().int().min(1),
  jsonSchema: z.object({}).passthrough(),
  compatibilityMode: z.enum(['BACKWARD', 'FORWARD', 'FULL', 'NONE']).default('BACKWARD'),
  description: z.string().max(500).optional(),
});

const CheckCompatibilityBody = z.object({
  jsonSchema: z.object({}).passthrough(),
  compatibilityMode: z.enum(['BACKWARD', 'FORWARD', 'FULL', 'NONE']).default('BACKWARD'),
});

export async function schemaRegistryRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // GET /schema-registry/catalog — full event catalog
  fastify.get('/schema-registry/catalog', {
    preHandler: requirePermission(PERMISSIONS.SCHEMA_REGISTRY_VIEW),
    handler: async (request, reply) => {
      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const registry = new SchemaRegistry(ctx.db);
      const catalog = await registry.getCatalog();
      return reply.code(200).send({ data: catalog });
    },
  });

  // GET /schema-registry/schemas/:type — get latest schema
  fastify.get<{ Params: { type: string } }>('/schema-registry/schemas/:type', {
    preHandler: requirePermission(PERMISSIONS.SCHEMA_REGISTRY_VIEW),
    handler: async (request, reply) => {
      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const registry = new SchemaRegistry(ctx.db);
      const schema = await registry.getLatest(request.params.type);

      if (!schema) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Schema for '${request.params.type}' not found` } });
      }
      return reply.code(200).send({ data: schema });
    },
  });

  // GET /schema-registry/schemas/:type/:version — get specific version
  fastify.get<{ Params: { type: string; version: string } }>('/schema-registry/schemas/:type/:version', {
    preHandler: requirePermission(PERMISSIONS.SCHEMA_REGISTRY_VIEW),
    handler: async (request, reply) => {
      const version = parseInt(request.params.version, 10);
      if (isNaN(version)) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid version' } });
      }

      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const registry = new SchemaRegistry(ctx.db);
      const schema = await registry.getVersion(request.params.type, version);

      if (!schema) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Schema for '${request.params.type}' v${version} not found` } });
      }
      return reply.code(200).send({ data: schema });
    },
  });

  // POST /schema-registry/schemas — register schema
  fastify.post('/schema-registry/schemas', {
    preHandler: requirePermission(PERMISSIONS.SCHEMA_REGISTRY_MANAGE),
    handler: async (request, reply) => {
      const parsed = RegisterSchemaBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.flatten() } });
      }

      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const registry = new SchemaRegistry(ctx.db);

      try {
        const registerPayload: Parameters<typeof registry.register>[0] = {
          eventType: parsed.data.eventType,
          schemaVersion: parsed.data.schemaVersion,
          jsonSchema: parsed.data.jsonSchema as import('@erp/sdk').JsonSchema,
          compatibilityMode: parsed.data.compatibilityMode,
          registeredBy: request.auth.email,
        };
        if (parsed.data.description) registerPayload.description = parsed.data.description;
        const entry = await registry.register(registerPayload);
        return reply.code(201).send({ data: entry });
      } catch (err) {
        if (err instanceof SchemaCompatibilityError) {
          return reply.code(422).send({
            error: { code: err.code, message: err.message, details: err.details },
          });
        }
        throw err;
      }
    },
  });

  // POST /schema-registry/schemas/:type/check — compatibility check
  fastify.post<{ Params: { type: string } }>('/schema-registry/schemas/:type/check', {
    preHandler: requirePermission(PERMISSIONS.SCHEMA_REGISTRY_MANAGE),
    handler: async (request, reply) => {
      const parsed = CheckCompatibilityBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.flatten() } });
      }

      const ctx = ctxFactory.create({ tenantId: request.auth.tenantId, userId: request.auth.userId, correlationId: (request.headers['x-correlation-id'] as string) ?? 'system' });
      const registry = new SchemaRegistry(ctx.db);
      const existing = await registry.getLatest(request.params.type);

      if (!existing) {
        return reply.code(200).send({ data: { compatible: true, incompatibilities: [], message: 'No existing schema — first version is always compatible' } });
      }

      const result = registry.checkCompatibility(
        existing.jsonSchema,
        parsed.data.jsonSchema as import('@erp/sdk').JsonSchema,
        parsed.data.compatibilityMode
      );

      if (!result.compatible) {
        return reply.code(422).send({
          error: {
            code: 'SCHEMA_INCOMPATIBLE',
            message: `Schema is incompatible with existing ${request.params.type} schema`,
            details: result,
          },
        });
      }

      return reply.code(200).send({ data: { compatible: true, incompatibilities: [] } });
    },
  });
}
