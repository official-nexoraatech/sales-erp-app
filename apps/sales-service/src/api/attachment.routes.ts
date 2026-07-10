/* global crypto */
import type { FastifyInstance } from 'fastify';
import type { PlatformContext, PlatformContextFactory, PlatformAttachments } from '@erp/sdk';
import { PERMISSIONS } from '@erp/types';
import { ValidationError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function getAttachments(ctx: PlatformContext): PlatformAttachments {
  if (!ctx.files) throw new Error('Storage is not configured for this service');
  return ctx.files;
}

export async function attachmentRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/attachments', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_UPDATE),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });

      const file = await req.file();
      if (!file) throw new ValidationError('No file uploaded');

      const entityType = (file.fields['entityType'] as { value?: string } | undefined)?.value;
      const entityIdRaw = (file.fields['entityId'] as { value?: string } | undefined)?.value;
      if (entityType !== 'INVOICE' || !entityIdRaw) {
        throw new ValidationError('entityType must be INVOICE and entityId is required');
      }
      const entityId = parseInt(entityIdRaw, 10);

      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        throw new ValidationError(`Unsupported file type: ${file.mimetype}`);
      }

      const buffer = await file.toBuffer();
      if (buffer.length > MAX_FILE_SIZE) {
        throw new ValidationError('File exceeds the 10MB size limit');
      }

      const attachments = getAttachments(ctx);
      const row = await attachments.upload({
        entityType,
        entityId,
        fileName: file.filename,
        buffer,
        mimeType: file.mimetype,
        fileSize: buffer.length,
        uploadedBy: req.auth.userId,
      });

      await ctx.events.publish('attachment', row.id, 'ATTACHMENT_UPLOADED', row as unknown as Record<string, unknown>);

      return reply.code(201).send({ data: row });
    },
  });

  fastify.get('/attachments', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const q = req.query as { entityType?: string; entityId?: string };
      if (!q.entityType || !q.entityId) throw new ValidationError('entityType and entityId are required');

      const attachments = getAttachments(ctx);
      const rows = await attachments.list(q.entityType, parseInt(q.entityId, 10));
      return reply.send({ data: rows });
    },
  });

  fastify.get('/attachments/:id/download', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_VIEW),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });

      const attachments = getAttachments(ctx);
      const { url } = await attachments.getDownloadUrl(parseInt(id, 10));
      return reply.code(302).redirect(url);
    },
  });

  fastify.delete('/attachments/:id', {
    preHandler: requirePermission(PERMISSIONS.INVOICE_UPDATE),
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });

      const attachments = getAttachments(ctx);
      await attachments.delete(parseInt(id, 10));
      await ctx.events.publish('attachment', parseInt(id, 10), 'ATTACHMENT_DELETED', { id: parseInt(id, 10) });
      return reply.code(204).send();
    },
  });
}
