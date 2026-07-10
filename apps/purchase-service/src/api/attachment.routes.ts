/* global crypto */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { PlatformContext, PlatformContextFactory, PlatformAttachments } from '@erp/sdk';
import { checkPermission } from '@erp/sdk';
import { PERMISSIONS, type Permission } from '@erp/types';
import { ValidationError } from '@erp/types';
import { authenticate } from '../middleware/authenticate.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const ALLOWED_ENTITY_TYPES = new Set(['PURCHASE_ORDER', 'GRN']);

// A single attachment's visibility/mutability depends on which parent record it belongs to —
// PURCHASE_ORDER attachments are gated by the PO permissions, GRN attachments by the GRN ones
// (GRN_UPDATE added specifically for this; previously every GRN attachment route was gated on
// PO_UPDATE/PO_VIEW, meaning GRN_VIEW/GRN_CREATE holders without PO permissions couldn't manage
// their own GRN attachments at all, and PO holders could manage GRN attachments without any
// GRN permission).
const VIEW_PERMISSION: Record<string, Permission> = {
  PURCHASE_ORDER: PERMISSIONS.PO_VIEW,
  GRN: PERMISSIONS.GRN_VIEW,
};
const WRITE_PERMISSION: Record<string, Permission> = {
  PURCHASE_ORDER: PERMISSIONS.PO_UPDATE,
  GRN: PERMISSIONS.GRN_UPDATE,
};

function getAttachments(ctx: PlatformContext): PlatformAttachments {
  if (!ctx.files) throw new Error('Storage is not configured for this service');
  return ctx.files;
}

// checkPermission is a pure function (auth, permission) => 'ok' | 'forbidden' | 'unauthenticated'
// — used directly rather than invoking requirePermission(...) as a preHandler, since the
// permission to check here depends on a value (entityType) that's only known partway through
// the handler (after reading the multipart field, the query string, or looking up the row).
function assertPermission(auth: { permissions: string[] } | undefined, permission: Permission, reply: FastifyReply): boolean {
  const result = checkPermission(auth, permission);
  if (result === 'unauthenticated') {
    reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthenticated' } });
    return false;
  }
  if (result === 'forbidden') {
    reply.code(403).send({ error: { code: 'FORBIDDEN', message: `Missing permission: ${permission}` } });
    return false;
  }
  return true;
}

export async function attachmentRoutes(
  fastify: FastifyInstance,
  ctxFactory: PlatformContextFactory
): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // No static preHandler here — entityType (and so the required permission) is only known
  // once the multipart fields are read, inside the handler.
  fastify.post('/attachments', {
    handler: async (req, reply) => {
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });

      const file = await req.file();
      if (!file) throw new ValidationError('No file uploaded');

      const entityType = (file.fields['entityType'] as { value?: string } | undefined)?.value;
      const entityIdRaw = (file.fields['entityId'] as { value?: string } | undefined)?.value;
      if (!entityType || !ALLOWED_ENTITY_TYPES.has(entityType) || !entityIdRaw) {
        throw new ValidationError('entityType must be PURCHASE_ORDER or GRN and entityId is required');
      }
      if (!assertPermission(req.auth, WRITE_PERMISSION[entityType]!, reply)) return;
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

  // entityType is a query param here, so the permission is known before touching the DB.
  fastify.get('/attachments', {
    handler: async (req, reply) => {
      const q = req.query as { entityType?: string; entityId?: string };
      if (!q.entityType || !q.entityId) throw new ValidationError('entityType and entityId are required');
      if (!ALLOWED_ENTITY_TYPES.has(q.entityType)) throw new ValidationError('entityType must be PURCHASE_ORDER or GRN');
      if (!assertPermission(req.auth, VIEW_PERMISSION[q.entityType]!, reply)) return;

      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const attachments = getAttachments(ctx);
      const rows = await attachments.list(q.entityType, parseInt(q.entityId, 10));
      return reply.send({ data: rows });
    },
  });

  // entityType isn't known until the attachment row itself is looked up — attachments.get()
  // (tenant-scoped) fetches it first so the right permission can be checked before generating
  // a signed download URL.
  fastify.get('/attachments/:id/download', {
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const attachments = getAttachments(ctx);

      const row = await attachments.get(parseInt(id, 10));
      if (!assertPermission(req.auth, VIEW_PERMISSION[row.entityType] ?? PERMISSIONS.PO_VIEW, reply)) return;

      const { url } = await attachments.getDownloadUrl(parseInt(id, 10));
      return reply.code(302).redirect(url);
    },
  });

  // Same as download — look up the row first to learn its entityType before deleting it.
  fastify.delete('/attachments/:id', {
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ctx = ctxFactory.create({ tenantId: req.auth.tenantId, userId: req.auth.userId, correlationId: (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID() });
      const attachments = getAttachments(ctx);

      const row = await attachments.get(parseInt(id, 10));
      if (!assertPermission(req.auth, WRITE_PERMISSION[row.entityType] ?? PERMISSIONS.PO_UPDATE, reply)) return;

      await attachments.delete(parseInt(id, 10));
      await ctx.events.publish('attachment', parseInt(id, 10), 'ATTACHMENT_DELETED', { id: parseInt(id, 10) });
      return reply.code(204).send();
    },
  });
}
