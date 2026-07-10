import type { FastifyInstance } from 'fastify';
import type { ErpDatabase } from '@erp/db';
import { PERMISSIONS } from '@erp/types';
import { z } from 'zod';
import { ImportEngine, type ImportEntity } from '../domain/ImportEngine.js';
import { authenticate } from '../middleware/authenticate.js';

type AuthedRequest = { auth: { tenantId: number; userId: number; permissions: string[] } };

function hasPermission(request: unknown, perm: string): boolean {
  return ((request as AuthedRequest).auth?.permissions ?? []).includes(perm);
}

const MappingSchema = z.object({
  sourceColumn: z.string(),
  targetField: z.string(),
  transform: z.enum(['TRIM', 'UPPERCASE', 'LOWERCASE', 'DATE_ISO', 'NUMBER']).optional(),
});

const VALID_ENTITIES: ImportEntity[] = ['customer', 'supplier', 'item', 'employee', 'opening-stock', 'attendance'];

export async function importRoutes(fastify: FastifyInstance, db: ErpDatabase): Promise<void> {
  const engine = new ImportEngine(db);

  // ── POST /imports/upload ──────────────────────────────────────────────────
  fastify.post<{ Body: { entityType: string; csvData: string; fileName: string } }>(
    '/imports/upload',
    { preHandler: authenticate },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.IMPORT_VIEW)) {
        return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: IMPORT_VIEW' } });
      }

      const { tenantId, userId } = (request as unknown as AuthedRequest).auth;
      const { entityType, csvData, fileName } = request.body;

      if (!VALID_ENTITIES.includes(entityType as ImportEntity)) {
        return reply.code(422).send({ error: { code: 'INVALID_ENTITY_TYPE', message: `Unknown entity: ${entityType}` } });
      }

      const jobId = await engine.createJob(tenantId, userId, entityType as ImportEntity, csvData, fileName);
      return reply.code(201).send({ data: { jobId, message: 'Upload accepted' } });
    }
  );

  // ── POST /imports/:jobId/map ──────────────────────────────────────────────
  fastify.post<{ Params: { jobId: string }; Body: { mappings: unknown[] } }>(
    '/imports/:jobId/map',
    { preHandler: authenticate },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.IMPORT_VIEW)) {
        return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: IMPORT_VIEW' } });
      }

      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const rawMappings = z.array(MappingSchema).parse(request.body.mappings);
      const mappings = rawMappings.map((m) => ({
        sourceColumn: m.sourceColumn,
        targetField: m.targetField,
        ...(m.transform !== undefined ? { transform: m.transform } : {}),
      }));
      await engine.mapColumns(tenantId, request.params.jobId, mappings);
      return reply.code(200).send({ data: { message: 'Columns mapped successfully' } });
    }
  );

  // ── POST /imports/:jobId/validate ─────────────────────────────────────────
  fastify.post<{ Params: { jobId: string } }>(
    '/imports/:jobId/validate',
    { preHandler: authenticate },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.IMPORT_VIEW)) {
        return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: IMPORT_VIEW' } });
      }

      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const result = await engine.validate(tenantId, request.params.jobId);
      return reply.code(200).send({ data: result });
    }
  );

  // ── POST /imports/:jobId/execute ──────────────────────────────────────────
  fastify.post<{ Params: { jobId: string } }>(
    '/imports/:jobId/execute',
    { preHandler: authenticate },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.IMPORT_EXECUTE)) {
        return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: IMPORT_EXECUTE' } });
      }

      const { tenantId, permissions } = (request as unknown as AuthedRequest).auth;
      const result = await engine.execute(tenantId, request.params.jobId, permissions);
      return reply.code(200).send({ data: result });
    }
  );

  // ── GET /imports/:jobId/status ────────────────────────────────────────────
  fastify.get<{ Params: { jobId: string } }>(
    '/imports/:jobId/status',
    { preHandler: authenticate },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.IMPORT_VIEW)) {
        return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: IMPORT_VIEW' } });
      }

      const { tenantId } = (request as unknown as AuthedRequest).auth;
      const job = await engine.getStatus(tenantId, request.params.jobId);

      // Use SSE for streaming progress if requested
      const acceptHeader = request.headers['accept'] ?? '';
      if (acceptHeader.includes('text/event-stream')) {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        const send = (data: unknown): void => {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        send({ status: job.status, importedRows: job.successRows, totalRows: job.totalRows });

        if (['COMPLETED', 'FAILED', 'ROLLED_BACK'].includes(job.status)) {
          reply.raw.write('event: done\ndata: {}\n\n');
          reply.raw.end();
          return;
        }

        const interval = setInterval(async () => {
          try {
            const current = await engine.getStatus(tenantId, request.params.jobId);
            send({ status: current.status, importedRows: current.successRows, totalRows: current.totalRows });
            if (['COMPLETED', 'FAILED', 'ROLLED_BACK'].includes(current.status)) {
              reply.raw.write('event: done\ndata: {}\n\n');
              reply.raw.end();
              clearInterval(interval);
            }
          } catch {
            reply.raw.end();
            clearInterval(interval);
          }
        }, 2000);

        request.raw.on('close', () => clearInterval(interval));
        return;
      }

      return reply.code(200).send({ data: job });
    }
  );

  // ── POST /imports/:jobId/rollback ─────────────────────────────────────────
  fastify.post<{ Params: { jobId: string } }>(
    '/imports/:jobId/rollback',
    { preHandler: authenticate },
    async (request, reply) => {
      if (!hasPermission(request, PERMISSIONS.IMPORT_ROLLBACK)) {
        return reply.code(403).send({ error: { code: 'PERMISSION_DENIED', message: 'Missing permission: IMPORT_ROLLBACK' } });
      }

      const { tenantId } = (request as unknown as AuthedRequest).auth;
      await engine.rollback(tenantId, request.params.jobId);
      return reply.code(200).send({ data: { message: 'Import rolled back' } });
    }
  );

  // ── GET /imports/templates/:entityType ────────────────────────────────────
  fastify.get<{ Params: { entityType: string } }>(
    '/imports/templates/:entityType',
    { preHandler: authenticate },
    async (request, reply) => {
      const { entityType } = request.params;
      if (!VALID_ENTITIES.includes(entityType as ImportEntity)) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Unknown entity: ${entityType}` } });
      }

      const template = engine.getTemplate(entityType as ImportEntity);
      reply.raw.setHeader('Content-Type', 'text/csv');
      reply.raw.setHeader('Content-Disposition', `attachment; filename="${entityType}-template.csv"`);
      return reply.code(200).send(template);
    }
  );
}
